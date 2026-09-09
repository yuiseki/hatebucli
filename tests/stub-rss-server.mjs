/**
 * A stand-in for b.hatena.ne.jp, run as its own process.
 *
 * It has to be a separate process: the tests drive the CLI with spawnSync,
 * which blocks the event loop of the test process, so a server living there
 * could never answer the request the CLI is waiting on.
 *
 * argv[2] is a directory. `<dir>/<yyyymmdd>.json` holds the bookmarks to
 * serve for that date, and every request is appended to `<dir>/requests.log`.
 * The port is printed on stdout as `port <n>` once it is listening.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: stub-rss-server.mjs <fixture-dir>');
  process.exit(1);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderRss(bookmarks) {
  const items = bookmarks
    .map((bookmark) => {
      const lines = [
        `  <item rdf:about="${escapeXml(bookmark.link)}">`,
        `    <title>${escapeXml(bookmark.title)}</title>`,
        `    <link>${escapeXml(bookmark.link)}</link>`,
        `    <description>${escapeXml(bookmark.description ?? '')}</description>`,
        `    <dc:date>${escapeXml(bookmark.date)}</dc:date>`,
      ];
      for (const tag of bookmark.tags ?? []) {
        lines.push(`    <dc:subject>${escapeXml(tag)}</dc:subject>`);
      }
      lines.push('  </item>');
      return lines.join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"',
    '  xmlns="http://purl.org/rss/1.0/"',
    '  xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '  <channel rdf:about="http://b.hatena.ne.jp/test-user/bookmark">',
    '    <title>test-user</title>',
    '    <link>http://b.hatena.ne.jp/test-user/bookmark</link>',
    '    <description>test</description>',
    '  </channel>',
    items,
    '</rdf:RDF>',
  ].join('\n');
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const dateParam = url.searchParams.get('date') ?? '';
  fs.appendFileSync(path.join(dir, 'requests.log'), `${dateParam}\n`, 'utf8');

  let bookmarks = [];
  const fixturePath = path.join(dir, `${dateParam}.json`);
  if (fs.existsSync(fixturePath)) {
    bookmarks = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  }

  response.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
  response.end(renderRss(bookmarks));
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`port ${server.address().port}\n`);
});
