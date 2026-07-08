import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reasonSignature } from './analyze-manifests.js';

test('empty reason', () => {
  assert.equal(reasonSignature(''), '(no reason)');
});

test('takes only first line', () => {
  const r = 'Locator drift on Close button.\n  at tests/foo.spec.ts:12:5';
  assert.equal(reasonSignature(r), 'Locator drift on Close button.');
});

test('strips line/column noise so stack coords do not fragment clusters', () => {
  const a = reasonSignature('Timed out waiting for /admin at foo.ts:12:5');
  const b = reasonSignature('Timed out waiting for /admin at foo.ts:44:9');
  assert.equal(a, b);
});

test('replaces manifest UUIDs so triaged/<uuid> paths cluster together', () => {
  const a = reasonSignature('No tests found in triaged/12345678-1234-1234-1234-123456789abc/spec');
  assert.match(a, /<uuid>/);
});

test('replaces short hex ids (test hashes, git shas)', () => {
  const a = reasonSignature('Locator abc12345def6 unreachable');
  const b = reasonSignature('Locator 9876feedcba1 unreachable');
  assert.equal(a, b);
});

test('caps to REASON_HEAD_MAX', () => {
  const long = 'x'.repeat(500);
  const sig = reasonSignature(long);
  assert.ok(sig.length <= 121, `signature length ${sig.length}`);
  assert.ok(sig.endsWith('…'));
});
