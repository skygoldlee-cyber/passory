// tests/unit/exams/cosmetic/formula-audit.test.js
// @spec FO-56,FO-64,FO-66,FO-67,FO-69
// formula-audit.js — 종합 규정 점검 보고서 수집기.
// 검증: 유형별 섹션 게이트(bizVisible 재사용), 빈 데이터 '기록 없음' 분기,
//       체크리스트·라벨·광고·포뮬러·배치·원료·고객 수집, 뷰모델→빌더 마크업

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectAuditReportData, recordAuditLog } from '../../../../src/exams/cosmetic/views/formula-audit.js';
import { buildAuditReportHtml } from '../../../../src/exams/cosmetic/views/formula-print.js';
import { STORAGE_KEYS } from '../../../../src/storage-keys.js';
import { getJSON, setJSON } from '../../../../src/storage.js';
import { setBizType, setInspectorName } from '../../../../src/exams/cosmetic/biz-profile.js';
import { createCustomer } from '../../../../src/exams/cosmetic/customer-store.js';
import { createMaterial } from '../../../../src/exams/cosmetic/material-ledger.js';
import { createBatch } from '../../../../src/exams/cosmetic/batch-store.js';
import { createFormula } from '../../../../src/exams/cosmetic/formula-store.js';
import { COMPLIANCE_SECTIONS } from '../../../../src/exams/cosmetic/views/formula-compliance.js';
import { fmtLocalDateTime, localDateTime } from '../../../../src/exams/cosmetic/store-utils.js';
import { fnv1aHex, deviceLabel } from '../../../../src/utils.js';

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
    ['customers', 'adverse', 'formulas', 'batches', 'materials', 'checklist']);
  assert.equal(d.biz.id, 'custom');
  assert.equal(d.generatedAt, localDateTime(NOW), 'naive 로컬 형식 (YYYY-MM-DDTHH:MM)');
});

test('발행일시 표시 — ISO(UTC)는 로컬 시각으로 변환, naive 로컬은 그대로 (fmtLocalDateTime)', () => {
  // generatedAt은 naive 로컬 — 표시는 그대로, 구버전 ISO 저장분만 로컬 변환
  const expected = localDateTime(NOW).replace('T', ' ');
  const html = buildAuditReportHtml(collectAuditReportData(NOW));
  assert.ok(html.includes(`발행일시: ${expected}`), `로컬 시각 표시 (${expected})`);
  assert.equal(fmtLocalDateTime('2026-10-05T03:21:00.000Z'),
    localDateTime(new Date('2026-10-05T03:21:00.000Z')).replace('T', ' '), 'Z ISO → 로컬');
  assert.equal(fmtLocalDateTime('2026-10-05T10:00'), '2026-10-05 10:00', 'naive 로컬 유지');
  assert.equal(fmtLocalDateTime('2026-10-05'), '2026-10-05', '날짜만');
  assert.equal(fmtLocalDateTime(''), '—', '빈 값');
});

test('mfg 유형 — 라벨·광고·포뮬러·배치·원료 포함, 고객 제외·체크리스트 끝', () => {
  setBizType('mfg');
  const d = collectAuditReportData(NOW);
  const ids = d.sections.map(s => s.id);
  assert.deepEqual(ids, ['adverse', 'label', 'adlint', 'formulas', 'batches', 'materials', 'checklist']);
  assert.equal(d.biz.id, 'mfg');
  assert.equal(d.setLabel, '화장품제조업 (CGMP)');
});

