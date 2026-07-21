/**
 * phone.test.js — normalizePhone regression suite
 *
 * Runs with Node.js built-in test runner: `node --test tests/**\/*.test.js`
 * or `npm test`.
 *
 * Guards against:
 *   - US/CA +1 numbers being corrupted to fake Mexican numbers (the Miami incident)
 *   - Other international numbers (+58 VE, +44 UK, etc.) being corrupted
 *   - Mexican numbers (from Meta's 521XXXXXXXXXX webhook format) breaking
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

// Inline the pure logic so the test has no side-effects from the logger import.
// If the implementation changes, the import below should be used instead and
// this stub removed.
import { normalizePhone } from '../../src/utils/phone.js';

describe('normalizePhone — Mexican numbers (must NOT change)', () => {
  it('MX 13-digit Meta webhook format (521XXXXXXXXXX)', () => {
    // Real production input: Meta sends Rafael's number as 5215535305000
    assert.equal(normalizePhone('5215535305000'), '+52115535305000');
  });

  it('MX advisor 13-digit Meta format', () => {
    assert.equal(normalizePhone('5215544884437'), '+52115544884437');
  });

  it('MX 10-digit local (admin endpoint input)', () => {
    assert.equal(normalizePhone('5535305000'), '+5215535305000');
  });

  it('MX E.164 with + already (admin endpoint)', () => {
    assert.equal(normalizePhone('+5215535305000'), '+5215535305000');
  });

  it('MX E.164 with +521 already', () => {
    assert.equal(normalizePhone('+52115535305000'), '+52115535305000');
  });

  it('MX +52 without mobile 1-prefix gets 1 added', () => {
    assert.equal(normalizePhone('+525535305000'), '+5215535305000');
  });
});

describe('normalizePhone — international numbers (the bug fix)', () => {
  it('US +1 Miami — the incident (17866332282 must NOT become +521...)', () => {
    // This was the root cause: 17866332282 → +5217866332282 (corrupted)
    assert.equal(normalizePhone('17866332282'), '+17866332282');
  });

  it('US +1 number must not start with +52', () => {
    const result = normalizePhone('17866332282');
    assert.equal(result.startsWith('+52'), false, `Expected non-MX, got ${result}`);
  });

  it('Venezuela +58', () => {
    assert.equal(normalizePhone('5858123456789'), '+5858123456789');
  });

  it('UK +44', () => {
    assert.equal(normalizePhone('4412345678901'), '+4412345678901');
  });

  it('Spain +34', () => {
    assert.equal(normalizePhone('34612345678'), '+34612345678');
  });
});
