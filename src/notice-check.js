// notice-check.js — 참조 법령·고시 감지 배너 (Formula OS 최초 진입 시)
// @spec FO-24,RR-19,DI-11
//
// 감시 대상은 시험별 references.json의 referenceLaw/noticeCore에서 유도된다
// (cosmetic은 식약처 고시). GitHub Actions(주1회)가 law.go.kr 오픈API로
// 최신본을 조회해 content/exams/<id>/notice_status.json에 기록 → 앱은
// raw.githubusercontent.com에서 읽어 baseline보다 최신이면 배너로 알림.
// 하루 1회 스로틀 + 닫은 고시는 같은 시행일까지 억제. 오프라인/실패 시 무시.

import { getItem, setItem } from './storage.js';
import { STORAGE_KEYS } from './storage-keys.js';
import { getActiveExamId } from './exam-context.js';
import { html } from './sanitize.js';
import { lawUrlFor } from './law-links.js';
import { getRefTables } from './pdf-registry.js';
import { todayKey, localDateTime } from './utils.js';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAW_BASE = 'https://www.law.go.kr';
const LAW_API = `${LAW_BASE}/DRF`;
// law.go.kr 오픈API 운영자 코드 — 공개 계정 식별자(비밀키 아님). 호출량 제한은 계정별 적용
const LAW_OC = 'goldrune1125';
// notice_status.json의 원격 위치 — 저장소를 포크·이전하면 이 값만 변경
const STATUS_REPO = 'skygoldlee-cyber/passory';

/**
 * 현행본 직결 URL — 일련번호가 있으면 한글주소보다 정확한 시리얼 페이지로 연다.
 * target: 'law' → lsInfoP.do / 'admrul' → admRulInfoP.do
 */
function ruleInfoUrl(serial, target, effectiveDate, fallback) {
  if (serial) {
    if (target === 'law') {
      const efyd = String(effectiveDate || '').replace(/\D/g, '') || '99991231';
      return `${LAW_BASE}/lsInfoP.do?lsiSeq=${encodeURIComponent(serial)}&efYd=${efyd}`;
    }
    return `${LAW_BASE}/admRulInfoP.do?admRulSeq=${encodeURIComponent(serial)}`;
  }
  return fallback || LAW_BASE;
}

function statusUrl(examId) {
  return `https://raw.githubusercontent.com/${STATUS_REPO}/main/content/exams/${examId}/notice_status.json`;
}

/** '제2026-19호' / '2026-19' 등 → '제2026-19호' 정규화 (순수 함수 — 테스트용) */
export function normalizeNotice(s) {
  const m = /^제?\s*(20\d{2})\s*-?\s*(\d+)\s*호?$/.exec(String(s ?? '').trim());
  return m ? `제${m[1]}-${m[2]}호` : null;
}

/** 상세 응답 객체에서 최신 고시번호 추출 (순수 함수 — 테스트용) */
export function findNoticeNumber(node) {
  const cands = [];
  (function walk(o) {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === 'object') { walk(v); continue; }
      if (k.includes('공포번호') || k.includes('고시번호')) {
        const n = normalizeNotice(v);
        if (n) cands.push(n);
      }
    }
  })(node);
  if (!cands.length) {
    for (const m of JSON.stringify(node).matchAll(/제\s*20\d{2}\s*-\s*\d+\s*호/g)) {
      const n = normalizeNotice(m[0]);
      if (n) cands.push(n);
    }
  }
  if (!cands.length) return null;
  const key = (s) => { const m = /20(\d{2})-(\d+)/.exec(s); return m ? [+m[1], +m[2]] : [0, 0]; };
  return cands.sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1]).pop();
}

/** baseline보다 최신 고시인지 판정 (순수 함수 — 테스트용) */
export function isNewerNotice(status) {
  const latest = status?.latest;
  const base = status?.baseline;
  if (!latest || !base) return false;
  const le = latest.effectiveDate || '';
  const be = base.effectiveDate || '';
  if (le && be) return le > be;
  // 날짜가 없으면 고시번호 비교 (제2026-19호 → [2026,19])
  const num = (s) => { const m = /20(\d{2})\s*-\s*(\d+)/.exec(s || ''); return m ? [+m[1], +m[2]] : null; };
  const ln = num(latest.notice); const bn = num(base.notice);
  return !!(ln && bn && (ln[0] > bn[0] || (ln[0] === bn[0] && ln[1] > bn[1])));
}

