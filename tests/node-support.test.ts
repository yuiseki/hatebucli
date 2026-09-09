/**
 * The version gate in bin/hatebu.js. Below the floor the failure would
 * otherwise be an ERR_REQUIRE_ESM stack trace from inside node_modules.
 */
import { test, expect } from 'vitest';
import { MINIMUM_NODE, isSupportedNodeVersion } from '../dist/nodeSupport.js';

test('the floor is where require() of an ES module landed', () => {
  expect(MINIMUM_NODE).toBe('22.12.0');
});

test('versions at or above the floor are supported', () => {
  for (const version of ['22.12.0', '22.12.1', '22.20.0', '23.9.0', '24.0.0', '26.1.0', 'v24.16.0']) {
    expect(isSupportedNodeVersion(version), version).toBe(true);
  }
});

test('versions below the floor are not', () => {
  for (const version of ['18.19.0', '20.19.0', '22.3.0', '22.11.9', 'v20.0.0']) {
    expect(isSupportedNodeVersion(version), version).toBe(false);
  }
});

test('a prerelease is judged by its release number', () => {
  expect(isSupportedNodeVersion('24.0.0-nightly')).toBe(true);
  expect(isSupportedNodeVersion('22.11.0-rc.1')).toBe(false);
});
