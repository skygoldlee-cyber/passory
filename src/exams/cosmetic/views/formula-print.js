// src/exams/cosmetic/views/formula-print.js — Formula OS 인쇄 산출물 빌더 (Phase A)
// @spec FO-14,FO-21,FO-29,FO-56,FO-57,FO-58,FO-60,FO-69
//
// 조제 기록지(배치)·제품 라벨·사용 안내문·작업지시서 HTML 생성 + 공용 인쇄 트리거.
// 기존 formula.js의 조제 기록지와 같은 #formula-print-area + body.formula-printing
// 메커니즘을 재사용한다 (print.css의 fp-* 규칙 + fp-label 신설).

import { esc } from '../../../sanitize.js';
import { todayKey } from '../../../utils.js';
import { QC_FIELDS, HYGIENE_FIELDS } from '../batch-store.js';
import { PHASE_OPTIONS } from '../formula-store.js';
import { buildUsageGuideFromBatch } from '../usage-guide.js';
import { fmtLocalDateTime } from '../store-utils.js';

const QC_BADGE = { '정상': '○', '이상': '✕', '미확인': '—' };

function fmtDateTime(v) {
  return typeof v === 'string' && v ? v.replace('T', ' ') : '—';
}

function fmtDate(v) {
  return typeof v === 'string' && v ? v : '—';
}

/** 배치 QC·위생 요약 텍스트 — 카드·인쇄 공용 */
export function batchQcSummary(b) {
  const qc = b && b.qc ? b.qc : {};
  const bad = QC_FIELDS.filter(f => qc[f.key] === '이상').map(f => f.label);
  const unchecked = QC_FIELDS.filter(f => !qc[f.key]).length;
  const hyg = b && b.hygiene ? b.hygiene : {};
  const hygDone = HYGIENE_FIELDS.filter(f => hyg[f.key]).length;
  return { bad, unchecked, hygDone, hygTotal: HYGIENE_FIELDS.length };
}

/** 조제 기록지(배치) — 회차 기록 + QC·위생 + 검증 스냅샷 */
export function buildBatchRecordHtml(b) {
  const qcRows = QC_FIELDS.map(f => {
    const v = b.qc && b.qc[f.key] ? b.qc[f.key] : '';
    const cls = v === '이상' ? 'fp-qc-bad' : (v === '정상' ? 'fp-qc-ok' : '');
    return `<tr><td>${esc(f.label)}</td><td class="${cls}">${v ? `${QC_BADGE[v]} ${esc(v)}` : '미기록'}</td></tr>`;
  }).join('')
    + (b.phMeasured != null ? `<tr><td>실측 pH</td><td>${esc(String(b.phMeasured))}</td></tr>` : '');
  const hygItems = HYGIENE_FIELDS.map(f => {
    const done = !!(b.hygiene && b.hygiene[f.key]);
    return `<li>${done ? '☑' : '☐'} ${esc(f.label)}</li>`;
  }).join('');
  const snap = b.checkSnapshot;
  const snapParts = snap
    ? [`정상 ${snap.ok}`, snap.warn ? `초과 ${snap.warn}` : '', snap.banned ? `금지 ${snap.banned}` : '',
       snap.unknown ? `확인 필요 ${snap.unknown}` : '', snap.stabWarn ? `안정성 경고 ${snap.stabWarn}` : '',
       snap.dbVersion ? `원료 DB v${snap.dbVersion}` : '']
      .filter(Boolean).join(' · ')
    : '';

  return `
    <div class="fp-doc">
      <h1>조제 기록 — ${esc(b.batchNo || '')}</h1>
      <p class="fp-meta-line">처방: ${esc(b.formulaName || '—')} · 조제 일시: ${esc(fmtDateTime(b.madeAt))}</p>
      <p class="fp-meta-line">고객: ${esc(b.customerName || '—')} · 제조량: ${b.targetVolume != null ? `${b.targetVolume}${b.unit || 'g'}` : '—'} · 권장 사용기한: ${esc(fmtDate(b.expiryAt))} · 인도일: ${esc(fmtDate(b.deliveredAt))}</p>
      ${b.formulation ? `<p class="fp-meta-line">제형: ${esc(b.formulation)}</p>` : ''}
      ${b.disposition ? `<p class="fp-meta-line">QC 이상 조치: ${esc(b.disposition)}</p>` : ''}
      <h3>품질 확인 (회차)</h3>
      <table class="fp-table"><tbody>${qcRows}</tbody></table>
      <h3>위생·안전 확인</h3>
      <ul class="fp-steps">${hygItems}</ul>
      ${b.fullIngredients && b.fullIngredients.length ? `<h3>전성분 표시</h3><p class="fp-meta-line fp-inci">${esc(b.fullIngredients.join(', '))}</p>` : ''}
      ${b.materialLots && b.materialLots.length ? `<h3>사용 원료 LOT</h3><p class="fp-meta-line">${esc(b.materialLots.map(l => `${l.name} (LOT ${l.lot || '—'})`).join(' · '))}</p>` : ''}
      ${snapParts ? `<h3>규정 검증 (조제 시점 스냅샷)</h3><p class="fp-meta-line">${esc(snapParts)}</p>` : ''}
      ${b.notes ? `<h3>메모</h3><p class="fp-notes">${esc(b.notes)}</p>` : ''}
      <div class="fp-sign-row">
        <span class="fp-sign">조제자(조제관리사): ______________</span>
        <span class="fp-sign">확인자: ______________</span>
        <span class="fp-sign">확인일: ________</span>
      </div>
      <p class="fp-disclaimer">검증 결과는 법정 배합 한도 기준일 뿐 제품의 안전성·안정성·품질을 보장하지 않습니다.</p>
    </div>`;
}