function renderBanner(latest, extraDocs) {
  const el = document.getElementById('formula-notice-banner');
  if (!el) return;
  const dismissed = getItem(STORAGE_KEYS.NOTICE_DISMISSED_DATE) || '';
  if (dismissed && latest.effectiveDate && dismissed >= latest.effectiveDate) return;
  const notice = latest.notice || '신규 고시';
  const label = latest.ruleName || '참조 법령·고시';
  const eff = latest.effectiveDate ? `(${latest.effectiveDate} 시행)` : '';
  const extra = extraDocs?.length
    ? html`<br><small>함께 갱신된 문서: ${extraDocs.join(', ')} — '고시 정보 보기'에서 문서별 비교를 확인하세요.</small>`
    : '';
  const link = ruleInfoUrl(latest.serialNo, latest.target, latest.effectiveDate, latest.url);
  el.innerHTML = html`
    <div class="notice-banner-body">
      <span class="notice-banner-icon" aria-hidden="true">⚠</span>
      <div class="notice-banner-text">
        <strong>${label} ${notice} ${eff} 확인됨</strong><br>
        앱 문서는 이전 기준의 스냅샷입니다. 배합 전 <a href="${link}" target="_blank" rel="noopener">공식 원문(law.go.kr)</a>을 확인하세요.${extra}
      </div>
      <button type="button" class="notice-banner-close" data-click="dismissMfdsNotice" data-arg="${latest.effectiveDate || ''}" aria-label="닫기">×</button>
    </div>`;
  el.classList.remove('is-hidden');
}

// ——— 상태 파일 캐시 (다문서 docs[] — 참조 링크 '갱신 필요' 배지에 사용) ———
let _lastStatus = null;
let _statusPromise = null;
let _lastDiff = null;
let _diffPromise = null;

/**
 * 현재 고시 기준 스탬프 (FO-64) — 종합 보고서 푸터 '기준 고시' 표기용.
 * _lastStatus는 진입 시 checkMfdsNotice/ensureNoticeStatus가 비동기로 채운다.
 * 미로드 시 null — 호출부는 '확인 불가' 문구로 폴백한다.
 * @returns {{notice:string, ruleName:string, effectiveDate:string, checkedAt:string, isNewer:boolean}|null}
 */
export function getNoticeStamp() {
  const latest = _lastStatus?.latest || _lastStatus?.baseline;
  if (!latest || !latest.notice) return null;
  // 마지막 원격 조회 시각(epoch ms) → 표시용 날짜. 미조회면 시행일로 폴백.
  const checkedMs = parseInt(getItem(STORAGE_KEYS.NOTICE_CHECKED_AT) || '0', 10);
  const checkedAt = checkedMs ? localDateTime(new Date(checkedMs)).slice(0, 10) : '';
  return {
    notice: latest.notice,
    ruleName: latest.ruleName || '참조 법령·고시',
    effectiveDate: latest.effectiveDate || '',
    checkedAt,
    isNewer: isNewerNotice(_lastStatus),
  };
}

/** notice_status.json 캐시 반환 — 원격 우선, 번들 폴백. 최초 1회만 fetch */
export function ensureNoticeStatus() {
  if (_statusPromise) return _statusPromise;
  const examId = getActiveExamId();
  _statusPromise = (async () => {
    for (const url of [statusUrl(examId), `content/exams/${examId}/notice_status.json`]) {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (r.ok) { _lastStatus = await r.json(); break; }
      } catch (_) { /* 다음 후보 */ }
    }
    return _lastStatus;
  })();
  return _statusPromise;
}

// ——— 개정 조문 diff (notice_diff.json — build:noticediff가 ref_md↔_archive 비교로 생성) ———

function diffUrl(examId) {
  return `https://raw.githubusercontent.com/${STATUS_REPO}/main/data/exams/${examId}/notice_diff.json`;
}

/** notice_diff.json 캐시 반환 — 원격 우선, 번들 폴백. 없으면 {docs:[]} */
export function ensureNoticeDiff() {
  if (_diffPromise) return _diffPromise;
  const examId = getActiveExamId();
  _diffPromise = (async () => {
    for (const url of [diffUrl(examId), `data/exams/${examId}/notice_diff.json`]) {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (r.ok) { _lastDiff = await r.json(); break; }
      } catch (_) { /* 다음 후보 */ }
    }
    return _lastDiff || { docs: [] };
  })();
  return _diffPromise;
}

