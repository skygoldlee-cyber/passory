// Formula OS — 종합 규정 점검 보고서 수집기 (FO-56)
// @spec FO-56,FO-59,FO-63
// 사업 유형별 법규 점검 자산(체크리스트·표시사항·광고 점검·포뮬러 검증·
// 조제 기록·원료 기한·고객 상담·이상사례)을 출력 순간 라이브 수집해 fp-doc 보고서로 산출.
// 보고서 결과 자체는 저장하지 않는다 — 출력이 곧 스냅샷 (설계 DOC-DSN-14).
// 단 출력 이력(FO-63)은 점수 요약 메타데이터만 FORMULA_AUDIT_LOG에 남긴다.
// 섹션 범위는 BIZ_PANELS/bizVisible 게이트 재사용 — 유형에 안 맞는 섹션은 자동 제외.

import { getJSON, setJSON } from '../../../storage.js';
import { STORAGE_KEYS } from '../../../storage-keys.js';
import { getBizType, BIZ_TYPES, bizVisible, bizChecklistSet } from '../biz-profile.js';
import { CHECKLIST_SETS, LAW_DOCS, loadChecks } from './formula-compliance.js';
import { summarizeLabelDraft } from './formula-sales.js';
import { listFormulas } from '../formula-store.js';
import { listBatches } from '../batch-store.js';
import { listMaterials, materialStatus } from '../material-ledger.js';
import { listCustomers } from '../customer-store.js';
import { listAdverse } from '../adverse-store.js';
import { checkFormulaItems, countChangedStandards } from '../formula-check.js';
import { evaluateStability, STAB } from '../formula-stability.js';
import { getIndex } from './formula.js';
import { buildAuditReportHtml, printHtml, batchQcSummary } from './formula-print.js';
import { localDateTime } from '../store-utils.js';

const RECENT_BATCH_MAX = 10;   // 최근 배치 목록 상한 — 판매내역 증적
const CONSULT_RECENT_MAX = 3;  // 고객별 최근 상담 이력 상한 (설계 §9-4)
const ADLINT_TEXT_MAX = 2000;  // 점검 대상 원문 상한 — 초과분 절단 표기 (설계 §9-1)
const ADVERSE_RECENT_MAX = 5;  // 이상사례 최근 목록 상한 (FO-59)
const AUDIT_LOG_MAX = 20;      // 보고서 출력 이력 상한 (FO-63)

/* =======================================================
   섹션 수집기 — 각각 {id,title,summary,empty,...payload} 반환
   ======================================================= */

/** ① 법규 준수 체크리스트 — 활성 세트 전 항목 + 점검일 + 근거 문서 라벨 */
function collectChecklist(set, checked) {
  let done = 0; let total = 0;
  const groups = set.sections.map(sec => ({
    title: sec.title,
    items: sec.items.map(it => {
      total++;
      const at = checked[it.id];
      if (at) done++;
      return {
        text: it.text,
        note: it.note || '',
        done: !!at,
        doneAt: at ? String(at).slice(0, 10) : null,
        refs: (it.refs || []).map(k => (LAW_DOCS[k] ? LAW_DOCS[k].label : k)).filter(Boolean),
      };
    }),
  }));
  return {
    id: 'checklist', title: '법규 준수 체크리스트',
    summary: `${done}/${total} 항목 점검${total - done ? ` — 미점검 ${total - done}항목` : ' (전 항목 완료)'}`,
    empty: false, groups, done, total,
  };
}

/** ② 표시사항 자가점검 — 드래프트 재요약 (mfg·sales) */
function collectLabel() {
  const draft = getJSON(STORAGE_KEYS.FORMULA_LABEL_DRAFT);
  const has = draft && typeof draft === 'object'
    && Object.keys(draft).some(k => draft[k]);
  if (!has) {
    return { id: 'label', title: '표시사항 자가점검', summary: '기록 없음 — 해당 점검 미실시', empty: true };
  }
  const { checks, missing } = summarizeLabelDraft(draft);
  const filled = checks.filter(c => c.ok).length;
  return {
    id: 'label', title: '표시사항 자가점검',
    summary: `${filled}/${checks.length} 기재${missing ? ` — 필수 미기재 ${missing}항목` : ' — 필수 기재 완료'}`,
    empty: false, checks, missing,
  };
}