/** 제품 라벨 — 전성분·조제일·사용기한·주의사항 (소형 라벨 레이아웃) */
export function buildLabelHtml(b) {
  const inci = (b.fullIngredients && b.fullIngredients.length)
    ? b.fullIngredients.join(', ')
    : '(전성분 미생성 — 처방에서 안정성 "양호" 확인 후 저장 필요)';
  return `
    <div class="fp-label">
      <div class="fp-label-name">${esc(b.formulaName || '(이름 없음)')}</div>
      <div class="fp-label-line">배치번호 ${esc(b.batchNo || '—')} · 조제일 ${esc(fmtDate(b.madeAt ? b.madeAt.slice(0, 10) : ''))}</div>
      <div class="fp-label-line">내용량 ${b.targetVolume != null ? `${b.targetVolume}${b.unit || 'g'}` : '—'} · 권장 사용기한 ${esc(fmtDate(b.expiryAt))}</div>
      ${b.customerName ? `<div class="fp-label-line">고객 ${esc(b.customerName)}</div>` : ''}
      <div class="fp-label-inci"><span class="fp-label-cap">전성분</span> ${esc(inci)}</div>
      <div class="fp-label-caution">맞춤형화장품 — 표시된 고객 외 사용 금지 · 이상 시 사용 중지</div>
    </div>`;
}

/** 사용 안내문 — 제형별 사용법·보관법·주의사항 */
export function buildGuideHtml(b) {
  const g = buildUsageGuideFromBatch(b);
  return `
    <div class="fp-doc">
      <h1>사용 안내문 — ${esc(b.formulaName || '(이름 없음)')}</h1>
      <p class="fp-meta-line">배치번호 ${esc(b.batchNo || '—')} · 권장 사용기한 ${esc(fmtDate(b.expiryAt))}</p>
      ${b.customerName ? `<p class="fp-meta-line">고객: ${esc(b.customerName)}</p>` : ''}
      <h3>사용법</h3><p class="fp-notes">${esc(g.directions)}</p>
      <h3>보관 방법</h3><p class="fp-notes">${esc(g.storage)}</p>
      <h3>주의사항</h3>
      <ul class="fp-steps">${g.cautions.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
    </div>`;
}

/**
 * 작업지시서 (FO-29) — 계량 현장용 A4 문서.
 * 제조 단계(PHASE_OPTIONS)별로 원료를 묶고, 계량 체크란(☐)·LOT 기입란·확인란을 둔다.
 * @param {object} f - {name, targetVolume, unit, ingredients:[{name,concentration,phase}], steps[]}
 */
