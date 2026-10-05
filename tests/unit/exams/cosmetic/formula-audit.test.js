// tests/unit/exams/cosmetic/formula-audit.test.js
// @spec FO-56
// formula-audit.js — 종합 규정 점검 보고서 수집기.
// 검증: 유형별 섹션 게이트(bizVisible 재사용), 빈 데이터 '기록 없음' 분기,
//       체크리스트·라벨·광고·포뮬러·배치·원료·고객 수집, 뷰모델→빌더 마크업

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { collectAuditReportData } from '../../../../src/exams/cosmetic/views/formula-audit.js';
import { buildAuditReportHtml } from '../../../../src/exams/cosmetic/views/formula-print.js';
import { STORAGE_KEYS } from '../../../../src/storage-keys.js';
import { setJSON } from '../../../../src/storage.js';
import { setBizType } from '../../../../src/exams/cosmetic/biz-profile.js';
import { createCustomer } from '../../../../src/exams/cosmetic/customer-store.js';
import { createMaterial } from '../../../../src/exams/cosmetic/material-ledger.js';
import { createBatch } from '../../../../src/exams/cosmetic/batch-store.js';
import { createFormula } from '../../../../src/exams/cosmetic/formula-store.js';
import { COMPLIANCE_SECTIONS } from '../../../../src/exams/cosmetic/views/formula-compliance.js';

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
const NOW = new Date('2026-10-05T10:00:00Z');
const FIRST_CHECK_ID = COMPLIANCE_SECTIONS[0].items[0].id;

beforeEach(() => {
  originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = createMockStorage();
});

afterEach(() => {
  globalThis.localStorage = originalLocalStorage;
});

function section(data, id) {
  return data.sections.find(s => s.id === id);
}

/* =======================================================
   유형별 섹션 게이트 (BIZ_PANELS 재사용)
   ======================================================= */

test('custom 유형 — 고객 첫·체크리스트 끝 순서, 라벨·광고 제외', () => {
  const d = collectAuditReportData(NOW);
  assert.deepEqual(
    d.sections.map(s => s.id),
    ['customers', 'formulas', 'batches', 'materials', 'checklist']);
  assert.equal(d.biz.id, 'custom');
  assert.equal(d.generatedAt, '2026-10-05T10:00:00.000Z');
});

test('mfg 유형 — 라벨·광고·포뮬러·배치·원료 포함, 고객 제외·체크리스트 끝', () => {
  setBizType('mfg');
  const d = collectAuditReportData(NOW);
  const ids = d.sections.map(s => s.id);
  assert.deepEqual(ids, ['label', 'adlint', 'formulas', 'batches', 'materials', 'checklist']);
  assert.equal(d.biz.id, 'mfg');
  assert.equal(d.setLabel, '화장품제조업 (CGMP)');
});

test('sales 유형 — 고객 첫·체크리스트 끝, 포뮬러·배치·원료 제외', () => {
  setBizType('sales');
  const d = collectAuditReportData(NOW);
  assert.deepEqual(d.sections.map(s => s.id), ['customers', 'label', 'adlint', 'checklist']);
});

test('비대상 유형의 잔존 데이터 — 패널 숨겨도 보고서에 비대상 표기로 포함', () => {
  createCustomer({ name: '홍길동', consultLog: [{ date: '2026-10-01', text: '상담' }] });
  createFormula({ name: '잔존 처방', ingredients: [{ name: '정제수', concentration: 80 }] });
  setBizType('mfg'); // customer 패널 비대상 — 카드가 있으면 보고해야 함
  const d = collectAuditReportData(NOW);
  const cust = section(d, 'customers');
  assert.ok(cust, 'mfg에도 고객 카드 잔존 시 섹션 포함');
  assert.match(cust.summary, /비대상 잔존/);
  assert.equal(cust.rows[0].name, '홍길동');
  // sales로 전환 — formulas 패널 비대상이지만 처방 잔존 → 포함
  setBizType('sales');
  const f = section(collectAuditReportData(NOW), 'formulas');
  assert.ok(f, 'sales에도 포뮬러 잔존 시 섹션 포함');
  assert.match(f.summary, /비대상 잔존/);
});

