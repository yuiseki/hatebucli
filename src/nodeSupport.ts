/**
 * The oldest Node this CLI runs on.
 *
 * 22.12 is where `require()` of an ES module landed, and several of the
 * dependencies ship as ES modules only. Below it the failure is an
 * ERR_REQUIRE_ESM stack trace from inside node_modules, which says nothing
 * about what to do, so bin/hatebu.js checks this before loading anything else.
 */
export const MINIMUM_NODE = '22.12.0';

/** Compares dotted version numbers, ignoring any prerelease suffix. */
export function isSupportedNodeVersion(
  version: string,
  minimum: string = MINIMUM_NODE,
): boolean {
  const parse = (value: string) =>
    value
      .replace(/^v/, '')
      .split('-')[0]
      .split('.')
      .map((part) => Number(part) || 0);

  const current = parse(version);
  const floor = parse(minimum);

  for (let index = 0; index < Math.max(current.length, floor.length); index += 1) {
    const left = current[index] ?? 0;
    const right = floor[index] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}