test('sales 유형 — 고객 첫·체크리스트 끝, 포뮬러·배치·원료 제외', () => {
  setBizType('sales');
  const d = collectAuditReportData(NOW);
  assert.deepEqual(d.sections.map(s => s.id), ['customers', 'adverse', 'label', 'adlint', 'checklist']);
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
  assert.ok(html.includes('종합 점검 보고서'));
  assert.ok(html.includes('맞춤형화장품 판매업'));
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

/* =======================================================
   출력 이력 — 섹션 기준 시각 스냅샷 (개선 ③)
   ======================================================= */

test('recordAuditLog — fresh 맵에 섹션별 최신 데이터 기준일 병기', () => {
  setJSON(STORAGE_KEYS.COMPLIANCE_CHECKS, {
    checked: { [FIRST_CHECK_ID]: '2026-10-03T09:00:00Z' },
    updatedAt: '2026-10-03T09:00:00Z',
  });
  setJSON(STORAGE_KEYS.FORMULA_ADLINT_STATE, {
    text: '주름 개선', hits: [], at: '2026-10-04T01:00:00Z',
  });
  const d = collectAuditReportData(NOW);
  const entry = recordAuditLog(d);
  assert.equal(entry.fresh.checklist, fmtLocalDateTime('2026-10-03T09:00:00Z').slice(0, 10));
  assert.equal(entry.fresh.adlint, fmtLocalDateTime('2026-10-04T01:00:00Z').slice(0, 10));
  assert.ok(!('batches' in entry.fresh), '데이터 없는 섹션은 fresh 미포함');
});

test('recordAuditLog — naive 로컬 저장분은 fresh가 그대로 유지', () => {
  createBatch({ formulaName: '세럼', madeAt: '2026-10-01T10:00' });
  const entry = recordAuditLog(collectAuditReportData(NOW));
  assert.equal(entry.fresh.batches, '2026-10-01');
});

/* =======================================================
   FO-66 — 보고서 문서 식별자 + 내용 해시
   ======================================================= */

test('collectAuditReportData — id 형식 RPT-YYYYMMDD-XXX-해시6 + 8자리 hex 해시', () => {
  const d = collectAuditReportData(NOW);
  const ymd = localDateTime(NOW).slice(0, 10).replace(/-/g, '');
  assert.match(d.id, new RegExp(`^RPT-${ymd}-\\d{3}-[0-9a-f]{6}$`), `id='${d.id}'`);
  assert.match(d.hash, /^[0-9a-f]{8}$/);
});

test('collectAuditReportData — 같은 입력은 같은 해시, 데이터 변화 시 해시 변경', () => {
  const d1 = collectAuditReportData(NOW);
  const d2 = collectAuditReportData(NOW);
  assert.equal(d1.hash, d2.hash, '동일 데이터 → 동일 해시 (결정적)');
  createCustomer({ name: '홍길동' });
  const d3 = collectAuditReportData(NOW);
  assert.notEqual(d1.hash, d3.hash, '고객 추가 → 요약이 달라 해시 변경');
});

test('fnv1aHex — 결정적 8자리 hex + 입력 민감', () => {
  assert.equal(fnv1aHex('passory'), fnv1aHex('passory'));
  assert.match(fnv1aHex('passory'), /^[0-9a-f]{8}$/);
  assert.notEqual(fnv1aHex('a'), fnv1aHex('b'));
});

test('recordAuditLog — id·hash가 이력 엔트리에 보존 (출력물↔이력 대조)', () => {
  const d = collectAuditReportData(NOW);
  const entry = recordAuditLog(d);
  assert.equal(entry.id, d.id);
  assert.equal(entry.hash, d.hash);
});

test('buildAuditReportHtml — 푸터에 문서 번호·해시·출력 환경 표기 (FO-66·67)', () => {
  const d = collectAuditReportData(NOW);
  const html = buildAuditReportHtml(d);
  assert.ok(html.includes(`문서 번호: ${d.id}`));
  assert.ok(html.includes(`내용 해시: ${d.hash}`));
  assert.ok(html.includes('서명 기록'), '서명란 아래 출력 기록 줄');
  assert.ok(html.includes('출력 환경'));
  // fp-sign-record 클래스 — 서명란과 한 줄 간격 + 페이지 넘김 분리 방지 (print.css)
  assert.ok(html.includes('fp-sign-record'));
});

/* =======================================================
   FO-64 — 기준 고시 스탬프 (고시 상태 미로드 폴백)
   ======================================================= */

test('buildAuditReportHtml — 고시 상태 미로드 시 확인 불가 폴백', () => {
  // _lastStatus는 진입 시 비동기 로드 — 단위 테스트 환경에서는 null
  const d = collectAuditReportData(NOW);
  assert.equal(d.notice, null);
  const html = buildAuditReportHtml(d);
  assert.ok(html.includes('기준 고시: 확인 불가'));
});

test('buildAuditReportHtml — notice 주입 시 고시명·시행일·확인일 렌더 + 개정 경고', () => {
  const d = collectAuditReportData(NOW);
  d.notice = {
    notice: '제2026-19호', ruleName: '화장품 안전기준 등에 관한 규정',
    effectiveDate: '2026-03-18', checkedAt: '2026-10-05', isNewer: false,
  };
  const html = buildAuditReportHtml(d);
  assert.ok(html.includes('화장품 안전기준 등에 관한 규정 제2026-19호'));
  assert.ok(html.includes('시행 2026-03-18'));
  assert.ok(html.includes('고시 확인 2026-10-05'));
  assert.ok(!html.includes('개정 확인 필요'));
  d.notice.isNewer = true;
  assert.ok(buildAuditReportHtml(d).includes('개정 확인 필요'));
});

/* =======================================================
   FO-67 — 출력 환경 라벨 (deviceLabel)
   ======================================================= */

test('deviceLabel — UA 문자열에서 브라우저·OS 요약', () => {
  assert.equal(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0'), 'Chrome · Windows');
  assert.equal(deviceLabel('Mozilla/5.0 (iPhone) Safari/604.1'), 'Safari · iOS');
  assert.equal(deviceLabel('Mozilla/5.0 (Macintosh) Firefox/120.0'), 'Firefox · macOS');
  assert.equal(deviceLabel(''), '알 수 없는 브라우저 · 알 수 없는 OS');
});

test('collectAuditReportData — printedBy 필드 존재 (node 환경 폴백)', () => {
  const d = collectAuditReportData(NOW);
  assert.ok(typeof d.printedBy === 'string' && d.printedBy.length > 0);
});

/* =======================================================
   점검자 성명 (FO-69)
   ======================================================= */

test('점검자 미설정 — inspector 빈 문자열 + 서명란 공란 출력 (FO-69)', () => {
  const d = collectAuditReportData(NOW);
  assert.equal(d.inspector, '');
  const html = buildAuditReportHtml(d);
  assert.ok(html.includes('점검자(조제관리사/책임판매관리자): ______________'));
});

test('점검자 설정 — 뷰모델 수집 + 서명란에 성명 (인) 기입 (FO-69)', () => {
  setInspectorName('  홍길동  ');
  const d = collectAuditReportData(NOW);
  assert.equal(d.inspector, '홍길동', '공백은 trim되어 수집');
  const html = buildAuditReportHtml(d);
  assert.ok(html.includes('점검자(조제관리사/책임판매관리자): 홍길동 (인)'));
  // 확인자·확인일은 수기 서명용 공란 유지
  assert.ok(html.includes('확인자: ______________'));
  assert.ok(html.includes('확인일: ________'));
});

test('점검자 비우기 — 키 제거로 미설정 복귀 (FO-69)', () => {
  setInspectorName('홍길동');
  setInspectorName('   ');
  assert.equal(getJSON(STORAGE_KEYS.FORMULA_INSPECTOR_NAME), null);
  assert.equal(collectAuditReportData(NOW).inspector, '');
});

test('점검자 성명 HTML 특수문자 — esc 이스케이프 적용 (FO-69)', () => {
  setInspectorName('김<b>철수');
  const html = buildAuditReportHtml(collectAuditReportData(NOW));
  assert.ok(!html.includes('김<b>철수'));
  assert.ok(html.includes('김&lt;b&gt;철수 (인)'));
});

/* =======================================================
   인쇄 여백 규약 — @page margin:0 대응 (print.css, FO-21)
   ======================================================= */

test('print.css — fp-doc 페이지 여백이 매뉴얼과 동일 규약 (10mm 8mm + clone)', () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const css = readFileSync(join(ROOT, 'css', 'print.css'), 'utf-8');
  // @page{margin:0} — 문서 패딩이 페이지 여백을 대신한다 (manual-ov-scroll과 동일)
  assert.match(css, /\.fp-doc\s*\{[^}]*padding:\s*10mm 8mm/, 'fp-doc 좌우 8mm 패딩');
  // clone: 패딩을 페이지 조각마다 반복해 연속 페이지 상하 여백 유지
  assert.match(css, /\.fp-doc\s*\{[^}]*box-decoration-break:\s*clone/, '페이지 조각별 여백 반복');
});

test('print.css — fp-table 좌측선은 첫 셀 경계로 그림 (조각 꼬리 방지)', () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const css = readFileSync(join(ROOT, 'css', 'print.css'), 'utf-8');
  const tableRule = css.match(/\.fp-table\s*\{([^}]*)\}/);
  assert.ok(tableRule, 'fp-table 규칙 존재');
  // 표 박스 border-left는 clone 조각 끝까지 그려져 마지막 행 아래로 꼬리가 생김 → 금지
  assert.ok(!/border-left/.test(tableRule[1]), 'fp-table에 border-left 없음');
  // 좌측선은 각 행의 첫 셀이 그려 행 단위로 끝남 (페이지 조각과 무관)
  assert.match(css, /\.fp-table\s+(?:th|td):first-child/, '첫 셀 border-left 규칙 존재');
});