/** ③ 광고 문구 점검 — FORMULA_ADLINT_STATE 최근 1건 (mfg·sales) */
function collectAdlint() {
  const s = getJSON(STORAGE_KEYS.FORMULA_ADLINT_STATE);
  if (!s || typeof s !== 'object' || !Array.isArray(s.hits)) {
    return { id: 'adlint', title: '광고 문구 점검', summary: '기록 없음 — 최근 점검 없음', empty: true };
  }
  const text = typeof s.text === 'string' ? s.text : '';
  return {
    id: 'adlint', title: '광고 문구 점검',
    summary: `최근 점검 ${String(s.at || '').slice(0, 10) || '—'} — ${s.hits.length ? `적발 ${s.hits.length}건` : '적발 없음'}`,
    empty: false,
    at: s.at || '',
    text: text.slice(0, ADLINT_TEXT_MAX),
    truncated: text.length > ADLINT_TEXT_MAX,
    hits: s.hits.map(h => ({
      term: h.term || '', category: h.category || '',
      label: h.label || '', suggestion: h.suggestion || '',
    })),
  };
}

/** ④ 포뮬러 규정 검증 — My 포뮬러 전 건 라이브 재검증 (custom·mfg) */
function collectFormulas() {
  const formulas = listFormulas();
  if (!formulas.length) {
    return { id: 'formulas', title: '포뮬러 규정 검증', summary: '기록 없음 — 저장된 포뮬러 없음', empty: true };
  }
  const index = getIndex();
  const items = formulas.map(f => {
    const { summary } = checkFormulaItems(
      (f.ingredients || []).map(i => ({ name: i.name, concentration: i.concentration })), index);
    const changed = countChangedStandards(f, index);
    const stab = evaluateStability(f.ingredients || [], index, {
      formulation: f.customer && f.customer.formulation,
      phTarget: f.phTarget,
      phActual: f.phActual,
      steps: f.steps,
    });
    return {
      name: f.name || '(이름 없음)',
      summary,
      changed,
      stabWarns: stab.warnings.filter(w => w.level === STAB.WARN).length,
    };
  });
  const totals = items.reduce((acc, it) => {
    acc.ok += it.summary.ok; acc.warn += it.summary.warn;
    acc.banned += it.summary.banned; acc.unknown += it.summary.unknown;
    return acc;
  }, { ok: 0, warn: 0, banned: 0, unknown: 0 });
  return {
    id: 'formulas', title: '포뮬러 규정 검증',
    summary: `저장 ${items.length}건 — 금지 ${totals.banned}·초과 ${totals.warn}·확인 필요 ${totals.unknown}·정상 ${totals.ok}`,
    empty: false, items, totals,
  };
}

/** ⑤ 조제·제조 기록 — 요약 + 최근 배치 목록 (custom·mfg) */
function collectBatches() {
  const batches = listBatches();
  if (!batches.length) {
    return { id: 'batches', title: '조제·제조 기록', summary: '기록 없음 — 조제 기록 없음', empty: true };
  }
  let qcBad = 0; let hygIncomplete = 0;
  for (const b of batches) {
    const s = batchQcSummary(b);
    if (s.bad.length) qcBad++;
    if (s.hygDone < s.hygTotal) hygIncomplete++;
  }
  return {
    id: 'batches', title: '조제·제조 기록',
    summary: `배치 ${batches.length}건 — QC 이상 ${qcBad}·위생 미완료 ${hygIncomplete}`,
    empty: false,
    total: batches.length, qcBad, hygIncomplete,
    latestAt: batches[0] && batches[0].madeAt ? batches[0].madeAt : '',
    recent: batches.slice(0, RECENT_BATCH_MAX).map(b => ({
      batchNo: b.batchNo || '', formulaName: b.formulaName || '',
      customerName: b.customerName || '', madeAt: b.madeAt || '',
    })),
  };
}

/** ⑥ 원료 기한 관리 — 기한 상태 집계 (custom·mfg) */
function collectMaterials() {
  const mats = listMaterials();
  if (!mats.length) {
    return { id: 'materials', title: '원료 기한 관리', summary: '기록 없음 — 등록 원료 없음', empty: true };
  }
  const counts = { expired: 0, soon: 0, ok: 0, none: 0 };
  for (const m of mats) counts[materialStatus(m)]++;
  return {
    id: 'materials', title: '원료 기한 관리',
    summary: `등록 ${mats.length}종 — 경과 ${counts.expired}·임박 ${counts.soon}`,
    empty: false, total: mats.length, counts,
  };
}

/** ⑦ 고객 상담 기록 — 고객별 행 + 최근 상담 이력 (custom·sales) */
function collectCustomers() {
  const customers = listCustomers();
  if (!customers.length) {
    return { id: 'customers', title: '고객 상담 기록', summary: '기록 없음 — 고객 카드 없음', empty: true };
  }
  let logTotal = 0;
  const rows = customers.map(c => {
    const logs = Array.isArray(c.consultLog) ? c.consultLog : [];
    logTotal += logs.length;
    return {
      name: c.name || '(이름 없음)',
      skinType: c.skinType || '',
      allergies: Array.isArray(c.allergies) ? c.allergies : [],
      logCount: logs.length,
      lastDate: logs.length && logs[logs.length - 1].date ? logs[logs.length - 1].date : '',
      recent: logs.slice(-CONSULT_RECENT_MAX).reverse()
        .map(l => ({ date: l.date || '', text: l.text || '' })),
    };
  });
  return {
    id: 'customers', title: '고객 상담 기록',
    summary: `고객 ${customers.length}명 — 상담 이력 ${logTotal}건`,
    empty: false, total: customers.length, logTotal, rows,
  };
}

