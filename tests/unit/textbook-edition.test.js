// @spec P-14
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTextbookEditionNew } from '../../src/textbook-edition.js';

test('교재 판본 판정 — 미선언이면 표시하지 않음', () => {
  assert.equal(isTextbookEditionNew(null, null), false);
  assert.equal(isTextbookEditionNew(undefined, '2026'), false);
  assert.equal(isTextbookEditionNew('', '2026'), false);
});

test('교재 판본 판정 — 첫 방문(기록 없음)이면 새 판본', () => {
  assert.equal(isTextbookEditionNew('2026', null), true);
  assert.equal(isTextbookEditionNew('2026', undefined), true);
});

test('교재 판본 판정 — 동일 판본이면 억제, 개정이면 표시', () => {
  assert.equal(isTextbookEditionNew('2026', '2026'), false);
  assert.equal(isTextbookEditionNew('2027', '2026'), true);
  // 판본이 되돌아간(롤백) 경우도 변경이므로 표시
  assert.equal(isTextbookEditionNew('2026', '2027'), true);
});