export function buildWorkOrderHtml(f) {
  const unit = f.unit || 'g';
  const ings = Array.isArray(f.ingredients) ? f.ingredients.filter(i => i && i.name) : [];
  const amount = c => (f.targetVolume != null && c != null)
    ? `${(Math.round(f.targetVolume * c) / 100).toFixed(2)}${unit}` : '—';
  const groups = PHASE_OPTIONS
    .map(phase => ({ phase, items: ings.filter(i => (i.phase || '기타') === phase) }))
    .filter(g => g.items.length);
  const rows = groups.map(g => `
      <tr><td colspan="5" class="fp-phase-head">${esc(g.phase)}</td></tr>
      ${g.items.map(i => `
      <tr>
        <td class="fp-check-cell">☐</td>
        <td>${esc(i.name)}</td>
        <td class="fp-num">${i.concentration != null ? `${i.concentration}%` : '—'}</td>
        <td class="fp-num">${esc(amount(i.concentration))}</td>
        <td class="fp-lot-cell"></td>
      </tr>`).join('')}`).join('');
  const steps = (Array.isArray(f.steps) ? f.steps : []).filter(Boolean);
  return `
    <div class="fp-doc">
      <h1>작업지시서 — ${esc(f.name || '(이름 없음)')}</h1>
      <p class="fp-meta-line">총 제조량: ${f.targetVolume != null ? `${f.targetVolume}${unit}` : '—'} · 발행일: ${esc(todayKey())}</p>
      <h3>계량표</h3>
      <table class="fp-table">
        <thead><tr><th class="fp-check-cell">✓</th><th>원료</th><th class="fp-num">배합률</th><th class="fp-num">투입량</th><th>LOT</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${steps.length ? `<h3>제조 절차</h3><ol class="fp-steps">${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
      <div class="fp-sign-row">
        <span class="fp-sign">계량자: ______________</span>
        <span class="fp-sign">확인자: ______________</span>
        <span class="fp-sign">확인일: ________</span>
      </div>
      <p class="fp-disclaimer">배합률은 작업자 입력값이며 검증 결과는 법정 한도 기준입니다. 계량 후 체크란에 표시하고 사용 원료의 LOT를 기입하세요.</p>
    </div>`;
}

/* =======================================================
   종합 규정 점검 보고서 (FO-56) — 수집 뷰모델 → fp-doc A4 문서
   섹션은 수집기(formula-audit.js)가 bizVisible 게이트를 적용해
   이미 걸러진 상태로 온다. 설계: docs/dev/design/AUDIT_REPORT_DESIGN.md
   ======================================================= */

const AUDIT_SECTION_MARK = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];

function auditFmtDateTime(v) {
  return fmtLocalDateTime(v);
}

function auditChecklistBody(s) {
  const rows = s.groups.map(g => {
    const doneN = g.items.filter(i => i.done).length;
    // 미점검 항목은 note·근거를 생략해 한 줄로 압축 — 상세 증적은 점검 완료 항목에만 남긴다
    const items = g.items.map(it => it.done
      ? `<tr>
      <td class="fp-check-cell">☑</td>
      <td>${esc(it.text)}${it.note ? `<br><span class="fp-meta-line">${esc(it.note)}</span>` : ''}${it.refs && it.refs.length ? `<br><span class="fp-meta-line">근거: ${esc(it.refs.join(' · '))}</span>` : ''}</td>
      <td class="fp-num">${esc(it.doneAt || '')}</td>
    </tr>`
      : `<tr>
      <td class="fp-check-cell">☐</td>
      <td>${esc(it.text)}</td>
      <td class="fp-num">미점검</td>
    </tr>`).join('');
    return `<tr><td colspan="3" class="fp-phase-head">${esc(g.title)} (${doneN}/${g.items.length})</td></tr>${items}`;
  }).join('');
  return `<table class="fp-table"><tbody>${rows}</tbody></table>`;
}

function auditLabelBody(s) {
  const rows = s.checks.map(c => `<tr>
    <td class="fp-check-cell">${c.ok ? '☑' : '☐'}</td>
    <td>${esc(c.label)}${c.manual ? ' (수동 확인)' : (c.optional ? ' (해당 시)' : '')}</td>
  </tr>`).join('');
  return `<table class="fp-table"><tbody>${rows}</tbody></table>`;
}

function auditAdlintBody(s) {
  const hitRows = s.hits.map(h => `<tr>
    <td>${esc(h.label || h.category)}</td><td>"${esc(h.term)}"</td><td>${esc(h.suggestion || '—')}</td>
  </tr>`).join('');
  return `${s.hits.length
    ? `<table class="fp-table"><thead><tr><th>분류</th><th>적발 표현</th><th>수정 가이드</th></tr></thead><tbody>${hitRows}</tbody></table>`
    : '<p class="fp-meta-line">금지 표현이 적발되지 않았습니다.</p>'}
    ${s.text ? `<h3>점검 대상 원문</h3><p class="fp-notes">${esc(s.text)}${s.truncated ? ' …(이하 생략)' : ''}</p>` : ''}`;
}

function auditFormulasBody(s) {
  const rows = s.items.map(it => `<tr>
    <td>${esc(it.name)}</td>
    <td class="fp-num">${it.summary.banned || '—'}</td>
    <td class="fp-num">${it.summary.warn || '—'}</td>
    <td class="fp-num">${it.summary.unknown || '—'}</td>
    <td class="fp-num">${it.summary.ok || '—'}</td>
    <td class="fp-num">${it.changed || '—'}</td>
    <td class="fp-num">${it.stabWarns || '—'}</td>
  </tr>`).join('');
  return `<table class="fp-table">
    <thead><tr><th>포뮬러</th><th class="fp-num">금지</th><th class="fp-num">초과</th><th class="fp-num">확인</th><th class="fp-num">정상</th><th class="fp-num">기준변경</th><th class="fp-num">안정성</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="fp-meta-line">기준변경 = 저장 후 고시 기준이 바뀐 원료 수 · 안정성 = 제형 안정성 경고 수</p>`;
}

function auditBatchesBody(s) {
  const rows = s.recent.map(b => `<tr>
    <td>${esc(b.batchNo || '—')}</td><td>${esc(b.formulaName || '—')}</td>
    <td>${esc(b.customerName || '—')}</td><td>${esc(auditFmtDateTime(b.madeAt))}</td>
  </tr>`).join('');
  return `<p class="fp-meta-line">최근 배치일: ${esc(auditFmtDateTime(s.latestAt))} · QC 이상 ${s.qcBad}건 · 위생 미완료 ${s.hygIncomplete}건</p>
    <table class="fp-table">
    <thead><tr><th>배치번호</th><th>처방</th><th>고객</th><th>조제 일시</th></tr></thead>
    <tbody>${rows}</tbody></table>
    ${s.total > s.recent.length ? `<p class="fp-meta-line">최근 ${s.recent.length}건만 표시 — 전체 ${s.total}건</p>` : ''}`;
}

function auditMaterialsBody(s) {
  return `<table class="fp-table"><tbody>
    <tr><td>등록 원료</td><td class="fp-num">${s.total}종</td></tr>
    <tr><td>기한 경과</td><td class="fp-num">${s.counts.expired}종</td></tr>
    <tr><td>기한 임박 (30일 이내)</td><td class="fp-num">${s.counts.soon}종</td></tr>
    <tr><td>정상</td><td class="fp-num">${s.counts.ok}종</td></tr>
    <tr><td>기한 미기재</td><td class="fp-num">${s.counts.none}종</td></tr>
  </tbody></table>`;
}

function auditCustomersBody(s) {
  const rows = s.rows.map(r => `<tr>
    <td>${esc(r.name)}</td><td>${esc(r.skinType || '—')}</td>
    <td>${esc(r.allergies.length ? r.allergies.join(', ') : '—')}</td>
    <td class="fp-num">${r.logCount}</td><td>${esc(r.lastDate || '—')}</td>
  </tr>`).join('');
  const logs = s.rows.flatMap(r =>
    r.recent.map(l => `<li>${esc(r.name)} — ${esc(l.date)} · ${esc(l.text)}</li>`)).join('');
  return `<table class="fp-table">
    <thead><tr><th>고객</th><th>피부타입</th><th>알레르기</th><th class="fp-num">상담</th><th>최근 상담일</th></tr></thead>
    <tbody>${rows}</tbody></table>
    ${logs ? `<h3>최근 상담 이력 (고객별 최대 3건)</h3><ul class="fp-steps">${logs}</ul>` : ''}`;
}

function auditAdverseBody(s) {
  const rows = s.recent.map(a => `<tr>
    <td>${esc(a.occurredAt || '—')}</td><td>${esc(a.customerName || '—')}</td>
    <td>${esc(a.product || '—')}</td><td>${esc(a.symptoms || '—')}</td>
    <td>${esc(a.reportedAt || '미보고')}</td>
  </tr>`).join('');
  return `<p class="fp-meta-line">총 ${s.total}건 — 관계기관 보고 ${s.reported}건</p>
    <table class="fp-table">
    <thead><tr><th>발생일</th><th>고객</th><th>제품</th><th>증상</th><th>보고일</th></tr></thead>
    <tbody>${rows}</tbody></table>
    ${s.total > s.recent.length ? `<p class="fp-meta-line">최근 ${s.recent.length}건만 표시 — 전체 ${s.total}건</p>` : ''}`;
}

const AUDIT_BODY = {
  checklist: auditChecklistBody,
  label: auditLabelBody,
  adlint: auditAdlintBody,
  formulas: auditFormulasBody,
  batches: auditBatchesBody,
  materials: auditMaterialsBody,
  customers: auditCustomersBody,
  adverse: auditAdverseBody,
};

/**
 * 종합 규정 점검 보고서 (FO-56) — collectAuditReportData() 뷰모델 → fp-doc.
 * @param {object} d - {generatedAt, appVersion, biz:{label,desc}, setLabel, sections:[],
 *   id, hash, notice:{notice,ruleName,effectiveDate,checkedAt,isNewer}|null, printedBy, inspector}
 */
export function buildAuditReportHtml(d) {
  const scoreRows = d.sections
    .map(s => `<tr><td>${esc(s.title)}</td><td>${esc(s.summary)}</td></tr>`).join('');
  const body = d.sections.map((s, i) => {
    const mark = AUDIT_SECTION_MARK[i] || '·';
    const render = AUDIT_BODY[s.id];
    const content = s.empty
      ? `<p class="fp-meta-line">${esc(s.summary)}</p>`
      : (render ? render(s) : '');
    return `<h3>${mark} ${esc(s.title)}</h3>${content}`;
  }).join('');
  // FO-64 — 기준 고시 스탬프. 원격 상태 미로드(오프라인)면 '확인 불가'로 명시한다.
  const n = d.notice;
  const noticeLine = n
    ? `기준 고시: ${esc(n.ruleName)} ${esc(n.notice)}`
      + `${n.effectiveDate ? ` (시행 ${esc(n.effectiveDate)})` : ''}`
      + ` · 고시 확인 ${n.checkedAt ? esc(n.checkedAt) : '미확인'}`
      + `${n.isNewer ? ' — ⚠ 신규 고시 개정 확인 필요' : ''}`
    : '기준 고시: 확인 불가 — 고시 상태를 불러오지 못했습니다 (오프라인·네트워크 확인)';
  // FO-66 — 출력물↔이력 대조·변조 감지용 식별자/해시. FO-67 — 출력 기록(기기 흔적).
  const idLine = `문서 번호: ${esc(d.id || '—')} · 내용 해시: ${esc(d.hash || '—')}`
    + `${d.printedBy ? ` · 출력 환경: ${esc(d.printedBy)}` : ''}`;
  return `<div class="fp-doc">
    <h1>종합 점검 보고서</h1>
    <p class="fp-meta-line">사업 유형: ${esc(d.biz.label)} — ${esc(d.biz.desc)}</p>
    <p class="fp-meta-line">점검 기준: ${esc(d.setLabel)} · 발행일시: ${esc(auditFmtDateTime(d.generatedAt))}${d.appVersion ? ` · 앱 ${esc(d.appVersion)}` : ''}</p>
    <p class="fp-meta-line">${noticeLine}</p>
    <p class="fp-meta-line fp-doc-id">${idLine}</p>
    <h3>점검 요약</h3>
    <table class="fp-table"><tbody>${scoreRows}</tbody></table>
    ${body}
    <div class="fp-sign-row">
      <span class="fp-sign">점검자(조제관리사/책임판매관리자): ${d.inspector ? `${esc(d.inspector)} (인)` : '______________'}</span>
      <span class="fp-sign">확인자: ______________</span>
      <span class="fp-sign">확인일: ________</span>
    </div>
    <p class="fp-meta-line fp-sign-record">서명 기록 — 출력일시 ${esc(auditFmtDateTime(d.generatedAt))} · 출력 환경 ${esc(d.printedBy || '—')} · 문서 ${esc(d.id || '—')}</p>
    <p class="fp-disclaimer">본 보고서는 자가점검용 참고 자료이며 법률 자문이 아닙니다. 실제 의무·기준의 판단은 법령 원문과 관할 지방식약청 안내를 따르세요.</p>
    <p class="fp-disclaimer">본 문서에는 고객 개인정보(이름·피부 정보·상담 내용)가 포함될 수 있습니다 — 출력물의 보관·폐기에 주의하세요.</p>
  </div>`;
}

/* =======================================================
   실무 증적 문서 (FO-57~60) — LOT 추적·판매내역서·고객 동의서
   ======================================================= */

/**
 * 원료 LOT 역추적 목록 (FO-57) — 해당 원료를 사용한 배치와 인도 고객.
 * 위해사례·리콜 상황의 대상 고객 특정용.
 * @param {object} q - {material:{name,lot}, batches:[{batchNo,formulaName,customerName,madeAt,deliveredAt}]}
 */
export function buildRecallListHtml(q) {
  const m = q.material || {};
  const batches = Array.isArray(q.batches) ? q.batches : [];
  const rows = batches.map(b => `<tr>
    <td>${esc(b.batchNo || '—')}</td><td>${esc(b.formulaName || '—')}</td>
    <td>${esc(b.customerName || '—')}</td><td>${esc(auditFmtDateTime(b.madeAt))}</td>
    <td>${esc(b.deliveredAt || '미인도')}</td>
  </tr>`).join('');
  return `<div class="fp-doc">
    <h1>원료 LOT 사용 추적</h1>
    <p class="fp-meta-line">원료: ${esc(m.name || '—')}${m.lot ? ` · LOT ${esc(m.lot)}` : ''} · 조회일: ${esc(todayKey())} · 대상 배치 ${batches.length}건</p>
    ${batches.length ? `<table class="fp-table">
      <thead><tr><th>배치번호</th><th>처방·제품</th><th>인도 고객</th><th>조제 일시</th><th>인도일</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p class="fp-meta-line">상기 고객에게 해당 원료 사용 제품의 인도 이력이 있습니다 — 위해사례·회수 시 연락 대상 목록으로 활용하세요.</p>`
    : '<p class="fp-meta-line">해당 원료를 사용한 조제 기록이 없습니다.</p>'}
    <p class="fp-disclaimer">추적 결과는 장부 LOT 선택 기록 기준이며, LOT 미기록 배치는 포함되지 않습니다.</p>
  </div>`;
}

/**
 * 판매내역서 (FO-58) — 인도 완료(deliveredAt 기재) 배치 목록.
 * 맞춤형화장품 판매내역 기록·보존 근거 문서.
 * @param {object[]} batches - 인도 완료 배치 (deliveredAt 내림차순 권장)
 */
export function buildSalesRecordHtml(batches) {
  const list = Array.isArray(batches) ? batches : [];
  const rows = list.map(b => `<tr>
    <td>${esc(b.deliveredAt || '—')}</td><td>${esc(b.batchNo || '—')}</td>
    <td>${esc(b.formulaName || '—')}</td><td>${esc(b.customerName || '—')}</td>
    <td class="fp-num">${b.targetVolume != null ? `${b.targetVolume}${b.unit || 'g'}` : '—'}</td>
    <td>${esc(b.disposition || '—')}</td>
  </tr>`).join('');
  const period = list.length
    ? `${list[list.length - 1].deliveredAt} ~ ${list[0].deliveredAt}` : '—';
  return `<div class="fp-doc">
    <h1>판매내역서</h1>
    <p class="fp-meta-line">기간: ${esc(period)} · 발행일: ${esc(todayKey())} · 인도 완료 ${list.length}건</p>
    ${list.length ? `<table class="fp-table">
      <thead><tr><th>인도일</th><th>배치번호</th><th>제품·처방</th><th>고객</th><th class="fp-num">내용량</th><th>비고</th></tr></thead>
      <tbody>${rows}</tbody></table>`
    : '<p class="fp-meta-line">인도일이 기록된 판매 내역이 없습니다 — 배치 폼의 "고객 인도일"을 입력하면 내역서에 포함됩니다.</p>'}
    <div class="fp-sign-row">
      <span class="fp-sign">작성자: ______________</span>
      <span class="fp-sign">확인일: ________</span>
    </div>
    <p class="fp-disclaimer">본 내역서는 앱에 기록된 인도 정보를 집계한 자료입니다. 법정 보존 서식 요건은 관할 지방식약청 안내를 확인하세요.</p>
  </div>`;
}

/**
 * 고객 안내·동의서 (FO-60) — 맞춤형화장품 사용 전 고지와 고객 서명.
 * 고객 알레르기 이력 + 제품 주의사항을 담는다.
 * @param {object} d - {customer:{name,skinType,allergies}, product:{formulaName,batchNo}, ingredientsNote}
 */
export function buildConsentHtml(d) {
  const c = d.customer || {};
  const p = d.product || {};
  const allergyLine = c.allergies && c.allergies.length
    ? esc(c.allergies.join(', ')) : '보고된 알레르기 없음';
  return `<div class="fp-doc">
    <h1>맞춤형화장품 사용 안내·동의서</h1>
    <p class="fp-meta-line">고객: ${esc(c.name || '—')}${c.skinType ? ` · 피부타입 ${esc(c.skinType)}` : ''} · 발행일: ${esc(todayKey())}</p>
    ${p.formulaName || p.batchNo ? `<p class="fp-meta-line">대상 제품: ${esc(p.formulaName || '—')}${p.batchNo ? ` (배치 ${esc(p.batchNo)})` : ''}</p>` : ''}
    <h3>고객 알레르기 이력</h3>
    <p class="fp-notes">${allergyLine}</p>
    <h3>사용 전 안내사항</h3>
    <ul class="fp-steps">
      <li>본 제품은 고객 개인의 피부 상태와 상담 내용을 반영해 조제된 맞춤형화장품입니다 — 표시된 고객 외 사용을 금합니다.</li>
      <li>사용 중 붉은 반점·부종·가려움 등 이상 증상이 나타나면 즉시 사용을 중지하고 상담하세요.</li>
      <li>상기 알레르기 이력과 관련된 성분의 포함 여부를 조제 전 확인했으나, 모든 개별 반응을 보장하지는 않습니다.</li>
      <li>직사광선·고온을 피해 표시된 사용기한 내에 사용하세요. 개봉 후 변색·변취 시 사용을 중지하세요.</li>
      <li>이상 증상 발생 시 조제 사업장에 연락하면 이상사례로 기록·관리됩니다.</li>
    </ul>
    <p class="fp-notes">위 안내사항을 설명받고 이해하였으며, 제품 사용에 동의합니다.</p>
    <div class="fp-sign-row">
      <span class="fp-sign">고객 서명: ______________</span>
      <span class="fp-sign">조제관리사: ______________</span>
      <span class="fp-sign">일자: ________</span>
    </div>
  </div>`;
}

/** 공용 인쇄 트리거 — 전용 영역에 렌더 후 window.print() */
export function printHtml(html) {
  const area = document.getElementById('formula-print-area');
  if (!area) return;
  area.innerHTML = html;
  document.body.classList.add('formula-printing');
  const cleanup = () => {
    document.body.classList.remove('formula-printing');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
}
