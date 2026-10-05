// tests/unit/exams/cosmetic/formula-practical.test.js
// @spec FO-57,FO-59,FO-61,FO-63
// 실무 도구 확장 — 이상사례 스토어·LOT 역추적·재고 차감·보고서 이력.
// 검증: adverse-store CRUD·정제, findBatchesByMaterial 매칭,
//       deductStock 차감·바닥·부족, recordAuditLog 상한·누적

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAdverse, updateAdverse, deleteAdverse,
  listAdverse, getAdverse, getAdverseUsage,
} from '../../../../src/exams/cosmetic/adverse-store.js';
import {
  createMaterial, getMaterial, deductStock, stockStatus,
} from '../../../../src/exams/cosmetic/material-ledger.js';
import { createBatch, findBatchesByMaterial } from '../../../../src/exams/cosmetic/batch-store.js';
import {
  collectAuditReportData, recordAuditLog, listAuditLog,
} from '../../../../src/exams/cosmetic/views/formula-audit.js';

function createMockStorage() {
  const store = {};
  return {
    getItem(key) { return key in store ? store[key] : null; },
    setItem(key, value) { store[key] = String(value); },
    removeItem(key) { delete store[key]; },
    clear() { for (const k of Object.keys(store)) delete store[k]; },
  };
}

let originalLocalStorage;

beforeEach(() => {
  originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = createMockStorage();
});

afterEach(() => {
  globalThis.localStorage = originalLocalStorage;
});

/* =======================================================
   이상사례 스토어 (FO-59)
   ======================================================= */

test('이상사례 등록 — 필수 필드·id 부여·발생일 역순 목록', () => {
  const r1 = createAdverse({ occurredAt: '2026-10-01', customerName: '홍길동', symptoms: '홍반' });
  createAdverse({ occurredAt: '2026-10-05', customerName: '김영희', symptoms: '가려움', reportedAt: '2026-10-06' });
  assert.equal(r1.ok, true);
  assert.ok(r1.adverse.id.startsWith('adv_'));
  const items = listAdverse();
  assert.equal(items.length, 2);
  assert.equal(items[0].occurredAt, '2026-10-05'); // 최신 우선
  assert.equal(items[1].customerName, '홍길동');
});

test('이상사례 검증 — 발생일·증상 필수, 잘못된 날짜 형식 정제', () => {
  assert.equal(createAdverse({ symptoms: '증상' }).ok, false);        // 발생일 없음
  assert.equal(createAdverse({ occurredAt: '2026-10-01' }).ok, false); // 증상 없음
  const r = createAdverse({ occurredAt: '10월 1일', symptoms: 'x' });
  assert.equal(r.ok, false); // clampDate가 형식 외 값을 비움 → 필수 검증 실패
});

test('이상사례 보정·삭제 — 필드 재정제 + 없는 id 실패', () => {
  const r = createAdverse({ occurredAt: '2026-10-01', symptoms: '홍반', product: 'B001' });
  const u = updateAdverse(r.adverse.id, { occurredAt: '2026-10-02', symptoms: '홍반 악화', reportedAt: '2026-10-03' });
  assert.equal(u.ok, true);
  assert.equal(u.adverse.reportedAt, '2026-10-03');
  assert.equal(u.adverse.product, ''); // 미전달 필드는 재정제로 비워짐
  assert.equal(updateAdverse('adv_없음', {}).ok, false);
  assert.equal(deleteAdverse(r.adverse.id).ok, true);
  assert.equal(getAdverse(r.adverse.id), null);
  assert.equal(deleteAdverse(r.adverse.id).ok, false);
});

test('이상사례 한도 — Free 30건까지', () => {
  for (let i = 0; i < 30; i++) {
    createAdverse({ occurredAt: '2026-10-01', symptoms: `증상${i}` });
  }
  const usage = getAdverseUsage();
  assert.equal(usage.count, 30);
  assert.equal(usage.canCreate, false);
  const over = createAdverse({ occurredAt: '2026-10-02', symptoms: '초과' });
  assert.equal(over.ok, false);
  assert.match(over.error, /최대/);
});

test('이상사례 — 보고서 수집 섹션에 집계 (전 유형 공통)', () => {
  createAdverse({ occurredAt: '2026-10-01', customerName: '홍길동', symptoms: '홍반' });
  createAdverse({ occurredAt: '2026-10-02', symptoms: '가려움', reportedAt: '2026-10-04' });
  const d = collectAuditReportData(new Date('2026-10-05T10:00:00Z'));
  const s = d.sections.find(x => x.id === 'adverse');
  assert.ok(s);
  assert.equal(s.empty, false);
  assert.equal(s.total, 2);
  assert.equal(s.reported, 1);
  assert.equal(s.recent[0].occurredAt, '2026-10-02');
});

