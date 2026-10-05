// src/exams/cosmetic/views/formula-adverse.js — Formula OS 소비자 이상사례 기록 뷰 (FO-59)
// @spec FO-59
//
// 화장품 사용 후 이상사례(부작용 의심) 발생·조치·보고 이력을 관리한다.
// 위해사례 대응의 법적 증적 — 기록은 adverse-store.js에 영속되고
// 종합 점검 보고서(FO-56)의 이상사례 섹션에 집계된다.
//
// 패널: formula-adverse-panel — 기록 폼(details 접이식) + 발생일 역순 목록.

import { esc } from '../../../sanitize.js';
import { todayKey } from '../../../utils.js';
import { showToast, showConfirm } from '../../../ui-utils.js';
import { showStoreError } from '../../../pro-upgrade.js';
import { showPanel, formulaSubNav, getEl } from './formula.js';
import { listCustomers } from '../customer-store.js';
import {
  listAdverse, getAdverse, getAdverseUsage,
  createAdverse, updateAdverse, deleteAdverse,
} from '../adverse-store.js';

const adv = { editingId: null };

function readForm() {
  const val = id => { const el = getEl(id); return el ? el.value : ''; };
  const custId = val('adv-customer');
  const c = custId ? listCustomers().find(x => x.id === custId) : null;
  return {
    occurredAt: val('adv-occurred'),
    customerId: custId,
    customerName: c ? c.name : val('adv-customer-name').trim(),
    product: val('adv-product').trim(),
    symptoms: val('adv-symptoms').trim(),
    action: val('adv-action').trim(),
    reportedAt: val('adv-reported'),
    notes: val('adv-notes').trim(),
  };
}

function resetForm() {
  ['adv-occurred', 'adv-customer-name', 'adv-product', 'adv-symptoms',
    'adv-action', 'adv-reported', 'adv-notes'].forEach(id => {
    const el = getEl(id); if (el) el.value = '';
  });
  const sel = getEl('adv-customer'); if (sel) sel.value = '';
  const occurred = getEl('adv-occurred'); if (occurred) occurred.value = todayKey();
  adv.editingId = null;
  const btn = getEl('adv-save-btn'); if (btn) btn.innerHTML = '<i class="fa-solid fa-plus" aria-hidden="true"></i> 기록 추가';
  const cancel = getEl('adv-cancel-btn'); if (cancel) cancel.classList.add('is-hidden');
}

function renderList() {
  const box = getEl('adverse-list');
  if (!box) return;
  const items = listAdverse();
  const usage = getAdverseUsage();
  const usageEl = getEl('adverse-usage');
  if (usageEl) usageEl.textContent = `${usage.count}/${usage.limit}건 기록됨`;
  if (!items.length) {
    box.innerHTML = '<div class="formula-rec-note">기록된 이상사례가 없습니다. 소비자에게 이상 증상이 접수되면 위 폼에서 기록하세요.</div>';
    return;
  }
  box.innerHTML = items.map(a => `
    <div class="formula-card">
      <div class="formula-card-head">
        <h4 class="formula-card-name">${esc(a.occurredAt)} — ${esc(a.customerName || '고객 미기록')}</h4>
        <span class="formula-card-meta">${esc(a.product || '제품 미기록')}${a.reportedAt ? ` · 관계기관 보고 ${esc(a.reportedAt)}` : ' · 미보고'}</span>
      </div>
      <div class="formula-card-meta">증상: ${esc(a.symptoms)}</div>
      ${a.action ? `<div class="formula-card-meta">조치: ${esc(a.action)}</div>` : ''}
      ${a.notes ? `<div class="formula-card-meta">메모: ${esc(a.notes)}</div>` : ''}
      <div class="formula-card-actions">
        <button class="btn btn-secondary btn-sm" data-click="advEdit" data-arg="${esc(a.id)}"><i class="fa-solid fa-pen" aria-hidden="true"></i> 보정</button>
        <button class="btn btn-secondary btn-sm f-danger" data-click="advDelete" data-arg="${esc(a.id)}" title="이상사례 기록 삭제 (복구 불가)"><i class="fa-solid fa-trash" aria-hidden="true"></i> 삭제</button>
      </div>
    </div>`).join('');
}

export function openAdversePanel() {
  showPanel('formula-adverse-panel');
  const subnav = getEl('formula-adverse-subnav');
  if (subnav) subnav.innerHTML = formulaSubNav('adverse');
  const sel = /** @type {HTMLSelectElement|null} */ (/** @type {unknown} */ (getEl('adv-customer')));
  if (sel && !sel.dataset.bound) {
    sel.dataset.bound = '1';
    sel.innerHTML = '<option value="">고객 카드 선택 (선택 시 이름 자동 입력)</option>'
      + listCustomers().map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    sel.addEventListener('change', () => {
      const c = listCustomers().find(x => x.id === sel.value);
      const nameEl = getEl('adv-customer-name');
      if (nameEl && c) nameEl.value = c.name;
    });
  }
  const occurred = getEl('adv-occurred');
  if (occurred && !occurred.value) occurred.value = todayKey();
  renderList();
}

export function advSave() {
  const data = readForm();
  const r = adv.editingId ? updateAdverse(adv.editingId, data) : createAdverse(data);
  if (!r.ok) { showStoreError(r, '이상사례', showToast); return; }
  showToast(adv.editingId ? '이상사례가 보정되었습니다.' : '이상사례를 기록했습니다.', 'success');
  resetForm();
  const fold = getEl('adv-form-fold'); if (fold) fold.removeAttribute('open');
  renderList();
}

export function advEdit(id) {
  const a = getAdverse(id);
  if (!a) { showToast('이상사례 기록을 찾을 수 없습니다.', 'error'); return; }
  adv.editingId = id;
  const set = (elId, v) => { const el = getEl(elId); if (el) el.value = v || ''; };
  set('adv-occurred', a.occurredAt);
  set('adv-customer', a.customerId);
  set('adv-customer-name', a.customerName);
  set('adv-product', a.product);
  set('adv-symptoms', a.symptoms);
  set('adv-action', a.action);
  set('adv-reported', a.reportedAt);
  set('adv-notes', a.notes);
  const btn = getEl('adv-save-btn'); if (btn) btn.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i> 보정 저장';
  const cancel = getEl('adv-cancel-btn'); if (cancel) cancel.classList.remove('is-hidden');
  const fold = getEl('adv-form-fold'); if (fold) fold.setAttribute('open', '');
  if (fold && typeof fold.scrollIntoView === 'function') {
    fold.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

export function advCancel() { resetForm(); }

export async function advDelete(id) {
  const a = getAdverse(id);
  if (!a) return;
  const ok = await showConfirm(
    `${a.occurredAt} 이상사례 기록을 삭제할까요? 이 작업은 되돌릴 수 없습니다.`,
    '이상사례 삭제');
  if (!ok) return;
  const r = deleteAdverse(id);
  if (!r.ok) { showStoreError(r, '이상사례', showToast); return; }
  showToast('이상사례 기록을 삭제했습니다.', 'success');
  renderList();
}