/** 확인 마커 맵 — {docKey: 마지막 확인한 to.doc} */
function diffSeenMap() {
  try { return JSON.parse(getItem(STORAGE_KEYS.NOTICE_DIFF_SEEN) || '{}'); } catch (_) { return {}; }
}

/** 아직 사용자에게 고지하지 않은 개정 항목만 필터 (순수 함수 — 테스트용) */
export function unseenRevisions(docs, seen) {
  return (docs || []).filter(d => d?.to?.doc && seen?.[d.key] !== d.to.doc);
}

/** 개정 1건 요약 문구 — '신설 제2조의4·제2조의5 · 개정 제3조의3' (순수 함수 — 테스트용) */
export function diffSummary(d) {
  const parts = [];
  if (d.added?.length) parts.push(`신설 ${d.added.join('·')}`);
  if (d.changed?.length) parts.push(`개정 ${d.changed.join('·')}`);
  if (d.removed?.length) parts.push(`삭제 ${d.removed.join('·')}`);
  return parts.join(' · ') || '조문 단위 차이 없음(서식 수준)';
}

/** 개정 감지 배너(신판 공포 알림)와 별개 — 앱에 새 판본이 반영됐을 때 1회 알림 */
function renderRevisionBanner(docs) {
  const el = document.getElementById('formula-notice-banner');
  if (!el || !el.classList.contains('is-hidden')) return; // 개정 감지 배너 우선
  const first = docs[0];
  const more = docs.length > 1 ? ` 외 ${docs.length - 1}종` : '';
  el.innerHTML = html`
    <div class="notice-banner-body">
      <span class="notice-banner-icon" aria-hidden="true">ℹ</span>
      <div class="notice-banner-text">
        <strong>${first.name} ${first.to.notice}(${first.to.effectiveDate} 시행)으로 갱신됨${more}</strong><br>
        ${diffSummary(first)}.
        <button type="button" class="notice-banner-link" data-click="viewMfdsNoticeStatus">변경 내역 보기</button>
      </div>
      <button type="button" class="notice-banner-close" data-click="dismissRefRevision" aria-label="닫기">×</button>
    </div>`;
  el.classList.remove('is-hidden');
}

/** 개정 내역 고지 — 스로틀 무관하게 매 진입 시 검사 (번들 데이터라 비용 없음) */
async function checkRevisionNotice() {
  const diff = await ensureNoticeDiff();
  const unseen = unseenRevisions(diff.docs, diffSeenMap());
  if (unseen.length) renderRevisionBanner(unseen);
}

/** 개정 내역 배너 닫기 (data-click 위임) — 현재 판본을 확인함으로 기록 */
export function dismissRefRevision() {
  const seen = diffSeenMap();
  for (const d of _lastDiff?.docs || []) seen[d.key] = d.to?.doc;
  setItem(STORAGE_KEYS.NOTICE_DIFF_SEEN, JSON.stringify(seen));
  const el = document.getElementById('formula-notice-banner');
  if (el) el.classList.add('is-hidden');
}

/** 렌더된 참조 링크(data-law-url)를 스캔해 원문 링크를 현행본 URL로 보정하고 개정 배지 삽입.
 *  한글주소는 시행 예정 개정본으로도 연결되므로(currentUrl=현행본 일련번호 URL) href를 갱신한다. */
export function markStaleRefLinks(root = document) {
  const docs = _lastStatus?.docs || [];
  const byUrl = new Map(docs.filter(d => d.url).map(d => [d.url, d]));
  if (!byUrl.size) return;
  root.querySelectorAll('[data-law-url]').forEach(el => {
    const el2 = /** @type {HTMLElement} */ (el);
    const doc = byUrl.get(el2.dataset.lawUrl);
    if (!doc) return;
    // 원문 링크를 현행본 시리얼 URL로 보정 (시행 예정본 방지)
    const ext = /** @type {HTMLAnchorElement|null} */ (
      el.matches('a[href*="law.go.kr"]') ? el : el.querySelector('a[href*="law.go.kr"]'));
    if (doc.currentUrl && ext && ext.href !== doc.currentUrl) ext.href = doc.currentUrl;
    if (doc.newer && !el.querySelector('.ref-stale-badge')) {
      el.insertAdjacentHTML('beforeend',
        ' <span class="ref-stale-badge" title="공식 원문이 개정됐습니다 — 앱 내 문서는 이전 기준 스냅샷일 수 있습니다">⚠ 갱신 필요</span>');
    }
    if (doc.pending && !el.querySelector('.ref-pending-badge')) {
      el.insertAdjacentHTML('beforeend',
        ' <span class="ref-pending-badge" title="개정본이 공포됐지만 아직 시행일 전입니다 — 원문 링크는 현행본으로 열립니다">⏳ 시행 예정 개정본</span>');
    }
  });
}