/* =======================================================
   빈 데이터 — '기록 없음' 분기 (미실시도 증적)
   ======================================================= */

test('빈 데이터 — 체크리스트 외 섹션은 기록 없음, 체크리스트는 0/N', () => {
  const d = collectAuditReportData(NOW);
  const cl = section(d, 'checklist');
  assert.equal(cl.empty, false);
  assert.equal(cl.done, 0);
  assert.ok(cl.total > 0);
  for (const s of d.sections.filter(x => x.id !== 'checklist')) {
    assert.equal(s.empty, true, `${s.id} should be empty`);
    assert.match(s.summary, /기록 없음/);
  }
});

/* =======================================================
   섹션별 수집
   ======================================================= */

test('체크리스트 — 체크 상태·점검일·근거 문서 라벨 반영', () => {
  setJSON(STORAGE_KEYS.COMPLIANCE_CHECKS, {
    checked: { [FIRST_CHECK_ID]: '2026-10-01T09:30:00Z' },
    updatedAt: '2026-10-01T09:30:00Z',
  });
  const cl = section(collectAuditReportData(NOW), 'checklist');
  assert.equal(cl.done, 1);
  const item = cl.groups[0].items[0];
  assert.equal(item.done, true);
  assert.equal(item.doneAt, '2026-10-01');
  assert.ok(item.refs.length > 0); // 근거 문서 라벨
});

test('표시사항 — 드래프트 기재 상태 요약 + 필수 미기재 집계 (mfg)', () => {
  setBizType('mfg');
  setJSON(STORAGE_KEYS.FORMULA_LABEL_DRAFT, { 'label-product': '수분 세럼', 'label-lot': 'LOT-1' });
  const label = section(collectAuditReportData(NOW), 'label');
  assert.equal(label.empty, false);
  assert.ok(label.checks.length >= 8);
  assert.ok(label.missing > 0); // 필수 대부분 미기재
  assert.equal(label.checks[0].ok, true); // 제품명 기재됨
});

test('표시사항 — 드래프트 전부 빈 문자열이면 기록 없음 (mfg)', () => {
  setBizType('mfg');
  setJSON(STORAGE_KEYS.FORMULA_LABEL_DRAFT, { 'label-product': '', 'label-lot': '' });
  assert.equal(section(collectAuditReportData(NOW), 'label').empty, true);
});

test('광고 점검 — 최근 실행 1건 + 적발 목록 + 원문 절단 (mfg)', () => {
  setBizType('mfg');
  setJSON(STORAGE_KEYS.FORMULA_ADLINT_STATE, {
    text: `${'x'.repeat(2100)}치료`,
    hits: [{ term: '치료', category: 'medical', label: '의약품 오인', suggestion: '개선 도움' }],
    at: '2026-10-04T12:00:00Z',
  });
  const ad = section(collectAuditReportData(NOW), 'adlint');
  assert.equal(ad.empty, false);
  assert.equal(ad.hits.length, 1);
  assert.equal(ad.hits[0].term, '치료');
  assert.equal(ad.text.length, 2000); // 상한 절단
  assert.equal(ad.truncated, true);
});

test('포뮬러 — 저장 처방 라이브 재검증 (DB 미로드 → 확인 필요)', () => {
  createFormula({ name: '수분 세럼', ingredients: [{ name: '정제수', concentration: 80 }] });
  const f = section(collectAuditReportData(NOW), 'formulas');
  assert.equal(f.items.length, 1);
  assert.equal(f.items[0].name, '수분 세럼');
  assert.equal(f.items[0].summary.unknown, 1); // 원료 DB 미로드 환경
  assert.equal(f.totals.unknown, 1);
});

