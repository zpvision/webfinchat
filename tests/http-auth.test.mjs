import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHttpToken } from '../server/finchatHttpAuth.mjs';

test('HTTP auth accepts padded/unpadded standard and URL-safe token representations', () => {
  for (const length of [50, 51, 52, 64]) {
    const bytes = Buffer.alloc(length, 255);
    const standard = bytes.toString('base64');
    const padding = '='.repeat((4 - bytes.toString('base64url').length % 4) % 4);
    for (const value of [standard, standard.replace(/=+$/, ''), bytes.toString('base64url'), bytes.toString('base64url') + padding]) {
      assert.equal(normalizeHttpToken(value), standard);
      assert.deepEqual(Buffer.from(normalizeHttpToken(value), 'base64'), bytes);
    }
  }
});

test('HTTP token normalization preserves missing and malformed credentials for existing error handling', () => {
  assert.equal(normalizeHttpToken(undefined), '');
  assert.equal(normalizeHttpToken(''), '');
  for (const value of ['a', 'abc.def.ghi', '***', 'YWJj===', 'Token YWJj']) assert.equal(normalizeHttpToken(value), value);
  assert.equal(normalizeHttpToken(' YWJj '), 'YWJj');
});
