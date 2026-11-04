// node --test statements/tests/corpus.test.mjs
// The bank layouts in statements/tests/corpus: every one marked must_pass reads exactly as its
// expect.json says. The others are scored by statements/tests/corpus/run.mjs and not asserted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { layouts, score } from './corpus/run.mjs';

for (const dir of layouts()) {
  const spec = JSON.parse(readFileSync(join(dir, 'expect.json'), 'utf8'));
  if (!spec.must_pass) continue;
  test(`${spec.country} ${spec.bank} (${spec.format}) reads as expected`, async () => {
    const result = await score(dir);
    assert.equal(result.status, 'PASS', `${result.path}: ${[...result.wrong, ...(result.problems ?? [])].join('; ')}`);
  });
}