/** 소비자 이상사례 기록 (FO-59) — 전 유형 공통, 위해사례 대응 증적 */
function collectAdverse() {
  const items = listAdverse();
  if (!items.length) {
    return { id: 'adverse', title: '소비자 이상사례 기록', summary: '기록 없음 — 이상사례 접수 없음', empty: true };
  }
  const reported = items.filter(a => a.reportedAt).length;
  return {
    id: 'adverse', title: '소비자 이상사례 기록',
    summary: `${items.length}건 기록 — 관계기관 보고 ${reported}건`,
    empty: false, total: items.length, reported,
    recent: items.slice(0, ADVERSE_RECENT_MAX).map(a => ({
      occurredAt: a.occurredAt || '', customerName: a.customerName || '',
      product: a.product || '', symptoms: a.symptoms || '',
      action: a.action || '', reportedAt: a.reportedAt || '',
    })),
  };
}

/* =======================================================
   보고서 출력 이력 (FO-63) — 출력 시점의 점수 요약만 보존.
   본문(고객 개인정보)은 저장하지 않는다 — 메타데이터 최소화.
   ======================================================= */

/** 이력 조회 — 최신순, 컴플라이언스 패널 표시용 */
export function listAuditLog() {
  const log = getJSON(STORAGE_KEYS.FORMULA_AUDIT_LOG);
  return Array.isArray(log) ? log : [];
}

/**
 * 출력 이력 1건 기록 — auditPrintReport가 수집 직후 호출.
 * @param {object} d - collectAuditReportData() 반환값
 */
export function recordAuditLog(d) {
  const checklist = d.sections.find(s => s.id === 'checklist');
  const entry = {
    at: d.generatedAt,
    bizId: d.biz && d.biz.id, bizLabel: d.biz && d.biz.label,
    setLabel: d.setLabel || '',
    done: checklist ? checklist.done : 0,
    total: checklist ? checklist.total : 0,
    sections: d.sections.length,
  };
  const log = [entry, ...listAuditLog()].slice(0, AUDIT_LOG_MAX);
  setJSON(STORAGE_KEYS.FORMULA_AUDIT_LOG, log);
  return entry;
}

/* =======================================================
   공개 API
   ======================================================= */

/**
 * 보고서 뷰모델 수집 — 출력 순간 라이브 스냅샷.
 * 유형 게이트는 BIZ_PANELS 선언을 재사용하며, 데이터 없는 섹션은
 * '기록 없음'으로 유지한다 (미실시 자체가 증적).
 * @param {Date} [now] - 기준 시각 (테스트 주입용)
 */
export function collectAuditReportData(now) {
  const biz = BIZ_TYPES[getBizType()] || BIZ_TYPES.custom;
  const set = CHECKLIST_SETS[bizChecklistSet(biz.id)] || CHECKLIST_SETS.custom;
  const checked = loadChecks(set);

  /** @type {Array<object>} */
  const sections = [];
  // 섹션 게이트 — 패널 가시(bizVisible)면 미실시도 '기록 없음'으로 표기,
  // 패널이 숨겨져도 잔존 데이터가 있으면 감사 증적이므로 비대상 표기로 포함한다.
  const pushIf = (panel, s) => {
    if (bizVisible(panel, biz.id)) { sections.push(s); return; }
    if (!s.empty) { s.summary += ' — 현재 사업 유형 비대상 잔존 데이터'; sections.push(s); }
  };
  // 순서 — 고객 정보가 맨 앞, 법규 준수 체크리스트가 맨 뒤 (실무 증적 → 준수 확인 결론)
  pushIf('customer', collectCustomers());
  pushIf('adverse', collectAdverse());   // 미선언 패널 — 전 유형 공통 (FO-59)
  pushIf('label', collectLabel());
  pushIf('adlint', collectAdlint());
  pushIf('calc', collectFormulas());
  pushIf('batch', collectBatches());
  pushIf('material', collectMaterials());
  sections.push(collectChecklist(set, checked));

  return {
    generatedAt: localDateTime(now instanceof Date ? now : new Date()),
    appVersion: (typeof window !== 'undefined' && window.APP_VERSION) || '',
    biz,
    setLabel: set.label,
    sections,
  };
}

/** 종합 보고서 출력 — 수집 → 이력 기록(FO-63) → fp-doc 렌더 → print */
export function auditPrintReport() {
  const data = collectAuditReportData();
  recordAuditLog(data);
  printHtml(buildAuditReportHtml(data));
}