test('이상사례 — 기록 없으면 empty 섹션 (미실시 증적)', () => {
  const s = collectAuditReportData(new Date()).sections.find(x => x.id === 'adverse');
  assert.equal(s.empty, true);
  assert.match(s.summary, /기록 없음/);
});

/* =======================================================
   LOT 역추적 (FO-57)
   ======================================================= */

test('LOT 역추적 — materialId 우선 + 원료명 보조 매칭', () => {
  const m = createMaterial({ name: '글리세린', lot: 'A1' }).material;
  createBatch({ formulaName: '세럼', customerName: '홍길동', madeAt: '2026-10-01T10:00', materialLots: [{ name: '글리세린', materialId: m.id, lot: 'A1' }] });
  createBatch({ formulaName: '토너', madeAt: '2026-10-02T10:00', materialLots: [{ name: '정제수', materialId: 'mat_other', lot: 'B2' }] });
  // materialId 매칭
  const hits = findBatchesByMaterial(m.id, '글리세린');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].formulaName, '세럼');
  // 장부 항목이 지워진 뒤 name만으로 추적 — 삭제된 id로는 못 찾지만 name 폴백 유지
  const byName = findBatchesByMaterial('mat_deleted', '글리세린');
  assert.equal(byName.length, 1);
  // 미일치 — id·name 모두 해당 없음
  assert.equal(findBatchesByMaterial('mat_없음', '없는원료').length, 0);
});

/* =======================================================
   재고 자동 차감 (FO-61)
   ======================================================= */

test('재고 차감 — 선택 LOT 잔량 감소 + 소진 상태 전이', () => {
  const m = createMaterial({ name: '글리세린', qty: 100, unit: 'g' }).material;
  const res = deductStock([{ materialId: m.id, name: '글리세린', amount: 30 }]);
  assert.equal(res.ok, true);
  assert.equal(res.deducted[0].remain, 70);
  assert.equal(getMaterial(m.id).qty, 70);
  assert.equal(stockStatus(getMaterial(m.id)), 'ok');
  // 바닥까지 차감 → 소진
  const res2 = deductStock([{ materialId: m.id, name: '글리세린', amount: 70 }]);
  assert.equal(res2.deducted[0].remain, 0);
  assert.equal(stockStatus(getMaterial(m.id)), 'out');
});

test('재고 차감 — 부족분은 0 바닥 + shortages 반환, 잔량 미기재는 건너뜀', () => {
  const m1 = createMaterial({ name: '히알루론산', qty: 10, unit: 'g' }).material;
  const m2 = createMaterial({ name: '정제수' }).material; // 잔량 미기재
  const res = deductStock([
    { materialId: m1.id, name: '히알루론산', amount: 25 },
    { materialId: m2.id, name: '정제수', amount: 80 },
    { materialId: 'mat_없음', name: '미등록', amount: 5 },
  ]);
  assert.equal(res.shortages.length, 1);
  assert.equal(res.shortages[0].name, '히알루론산');
  assert.equal(res.shortages[0].need, 25);
  assert.equal(getMaterial(m1.id).qty, 0);
  assert.ok(res.skipped.includes('정제수'));
  assert.ok(res.skipped.includes('미등록'));
});

test('재고 차감 — 0 이하 수량·무효 항목은 무시', () => {
  const m = createMaterial({ name: '글리세린', qty: 50 }).material;
  const res = deductStock([
    { materialId: m.id, name: '글리세린', amount: 0 },
    { materialId: m.id, name: '글리세린', amount: -3 },
    null,
  ]);
  assert.equal(res.deducted.length, 0);
  assert.equal(getMaterial(m.id).qty, 50); // 변경 없음
});

/* =======================================================
   보고서 출력 이력 (FO-63)
   ======================================================= */

test('보고서 이력 — 출력 메타데이터 기록 + 20건 상한', () => {
  for (let i = 0; i < 22; i++) {
    recordAuditLog(collectAuditReportData(new Date(`2026-09-${String(i % 28 + 1).padStart(2, '0')}T10:00:00Z`)));
  }
  const log = listAuditLog();
  assert.equal(log.length, 20); // 상한
  const e = log[0];
  assert.equal(e.bizId, 'custom');
  assert.equal(e.bizLabel, '맞춤형화장품 판매업');
  assert.equal(typeof e.done, 'number');
  assert.equal(typeof e.total, 'number');
  assert.equal(e.sections, 6); // custom: 고객·이상사례·포뮬러·배치·원료·체크리스트
  // 본문(고객 개인정보)은 기록하지 않는다
  assert.equal(e.sectionsData, undefined);
  assert.ok(!('customers' in e));
});