/** Formula OS 첫 표시 시 호출 — 실패해도 조용히 무시 */
export async function checkMfdsNotice() {
  try {
    const last = parseInt(getItem(STORAGE_KEYS.NOTICE_CHECKED_AT) || '0', 10);
    if (Date.now() - last < CHECK_INTERVAL_MS) { ensureNoticeStatus(); checkRevisionNotice(); return; }

    const res = await fetch(statusUrl(getActiveExamId()), { cache: 'no-store' });
    if (!res.ok) return; // 실패 시 스탬프 안 찍음 — 다음 진입에 재시도
    setItem(STORAGE_KEYS.NOTICE_CHECKED_AT, String(Date.now()));
    const status = await res.json();
    _lastStatus = status;
    // 기준 문서는 상태 파일이 지정 (references.json.noticeCore → latest.ruleName)
    const coreName = status.latest?.ruleName;
    const coreDoc = (status.docs || []).find(d => d.name === coreName) || {};
    if (isNewerNotice(status)) {
      const extra = (status.docs || []).filter(d => d.newer && d.name !== coreName).map(d => d.name);
      renderBanner({ ...status.latest, target: coreDoc.target, url: coreDoc.url }, extra);
    } else if (status.docs?.some(d => d.newer)) {
      // 기준 문서 외 문서만 개정된 경우 — 참조 문서 갱신 안내 배너
      const changed = status.docs.filter(d => d.newer);
      renderBanner(
        { notice: changed[0].latestNotice || '개정 확인', effectiveDate: changed[0].latestDate,
          serialNo: changed[0].currentSerial || '', ruleName: changed[0].name,
          target: changed[0].target, url: changed[0].currentUrl || changed[0].url },
        changed.slice(1).map(d => d.name),
      );
    } else {
      checkRevisionNotice(); // 신규 고시가 없을 때만 판본 반영 알림 (개정 감지 배너 우선)
    }
  } catch (_) { /* 네트워크/파싱 실패 — 배너 생략 */ }
}

// ——— 수동 실시간 확인 (law.go.kr 직접 조회 — 참조 법령·고시 전체) ———