test('배치 — QC 이상 집계 + 고객명 포함 최근 목록', () => {
  createBatch({
    formulaName: '세럼', madeAt: '2026-10-01T10:00',
    customerName: '홍길동', qc: { scent: '이상' },
  });
  const b = section(collectAuditReportData(NOW), 'batches');
  assert.equal(b.total, 1);
  assert.equal(b.qcBad, 1);
  assert.equal(b.hygIncomplete, 1); // 위생 미기입
  assert.equal(b.recent[0].customerName, '홍길동');
  assert.equal(b.latestAt, '2026-10-01T10:00');
});

test('원료 — 기한 경과·임박·미기재 집계', () => {
  createMaterial({ name: '글리세린', expiryAt: '2020-01-01' }); // 경과
  createMaterial({ name: '정제수' }); // 기한 미기재
  const m = section(collectAuditReportData(NOW), 'materials');
  assert.equal(m.total, 2);
  assert.equal(m.counts.expired, 1);
  assert.equal(m.counts.none, 1);
});

test('고객 — 행(이름·알레르기·건수·최근일) + 최근 상담 3건 상한', () => {
  createCustomer({
    name: '홍길동', skinType: '건성', allergies: ['파라벤'],
    consultLog: [1, 2, 3, 4].map(i => ({ date: `2026-10-0${i}`, text: `상담${i}` })),
  });
  const c = section(collectAuditReportData(NOW), 'customers');
  assert.equal(c.rows.length, 1);
  assert.equal(c.logTotal, 4);
  const row = c.rows[0];
  assert.equal(row.name, '홍길동');
  assert.deepEqual(row.allergies, ['파라벤']);
  assert.equal(row.lastDate, '2026-10-04');
  assert.equal(row.recent.length, 3); // 상한
  assert.equal(row.recent[0].text, '상담4'); // 최신 우선
});

/* =======================================================
   빌더 — fp-doc 마크업
   ======================================================= */

test('buildAuditReportHtml — 헤더·섹션 번호·서명·면책·개인정보 경고', () => {
  const html = buildAuditReportHtml(collectAuditReportData(NOW));
  assert.ok(html.includes('법규 준수 종합 점검 보고서'));
  assert.ok(html.includes('맞춤형화장품 조제'));
  assert.ok(html.includes('점검 요약'));
  assert.ok(html.includes('①'));
  assert.ok(html.includes('점검자(조제관리사/책임판매관리자)'));
  assert.ok(html.includes('법률 자문이 아닙니다'));
  assert.ok(html.includes('개인정보'));
  assert.ok(html.includes('기록 없음'));
});

test('buildAuditReportHtml — 미점검 항목은 한 줄 압축 (note·근거 생략)', () => {
  let html = buildAuditReportHtml(collectAuditReportData(NOW)); // 전 항목 미점검
  assert.ok(html.includes('미점검'));
  assert.ok(!html.includes('근거:'), '미점검만 있으면 근거 줄 없음');
  setJSON(STORAGE_KEYS.COMPLIANCE_CHECKS, {
    checked: { [FIRST_CHECK_ID]: '2026-10-01T09:30:00Z' },
    updatedAt: '2026-10-01T09:30:00Z',
  });
  html = buildAuditReportHtml(collectAuditReportData(NOW));
  assert.equal(html.split('근거:').length - 1, 1, '점검 완료 1건만 근거 1줄');
});

test('buildAuditReportHtml — 체크 항목 ☑ 렌더 + 유형별 섹션 라벨 (mfg)', () => {
  setBizType('mfg');
  setJSON(STORAGE_KEYS.COMPLIANCE_CHECKS_MFG, {
    checked: { 'mfg-reg': '2026-10-02T08:00:00Z' },
    updatedAt: '2026-10-02T08:00:00Z',
  });
  const html = buildAuditReportHtml(collectAuditReportData(NOW));
  assert.ok(html.includes('화장품제조업'));
  assert.ok(html.includes('☑'));
  assert.ok(html.includes('2026-10-02'));
  assert.ok(!html.includes('고객 상담 기록')); // mfg는 고객 섹션 없음
});
