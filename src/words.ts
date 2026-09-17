type LinderaToken = {
  surface?: unknown;
  partOfSpeech?: unknown;
  baseForm?: unknown;
};

type LinderaTokenizer = {
  tokenize(inputText: string): LinderaToken[];
};

type LinderaTokenizerBuilder = {
  setDictionary(uri: string): void;
  setMode(mode: string): void;
  setKeepWhitespace(keep: boolean): void;
  build(): LinderaTokenizer;
};

type LinderaModule = {
  TokenizerBuilder: new () => LinderaTokenizerBuilder;
};

const ALLOWED_PARTS_OF_SPEECH = new Set<string>(['名詞', 'UNK']);
/**
 * Fragments of addresses and markup that the analyser reads as nouns. They are
 * never what a bookmark is about, and they came out at the top of the early
 * years, where a larger share of titles carry a hostname.
 */
const URL_FRAGMENTS = [
  'http',
  'https',
  'www',
  'com',
  'net',
  'org',
  'jp',
  'co',
  'html',
  'htm',
  'php',
  'index',
];

const STOP_WORDS = new Set<string>([
  ...URL_FRAGMENTS,
  'する',
  'ある',
  'いる',
  'なる',
  'こと',
  'もの',
  'よう',
  'ため',
  'これ',
  'それ',
  'あれ',
  'ここ',
  'そこ',
  'あそこ',
  '今回',
]);

let tokenizer: LinderaTokenizer | null = null;

function getTokenizer(): LinderaTokenizer {
  if (tokenizer) return tokenizer;

  const lindera = require('lindera-wasm-nodejs-ipadic') as LinderaModule;
  const builder = new lindera.TokenizerBuilder();
  builder.setDictionary('embedded://ipadic');
  builder.setMode('normal');
  builder.setKeepWhitespace(false);
  tokenizer = builder.build();
  return tokenizer;
}

function normalizePartOfSpeech(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.normalize('NFKC').trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeWord(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const normalized = value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  if (normalized.length === 0) return undefined;
  if (normalized.length === 1) return undefined;
  if (/^[\p{P}\p{S}]+$/u.test(normalized)) return undefined;
  if (/^\d+([.,]\d+)?$/u.test(normalized)) return undefined;

  return normalized;
}

function resolveWordText(token: LinderaToken): string | undefined {
  const baseForm = normalizeWord(token.baseForm);
  if (baseForm && baseForm !== '*') {
    return baseForm;
  }

  return normalizeWord(token.surface);
}

/**
 * A bookmark saved before the page had a title carries the address as its
 * title. Tokenizing one of those yields the parts of a hostname: http, www,
 * co, jp, html. In this archive 3.3% of titles are addresses, and 12% of 2005's,
 * which was enough for those fragments to lead the rankings of the early years.
 */
const BARE_URL = /^https?:\/\/\S*$/i;

export function extractWordsFromJapaneseText(text: unknown): string[] {
  if (typeof text !== 'string') return [];

  const normalized = text.normalize('NFKC').trim();
  if (normalized.length === 0) return [];
  if (BARE_URL.test(normalized)) return [];

  const tokens = getTokenizer().tokenize(normalized);
  const words: string[] = [];

  for (const token of tokens) {
    const partOfSpeech = normalizePartOfSpeech(token.partOfSpeech);
    if (!partOfSpeech || !ALLOWED_PARTS_OF_SPEECH.has(partOfSpeech)) continue;

    const word = resolveWordText(token);
    if (!word) continue;
    if (STOP_WORDS.has(word)) continue;

    words.push(word);
  }

  return words;
}