async function lawApi(path, params, target = 'admrul') {
  const q = new URLSearchParams({ OC: LAW_OC, target, type: 'JSON', ...params });
  const res = await fetch(`${LAW_API}/${path}?${q}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function fmtDate(d) {
  d = String(d || '').trim();
  return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
}

/** 참조자료 파일명 → 감시 메타 (공식명·기준 고시·시행일·API 유형 — 순수 함수, 테스트용) */
export function parseRefDoc(file) {
  const name = String(file).split('(')[0].trim();
  const m = /\(제([\d]+(?:-\d+)?)호\)\s*\((\d{8})\)/.exec(file);
  const target = /\((법률|대통령령|총리령|부령)\)/.test(file) ? 'law' : 'admrul';
  return {
    name, target, file, url: lawUrlFor(file),
    baselineNotice: m ? `제${m[1]}호` : null,
    baselineDate: m ? fmtDate(m[2]) : null,
  };
}

/** 감시 문서 목록 — references.json referenceLaw에서 유도 (pdf-registry 경유) */
function watchDocs() {
  const laws = getRefTables().REFERENCE_LAW || [];
  return laws.filter(f => f.file).map(f => parseRefDoc(f.file));
}

/** 문서 1종의 law.go.kr 최신본 조회 → {notice, effectiveDate, serial} */
async function fetchLatestFor(doc) {
  if (doc.target === 'law') {
    const res = await lawApi('lawSearch.do', { query: doc.name, display: 50, sort: 'efdes' }, 'law');
    let items = res?.LawSearch?.law ?? [];
    if (!Array.isArray(items)) items = [items];
    const exact = items.filter((i) => String(i['법령명한글'] || '').trim() === doc.name);
    if (!exact.length) throw new Error('법령 검색 결과 없음');
    exact.sort((a, b) => String(b['시행일자'] || '').localeCompare(String(a['시행일자'] || '')));
    return {
      notice: exact[0]['공포번호'] ? `제${exact[0]['공포번호']}호` : null,
      effectiveDate: fmtDate(exact[0]['시행일자']),
      serial: String(exact[0]['법령일련번호'] || ''),
    };
  }
  const res = await lawApi('lawSearch.do', { query: doc.name, display: 50, sort: 'efdes' });
  let items = res?.AdmRulSearch?.admrul ?? [];
  if (!Array.isArray(items)) items = [items];
  const exact = items.filter((i) => String(i['행정규칙명'] || '').trim() === doc.name);
  if (!exact.length) throw new Error('규정 검색 결과 없음');
  exact.sort((a, b) => String(b['시행일자'] || '').localeCompare(String(a['시행일자'] || '')));
  const serial = String(exact[0]['행정규칙일련번호'] || '');
  const detail = await lawApi('lawService.do', { ID: serial });
  return {
    notice: findNoticeNumber(detail),
    effectiveDate: fmtDate(exact[0]['시행일자']),
    serial,
  };
}

/** '식약처 고시 확인' 버튼 (data-click 위임) — 참조 법령·고시 전체를 law.go.kr에서 병렬 조회 */
export async function checkMfdsNoticeNow() {
  const out = document.getElementById('notice-check-result');
  const btn = /** @type {HTMLButtonElement|null} */ (document.querySelector('[data-click="checkMfdsNoticeNow"]'));
  if (out) out.textContent = 'law.go.kr 확인 중…';
  if (btn) btn.disabled = true;
  try {
    const docs = watchDocs();
    const results = await Promise.allSettled(docs.map(d => fetchLatestFor(d)));
    const changed = [];
    const failed = [];
    results.forEach((r, i) => {
      if (r.status !== 'fulfilled') { failed.push(docs[i].name); return; }
      const live = r.value;
      if (live.effectiveDate && docs[i].baselineDate && live.effectiveDate > docs[i].baselineDate) {
        changed.push({ ...docs[i], latestNotice: live.notice, latestDate: live.effectiveDate, serial: live.serial });
      }
    });
    setItem(STORAGE_KEYS.NOTICE_CHECKED_AT, String(Date.now()));
    if (changed.length) {
      const first = changed[0];
      renderBanner({ notice: first.latestNotice, effectiveDate: first.latestDate,
                     serialNo: first.serial, ruleName: first.name,
                     target: first.target, url: first.url },
                   changed.slice(1).map(d => d.name));
      const names = changed.map(d => `${d.name} ${d.latestNotice || ''}`).join(' · ');
      if (out) out.textContent = `⚠ 개정 감지 ${changed.length}종 — ${names}. 참조 문서 스냅샷 갱신 필요${failed.length ? ` (${failed.length}종 조회 실패)` : ''}`;
    } else if (out) {
      out.textContent = `✅ 최신 상태 — 감시 문서 ${docs.length - failed.length}종 모두 기준과 일치${failed.length ? ` (${failed.length}종 조회 실패)` : ''}`;
    }
  } catch (_) {
    if (out) out.textContent = '확인 실패 — 네트워크 또는 law.go.kr 응답 오류. 잠시 후 다시 시도하세요.';
  } finally {
    if (btn) btn.disabled = false;
  }
}

/** 상태 파일 → 표시용 행 목록 (순수 함수 — 테스트용) */
export function statusRows(status) {
  if (!status) return [];
  const b = status.baseline || {};
  const l = status.latest || {};
  const rows = [
    ['기준(번들 DB)', `${b.notice || '—'} · 시행 ${b.effectiveDate || '—'}`],
    ['최신 확인', `${l.notice || '—'} · 시행 ${l.effectiveDate || '—'}${l.serialNo ? ` · 일련번호 ${l.serialNo}` : ''}`],
    ['마지막 자동 확인', status.checkedAt || '—'],
    ['신규 고시', status.newerFound ? '있음 — 원문 확인 필요' : '없음'],
  ];
  // 문서별 기준↔최신 비교 — 개정 감지 시 '갱신 필요' 표시
  if (Array.isArray(status.docs) && status.docs.length) {
    rows.push(['감시 문서', `${status.docs.length}종 — 기준 고시 ↔ law.go.kr 최신`]);
    for (const d of status.docs) {
      const mark = (d.newer ? ' ⚠ 갱신 필요' : (d.error ? ' (조회 실패)' : '')) + (d.pending ? ' ⏳ 시행 예정 개정본' : '');
      rows.push([`· ${d.name}`, `${d.baselineNotice || '—'}(${d.baselineDate || '—'}) → ${d.latestNotice || '—'}(${d.latestDate || '—'})${mark}`]);
    }
  }
  return rows;
}

/** '고시 정보 보기' 버튼 (data-click 위임) — notice_status.json 내용을 패널로 표시/숨김 */
export async function viewMfdsNoticeStatus() {
  const panel = document.getElementById('notice-status-view');
  if (!panel) return;
  if (!panel.classList.contains('is-hidden')) { panel.classList.add('is-hidden'); return; }
  panel.innerHTML = '<div class="notice-status-loading">상태 파일 불러오는 중…</div>';
  panel.classList.remove('is-hidden');

  const examId = getActiveExamId();
  let status = null;
  let source = '';
  // Actions가 갱신한 원격 파일 우선, 실패 시 번들 스냅샷
  for (const [url, tag] of [[statusUrl(examId), '원격'], [`content/exams/${examId}/notice_status.json`, '번들']]) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) { status = await r.json(); source = tag; break; }
    } catch (_) { /* 다음 후보 */ }
  }
  if (!status) {
    panel.innerHTML = '<div class="notice-status-loading">상태 파일을 불러오지 못했습니다 — 네트워크를 확인하세요.</div>';
    return;
  }
  const rows = statusRows(status).map(([k, v]) =>
    html`<div class="notice-status-row"><span class="notice-status-key">${k}</span><span>${v}</span></div>`);
  const coreDoc = (status.docs || []).find(d => d.name === status.latest?.ruleName) || {};
  const lawLink = ruleInfoUrl(status.latest?.serialNo, coreDoc.target, null, coreDoc.url);
  panel.innerHTML = html`
    ${rows}
    <div id="notice-diff-list" class="notice-diff-list"></div>
    <div class="notice-status-links">
      <a href="${statusUrl(examId)}" target="_blank" rel="noopener">상태 파일 원문</a>
      <a href="${lawLink}" target="_blank" rel="noopener">고시 원문(law.go.kr)</a>
      <span class="notice-status-src">출처: ${source}</span>
    </div>`;
  renderDiffList(document.getElementById('notice-diff-list'));
}

/** 개정 내역 섹션 — notice_diff.json의 문서별 신설·개정·삭제 조문을 패널에 렌더 */
async function renderDiffList(el) {
  if (!el) return;
  const diff = await ensureNoticeDiff();
  if (!diff.docs?.length) return;
  const blocks = diff.docs.map(d => {
    const seen = diffSeenMap()[d.key] === d.to?.doc;
    const line = (label, list) => list?.length
      ? html`<div class="notice-diff-line"><strong>${label}</strong> ${list.join(' · ')}</div>` : '';
    return html`
      <div class="notice-diff-entry">
        <div class="notice-diff-head">📋 ${d.name} 개정 내역 — ${d.from.notice}(${d.from.effectiveDate}) → ${d.to.notice}(${d.to.effectiveDate})${seen ? ' <span class="notice-diff-seen">확인됨</span>' : ''}</div>
        ${line('신설', d.added)}${line('개정', d.changed)}${line('삭제', d.removed)}
        <div class="notice-diff-note">기계 비교(ref_md 조문 대조) 기준 — 상세 변경은 공식 원문을 확인하세요.</div>
      </div>`;
  });
  el.innerHTML = html`<div class="notice-diff-title">참조 문서 개정 내역</div>${blocks}`;
}

// ——— 성분사전 성분 고시 확인 (DI-11) ———

/**
 * 감시 문서 subset 필터 (순수 함수 — 테스트용)
 * @param {Array} docs parseRefDoc 결과 목록
 * @param {Array<string>|undefined} names 허용 문서명 (references.json.noticeIngredientDocs — 미선언 시 빈 subset)
 */
export function filterIngredientDocs(docs, names) {
  const set = new Set(Array.isArray(names) ? names : []);
  return docs.filter(d => set.has(d.name));
}

/** 활성 시험의 성분 관련 고시 문서 — 사전 '고시 확인' 버튼 노출 게이트 (DI-11) */
export function dictNoticeDocs() {
  return filterIngredientDocs(watchDocs(), getRefTables().NOTICE_INGREDIENT_DOCS);
}

/**
 * 문서 1종의 기준↔최신 비교 행 (순수 함수 — 테스트용)
 * @param {Object} doc parseRefDoc 결과
 * @param {Object|null} live fetchLatestFor 결과 (실패 시 null)
 * @param {string} today 'YYYY-MM-DD' — 시행 예정 개정본 판정 기준
 * @returns {{name:string, text:string, mark:string, level:string, url:string}}
 */
export function dictNoticeRow(doc, live, today) {
  const base = `${doc.baselineNotice || '—'}(${doc.baselineDate || '—'})`;
  if (!live) {
    return { name: doc.name, text: `${base} → 조회 실패`, mark: '❌', level: 'error', url: doc.url || LAW_BASE };
  }
  const latest = `${live.notice || '—'}(${live.effectiveDate || '—'})`;
  const url = ruleInfoUrl(live.serial, doc.target, live.effectiveDate, doc.url);
  let mark = '✅', level = 'ok';
  if (doc.baselineDate && live.effectiveDate && live.effectiveDate > doc.baselineDate) {
    level = live.effectiveDate > today ? 'pending' : 'newer';
    mark = level === 'pending' ? '⏳ 시행 예정' : '⚠ 개정 감지';
  }
  return { name: doc.name, text: `${base} → ${latest}`, mark, level, url };
}

/** 사전 '고시 확인' 버튼 (data-click 위임) — 성분 관련 고시 subset을 law.go.kr에서 병렬 조회 (DI-11) */
export async function checkDictNoticeNow() {
  const panel = document.getElementById('dict-notice-result');
  if (!panel) return;
  if (!panel.classList.contains('is-hidden')) { panel.classList.add('is-hidden'); return; }
  panel.classList.remove('is-hidden');
  const docs = dictNoticeDocs();
  if (!docs.length) {
    panel.innerHTML = '<div class="dict-notice-loading">이 시험에는 성분 관련 고시 감시 대상이 선언되어 있지 않습니다.</div>';
    return;
  }
  const btn = /** @type {HTMLButtonElement|null} */ (document.querySelector('[data-click="checkDictNoticeNow"]'));
  panel.innerHTML = '<div class="dict-notice-loading">law.go.kr 확인 중…</div>';
  if (btn) btn.disabled = true;
  try {
    const results = await Promise.allSettled(docs.map(d => fetchLatestFor(d)));
    const today = todayKey();
    const rows = docs.map((d, i) =>
      dictNoticeRow(d, results[i].status === 'fulfilled' ? results[i].value : null, today));
    const changed = rows.filter(r => r.level === 'newer' || r.level === 'pending').length;
    const failed = rows.filter(r => r.level === 'error').length;
    const head = changed
      ? `⚠ 개정 감지 ${changed}종 — 원문을 확인하세요`
      : `✅ 성분 관련 고시 ${docs.length - failed}종 모두 기준과 일치`;
    panel.innerHTML = html`
      <div class="dict-notice-row dict-notice-head">${head}${failed ? ` (${failed}종 조회 실패)` : ''}</div>
      ${rows.map(r => html`<div class="dict-notice-row"><span class="dict-notice-name">· ${r.name}</span><span>${r.text} ${r.mark} <a href="${r.url}" target="_blank" rel="noopener">원문</a></span></div>`)}`;
  } catch (_) {
    panel.innerHTML = '<div class="dict-notice-loading">확인 실패 — 네트워크 또는 law.go.kr 응답 오류. 잠시 후 다시 시도하세요.</div>';
  } finally {
    if (btn) btn.disabled = false;
  }
}

/** 배너 닫기 (data-click 위임) — 같은 시행일의 고시는 다시 표시하지 않음 */
export function dismissMfdsNotice(effectiveDate) {
  if (effectiveDate) setItem(STORAGE_KEYS.NOTICE_DISMISSED_DATE, effectiveDate);
  const el = document.getElementById('formula-notice-banner');
  if (el) el.classList.add('is-hidden');
}
