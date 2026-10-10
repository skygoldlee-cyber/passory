// src/exams/cosmetic/views/formula-products.js — 기성품 DB 뷰 컨트롤러 (FO-37~40)
// @spec FO-37,FO-38,FO-39,FO-40
//
// 기성품 전성분 DB — 목록(formula-product-panel) · 등록/수정 폼
// (formula-product-form-panel) · 상세+교차 분석(formula-product-detail-panel).
// formula.js의 showPanel/subNav 재사용 — 고객 관리(formula-customer.js)와
// 동일한 3패널 패턴. 설계: docs/exams/cosmetic/design/PRODUCT_DB_DESIGN.md
//
// 핵심 원칙: 전성분은 사용자 기록, 판정은 공식+자가 병합 인덱스의
// 조회 시점 라이브 매칭 — 원료 DB 갱신이 등록 제품 전체에 자동 반영된다.

import { esc } from '../../../sanitize.js';
import { showToast, showConfirm } from '../../../ui-utils.js';
import { showStoreError } from '../../../pro-upgrade.js';
import { switchView } from '../../../views/navigation.js';
import { todayKey, normalizeEntityName } from '../../../utils.js';
import {
  showPanel, formulaSubNav, getEl, getIndex, customIngAdd,
  invalidateIngredientIndex,
} from './formula.js';
import {
  listProducts, getProduct, getProductUsage,
  createProduct, updateProduct, deleteProduct,
  parseFullIngredientsDetailed, classifyProductIngredients, PRODUCT_ING_CLASS,
  findAllergyHits, ingredientMatchKeys, ingredientKeyHit, compareWithFormula, compareWithProduct,
  rankFormulasByOverlap, detectOrderHint,
  serializeProduct, serializeProductAnalysis, importProduct,
} from '../product-store.js';
import { listCustomers } from '../customer-store.js';
import { listFormulas } from '../formula-store.js';
import { findIngredient, suspectOcrSubstitutions } from '../formula-check.js';
import { createCustomIngredient } from '../custom-ingredient-store.js';
import { downloadJson } from './formula-recommend.js';
import { CUSTOMER_OPTIONS } from '../formula-store.js';
import {
  getVisionKey, saveVisionKey, clearVisionKey, maskVisionKey,
  getVisionModel, saveVisionModel, validateVisionKey,
  fileToBase64Jpeg, extractProductFromImages,
  getVisionHiRes, saveVisionHiRes,
} from '../product-vision.js';

/* =======================================================
   배지 — 성분 유형 분류 → 시각 계약
   ======================================================= */

const CLASS_BADGE = {
  [PRODUCT_ING_CLASS.OFFICIAL]: { cls: 'f-check-ok', label: '공식 등록' },
  [PRODUCT_ING_CLASS.RESTRICTED]: { cls: 'f-check-warn', label: '사용 제한' },
  [PRODUCT_ING_CLASS.BANNED]: { cls: 'f-check-banned', label: '금지 성분명 매칭' },
  [PRODUCT_ING_CLASS.CUSTOM]: { cls: 'f-check-custom', label: '자가 등록' },
  [PRODUCT_ING_CLASS.UNKNOWN]: { cls: 'f-check-unknown', label: 'DB 미등록' },
};

function classBadgeHtml(cls, note) {
  const b = CLASS_BADGE[cls] || CLASS_BADGE[PRODUCT_ING_CLASS.UNKNOWN];
  return `<span class="f-check ${b.cls}" title="${esc(note || '')}">${b.label}</span>`;
}

/* =======================================================
   목록 패널
   ======================================================= */

// 목록 필터 — ingredient는 사전 '함유 기성품' 진입 시 성분 필터
const prodFilter = { query: '', ingredient: '' };

export function openProductPanel() {
  showPanel('formula-product-panel');
  const subnav = getEl('formula-product-subnav');
  if (subnav) subnav.innerHTML = formulaSubNav('products');
  const search = getEl('product-search');
  if (search) {
    search.value = prodFilter.query;
    if (!search.dataset.bound) {
      search.dataset.bound = '1';
      search.addEventListener('input', () => {
        prodFilter.query = search.value.trim();
        renderProductList();
      });
    }
  }
  renderProductList();
}

function renderProductList() {
  const list = getEl('product-list');
  if (!list) return;
  const usage = getProductUsage();
  const usageEl = getEl('product-list-usage');
  if (usageEl) usageEl.textContent = `${usage.count}/${usage.limit} 등록`;

  // 활성 성분 필터 칩 — 사전 '함유 기성품'에서 진입한 맥락 표시
  const filterChip = getEl('product-filter-chip');
  if (filterChip) {
    filterChip.innerHTML = prodFilter.ingredient
      ? `<span class="prod-filter-active">성분 필터: <strong>${esc(prodFilter.ingredient)}</strong>
          <button type="button" class="prod-filter-clear" data-click="productClearFilter" aria-label="성분 필터 해제"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></span>`
      : '';
  }

  const index = getIndex();
  const q = prodFilter.query.toLowerCase();
  // 성분 필터 — matchKey+동의어+부분일치 확장 (FO-51) — '파라벤류' 필터가
  // '메칠파라벤' 함유 제품까지 포착
  const ingKeys = prodFilter.ingredient ? ingredientMatchKeys(prodFilter.ingredient) : null;
  const products = listProducts().filter(p => {
    if (ingKeys && ingKeys.size && !(p.ingredients || [])
      .some(n => ingredientKeyHit(n, ingKeys))) return false;
    if (!q) return true;
    return (p.name || '').toLowerCase().includes(q)
      || (p.brand || '').toLowerCase().includes(q)
      || (p.ingredients || []).some(n => n.toLowerCase().includes(q));
  });

  if (!listProducts().length) {
    list.innerHTML = `
      <div class="formula-empty">
        <i class="fa-solid fa-store" aria-hidden="true"></i>
        <h4>등록된 기성품이 없습니다</h4>
        <p>시판 제품의 전성분을 붙여넣어 등록하면 성분별 규제 배지·고객 알레르기 교차·내 포뮬러 비교가 활성화됩니다.</p>
        <button class="btn btn-primary" data-click="productNew"><i class="fa-solid fa-plus" aria-hidden="true"></i> 첫 제품 등록</button>
      </div>`;
    return;
  }
  if (!products.length) {
    list.innerHTML = `<div class="formula-empty"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><h4>조건에 맞는 제품이 없습니다</h4><p>검색어 또는 성분 필터를 바꿔 보세요.</p></div>`;
    return;
  }

  // 동명(리뉴얼) 제품 표시 — 브랜드+제품명 정규화가 같은 항목 수 (FO-52)
  const nameCount = new Map();
  for (const p of products) {
    const k = normalizeEntityName(`${p.brand}|${p.name}`);
    nameCount.set(k, (nameCount.get(k) || 0) + 1);
  }
  list.innerHTML = products.map(p => {
    const { summary } = classifyProductIngredients(p, index);
    const date = p.updatedAt ? new Date(p.updatedAt).toLocaleDateString('ko-KR') : '';
    const dupN = nameCount.get(normalizeEntityName(`${p.brand}|${p.name}`)) || 0;
    const dupMark = dupN > 1 ? ` · 동명 ${dupN}종` : '';
    const parts = [];
    if (summary.banned) parts.push(`<span class="f-check f-check-banned" title="금지 성분명과 일치하는 성분 — 원문 확인 권장">금지매칭 ${summary.banned}</span>`);
    if (summary.restricted) parts.push(`<span class="f-check f-check-warn">제한 ${summary.restricted}</span>`);
    if (summary.unknown) parts.push(`<span class="f-check f-check-unknown">미등록 ${summary.unknown}</span>`);
    if (summary.custom) parts.push(`<span class="f-check f-check-custom">자가 ${summary.custom}</span>`);
    if (!parts.length) parts.push(`<span class="f-check f-check-ok">전성분 공식 매칭</span>`);
    const title = p.brand ? `${p.brand} ${p.name}` : p.name;
    return `
      <div class="formula-card">
        <div class="formula-card-head">
          <h4 class="formula-card-name">${esc(title)}</h4>
          <span class="formula-card-meta">${esc(p.category || '제형 미지정')} · 성분 ${(p.ingredients || []).length}종 · ${date}${dupMark}</span>
        </div>
        <div class="formula-card-checks">${parts.join('')}</div>
        <div class="formula-card-actions">
          <button class="btn btn-primary btn-sm" data-click="productOpen" data-arg="${esc(p.id)}" title="전성분 분석·교차 비교"><i class="fa-solid fa-microscope" aria-hidden="true"></i> 분석</button>
          <button class="btn btn-secondary btn-sm" data-click="productEdit" data-arg="${esc(p.id)}" title="제품 정보·전성분 수정"><i class="fa-solid fa-pen" aria-hidden="true"></i> 수정</button>
          <button class="btn btn-secondary btn-sm" data-click="productCardExport" data-arg="${esc(p.id)}" title="JSON 파일로 보내기"><i class="fa-solid fa-file-export" aria-hidden="true"></i> 보내기</button>
          <button class="btn btn-secondary btn-sm f-danger" data-click="productDelete" data-arg="${esc(p.id)}" title="제품 삭제 (복구 불가)"><i class="fa-solid fa-trash" aria-hidden="true"></i> 삭제</button>
        </div>
      </div>`;
  }).join('');
}

/** 사전 '함유 기성품' 진입 — 해당 성분을 함유한 제품만 필터링해 목록 표시 */
export function productOpenByIngredient(name) {
  if (typeof name !== 'string' || !name.trim()) return;
  prodFilter.ingredient = name.trim();
  prodFilter.query = '';
  // 사전 등 다른 뷰에서 호출될 수 있으므로 formula-view로 전환 후 패널 표시
  switchView('formula-view', { scrollTop: true });
  openProductPanel();
}

export function productClearFilter() {
  prodFilter.ingredient = '';
  renderProductList();
}

/* =======================================================
   등록·수정 폼 — 전성분 붙여넣기 + 칩 미리보기 (FO-38)
   ======================================================= */

/** @type {{editingId: string|null, ingredients: string[], dropped: number}} */
const prodForm = { editingId: null, ingredients: [], dropped: 0 };

export function productNew() {
  prodForm.editingId = null;
  prodForm.ingredients = [];
  prodForm.dropped = 0;
  openProductForm('기성품 등록');
}

export function productEdit(id) {
  const p = getProduct(id);
  if (!p) { showToast('등록된 제품을 찾을 수 없습니다.', 'error'); return; }
  prodForm.editingId = id;
  prodForm.ingredients = (p.ingredients || []).slice();
  prodForm.dropped = 0;
  openProductForm('기성품 수정');
  getEl('prod-name').value = p.name || '';
  getEl('prod-brand').value = p.brand || '';
  const catEl = getEl('prod-category');
  if (catEl) catEl.querySelectorAll('input[name="prod-cat"]').forEach(r => {
    const inp = /** @type {HTMLInputElement} */ (r);
    inp.checked = inp.value === (p.category || '');
  });
  getEl('prod-note').value = p.note || '';
  getEl('prod-inci-input').value = (p.ingredients || []).join(', ');
  renderInciChips();
}

/* =======================================================
   사진 인식 (FO-41~43) — LLM 초안 → 칩 검토 → 기존 저장 경로
   ======================================================= */

/** 사진 인입 상태 — 슬롯별 전처리 결과(base64)·썸네일 data URL */
const vision = /** @type {{front: {data:string, mimeType:string}|null, back: {data:string, mimeType:string}|null, abort: AbortController|null}} */ ({ front: null, back: null, abort: null });

/** 슬롯 썸네일·버튼 상태 갱신 */
function renderPhotoSlot(slot) {
  const img = vision[slot];
  const thumb = getEl(`prod-photo-${slot}-thumb`);
  if (thumb) {
    thumb.innerHTML = img
      ? `<img src="data:${img.mimeType};base64,${img.data}" alt="${slot === 'front' ? '정면' : '후면'} 사진 미리보기">`
      : '';
  }
  const clearBtn = getEl(`prod-photo-${slot}-clear`);
  if (clearBtn) clearBtn.classList.toggle('is-hidden', !img);
  const readBtn = getEl('prod-vision-read');
  if (readBtn) readBtn.disabled = !vision.back;
}

function visionStatus(text, isError) {
  const s = getEl('prod-vision-status');
  if (!s) return;
  s.textContent = text || '';
  s.classList.toggle('is-error', !!isError);
}

/** 키 상태 표시 — 설정됨(마스킹) / 미설정. 모델 입력란도 현재값으로 갱신 (FO-46) */
function renderVisionKeyState() {
  const stateEl = getEl('prod-key-state');
  const key = getVisionKey();
  if (stateEl) stateEl.textContent = key ? `(설정됨 ${maskVisionKey(key)})` : '(미설정)';
  const modelInput = getEl('prod-gemini-model');
  if (modelInput && !modelInput.value) modelInput.value = getVisionModel();
}

export function productVisionToggle() {
  const panel = getEl('prod-photo-panel');
  if (!panel) return;
  const open = panel.classList.toggle('is-hidden');
  const btn = document.querySelector('[data-click="productVisionToggle"]');
  if (btn) btn.setAttribute('aria-expanded', String(!open));
  renderVisionKeyState();
  const hires = /** @type {HTMLInputElement|null} */ (getEl('prod-vision-hires'));
  if (hires) hires.checked = getVisionHiRes();
  // 키 미설정이면 키 블록 자동 펼침 — 첫 사용 안내
  const keyBlock = /** @type {HTMLDetailsElement|null} */ (document.getElementById('prod-key-block'));
  if (keyBlock && !getVisionKey()) keyBlock.open = true;
}

/** 고해상도 모드 토글 — 설정값 저장, 이미 올린 사진은 다음 촬영부터 적용 (FO-54) */
export function productVisionHiRes() {
  const cb = /** @type {HTMLInputElement|null} */ (getEl('prod-vision-hires'));
  if (!cb) return;
  saveVisionHiRes(cb.checked);
  visionStatus(cb.checked
    ? '고해상도 모드 — 다음 촬영부터 장변 2048px로 읽습니다 (전송량·비용 증가).'
    : '기본 해상도로 돌아갔습니다 (장변 1024px).');
}

/** 슬롯별 file input 론치 — change는 1회 바인딩 */
export function productPhotoPick(slot) {
  if (slot !== 'front' && slot !== 'back') return;
  const input = getEl(`prod-photo-${slot}`);
  if (!input) return;
  if (!input.dataset.bound) {
    input.dataset.bound = '1';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      visionStatus('사진을 준비하고 있습니다…');
      const r = await fileToBase64Jpeg(file);
      if (!r.ok) { visionStatus(r.error, true); return; }
      vision[slot] = r;
      visionStatus('');
      renderPhotoSlot(slot);
    });
  }
  input.click();
}

export function productPhotoRemove(slot) {
  if (slot !== 'front' && slot !== 'back') return;
  vision[slot] = null;
  const input = getEl(`prod-photo-${slot}`);
  if (input) input.value = '';
  renderPhotoSlot(slot);
}

/** AI로 전성분 읽기 — 추출 결과는 폼 프리필(검토 초안)일 뿐 직접 저장 아님 */
export async function productVisionRead() {
  if (!vision.back || !vision.back.data) {
    visionStatus('전성분이 보이는 후면 사진을 먼저 올려주세요.', true);
    return;
  }
  if (!getVisionKey()) {
    visionStatus('Gemini API 키를 먼저 설정하세요.', true);
    const keyBlock = /** @type {HTMLDetailsElement|null} */ (document.getElementById('prod-key-block'));
    if (keyBlock) keyBlock.open = true;
    return;
  }
  const readBtn = getEl('prod-vision-read');
  const cancelBtn = getEl('prod-vision-cancel');
  vision.abort = new AbortController();
  if (readBtn) readBtn.disabled = true;
  if (cancelBtn) cancelBtn.classList.remove('is-hidden');
  visionStatus('사진에서 전성분을 읽는 중입니다…');
  const images = [vision.back];
  if (vision.front) images.push(vision.front); // 후면 우선 — 정면은 이름·브랜드 보조
  const r = await extractProductFromImages(images, { signal: vision.abort.signal });
  vision.abort = null;
  if (readBtn) readBtn.disabled = false;
  if (cancelBtn) cancelBtn.classList.add('is-hidden');
  if (!r.ok) {
    visionStatus(r.error, true);
    if (r.code === 'key') {
      const keyBlock = /** @type {HTMLDetailsElement|null} */ (document.getElementById('prod-key-block'));
      if (keyBlock) keyBlock.open = true;
    }
    return;
  }
  // 프리필 — 사용자 검토 후 기존 productSave 경로로 저장
  if (r.name) getEl('prod-name').value = r.name;
  if (r.brand) getEl('prod-brand').value = r.brand;
  // 제형 추출 (FO-46) — '·' 별칭 단위 정확 일치로 선택 ('크림'→'선크림' 오매칭 방지, 미매칭 시 유지)
  if (r.category) {
    const catEl = getEl('prod-category');
    const want = r.category.replace(/[·\s]+/g, '').toLowerCase();
    if (catEl && want) catEl.querySelectorAll('input[name="prod-cat"]').forEach(inp => {
      const v = /** @type {HTMLInputElement} */ (inp).value;
      const aliases = v.split(/[·\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
      /** @type {HTMLInputElement} */ (inp).checked = aliases.some(a => a === want)
        || v.replace(/[·\s]+/g, '').toLowerCase() === want;
    });
  }
  const ingredients = r.ingredients || [];
  prodForm.ingredients = ingredients;
  prodForm.dropped = 0;
  const ta = getEl('prod-inci-input');
  if (ta) ta.value = ingredients.join(', ');
  renderInciChips();
  // 원본 썸네일 대조용 참조 — 검토 중 라벨과 칩을 시각 비교
  const ref = getEl('prod-photo-ref');
  if (ref) {
    ref.innerHTML = ['back', 'front']
      .filter(s => vision[s])
      .map(s => `<img src="data:${vision[s].mimeType};base64,${vision[s].data}" alt="참조용 원본 사진 — ${s === 'back' ? '후면 전성분' : '정면'}">`)
      .join('');
  }
  // OCR 치환 의심 (FO-55) — 미등록 칩 중 사전 표준명·속칭과 1~2자 차이는 대조 제안 표시
  const suspects = suspectOcrSubstitutions(ingredients, getIndex());
  const susEl = getEl('prod-vision-suspect');
  if (susEl) {
    susEl.classList.toggle('is-hidden', !suspects.length);
    susEl.innerHTML = suspects.length
      ? `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> <strong>인식 의심 ${suspects.length}종</strong> — ${suspects.map(s => `'${esc(s.input)}' → 사전의 '${esc(s.suggestion)}'과(와) 유사`).join(' · ')}. 원본 사진과 대조해 확인하세요.`
      : '';
  }
  visionStatus(`인식 초안 ${ingredients.length}종 — 원본 라벨과 대조 후 저장하세요.${suspects.length ? ` 인식 의심 ${suspects.length}종이 표시됩니다.` : ''}`);
}

export function productVisionCancel() {
  if (vision.abort) vision.abort.abort();
}

export function productVisionKeySave() {
  const input = getEl('prod-gemini-key');
  const ok = saveVisionKey(input ? input.value : '');
  if (!ok) { showToast('API 키를 입력하세요.', 'error'); return; }
  if (input) input.value = '';
  renderVisionKeyState();
  const keyBlock = /** @type {HTMLDetailsElement|null} */ (document.getElementById('prod-key-block'));
  if (keyBlock) keyBlock.open = false;
  showToast('API 키를 이 기기에 저장했습니다.', 'success');
}

export function productVisionKeyClear() {
  clearVisionKey();
  renderVisionKeyState();
  showToast('API 키를 삭제했습니다.', 'info');
}

/** 저장된 API 키 유효성 확인 (FO-46) — 추출 전 키·모델 문제 구분 */
export async function productVisionKeyTest() {
  if (!getVisionKey()) { visionStatus('Gemini API 키를 먼저 저장하세요.', true); return; }
  visionStatus('키를 확인하는 중입니다…');
  const r = await validateVisionKey();
  visionStatus(r.ok ? `키 확인 완료 — 모델 ${r.model} 사용 가능.` : r.error, !r.ok);
}

/** 모델명 저장 (FO-46) — 비우면 기본값(gemini-2.0-flash)으로 복귀 */
export function productVisionModelSave() {
  const input = getEl('prod-gemini-model');
  const m = saveVisionModel(input ? input.value : '');
  if (!m) { showToast('모델명을 확인하세요 — 영문·숫자·.-_ 만 사용할 수 있습니다.', 'error'); return; }
  if (input) input.value = m;
  showToast(m === 'gemini-2.0-flash' ? '기본 모델로 되돌렸습니다.' : `모델을 ${m}(으)로 설정했습니다.`, 'success');
}

/** 폼 진입 시 사진 인입 상태 초기화 — 편집 건 간 인식 결과 오염 방지 */
function resetVisionState() {
  vision.front = null;
  vision.back = null;
  if (vision.abort) { vision.abort.abort(); vision.abort = null; }
  const ref = getEl('prod-photo-ref');
  if (ref) ref.innerHTML = '';
  ['front', 'back'].forEach(s => {
    const input = getEl(`prod-photo-${s}`);
    if (input) input.value = '';
    renderPhotoSlot(s);
  });
  visionStatus('');
  const susEl = getEl('prod-vision-suspect');
  if (susEl) { susEl.classList.add('is-hidden'); susEl.innerHTML = ''; }
  const panel = getEl('prod-photo-panel');
  if (panel) panel.classList.add('is-hidden');
}

function openProductForm(title) {
  resetVisionState();
  showPanel('formula-product-form-panel');
  const titleEl = getEl('product-form-title');
  if (titleEl) titleEl.textContent = title;
  // 제형 선택지 — CUSTOMER_OPTIONS.formulation 공유 (스토어 계약과 동일 enum)
  // 네이티브 select 팝업이 모바일 탭 바 영역을 침범하는 결함 → 라디오 칩 그룹
  const catEl = getEl('prod-category');
  if (catEl && !catEl.children.length) {
    catEl.innerHTML = [''].concat(CUSTOMER_OPTIONS.formulation).map((f, i) =>
      `<label class="formula-chip"><input type="radio" name="prod-cat" value="${esc(f)}"${i === 0 ? ' checked' : ''}><span>${esc(f || '미선택')}</span></label>`
    ).join('');
  }
  const ta = getEl('prod-inci-input');
  if (ta && !ta.dataset.bound) {
    ta.dataset.bound = '1';
    ta.addEventListener('input', () => {
      const parsed = parseFullIngredientsDetailed(ta.value);
      prodForm.ingredients = parsed.ingredients;
      prodForm.dropped = parsed.dropped; // 상한 절단 경고 (FO-49)
      renderInciChips();
    });
  }
  if (!prodForm.editingId) {
    getEl('prod-name').value = '';
    getEl('prod-brand').value = '';
    // 라디오 칩 그룹 — 수정 건의 체크가 남지 않도록 '미선택'으로 리셋
    if (catEl) catEl.querySelectorAll('input[name="prod-cat"]').forEach(r => {
      /** @type {HTMLInputElement} */ (r).checked = /** @type {HTMLInputElement} */ (r).value === '';
    });
    getEl('prod-note').value = '';
    ta.value = '';
  }
  renderInciChips();
}

/** 칩 미리보기 — 순서 보존 + 미등록 칩 강조 + 개별 삭제·사전 등록 단축 */
function renderInciChips() {
  const box = getEl('prod-inci-chips');
  if (!box) return;
  const index = getIndex();
  const unknownCount = prodForm.ingredients.filter(n => !findIngredient(index, n)).length;
  const countEl = getEl('prod-inci-count');
  if (countEl) {
    countEl.textContent = prodForm.ingredients.length
      ? `성분 ${prodForm.ingredients.length}종${unknownCount ? ` · 미등록 ${unknownCount}종` : ''}${prodForm.dropped ? ` · ⚠ 상한 초과 ${prodForm.dropped}종 잘림` : ''}`
      : '';
  }
  if (!prodForm.ingredients.length) {
    box.innerHTML = '<span class="formula-rec-note">전성분을 붙여넣으면 성분 칩이 순서대로 표시됩니다.</span>';
    return;
  }
  box.innerHTML = prodForm.ingredients.map((n, i) => {
    const known = !!findIngredient(index, n);
    const badge = known ? '' : ' <span class="prod-chip-miss">미등록</span>';
    const reg = known ? '' : `<button type="button" class="prod-chip-reg" data-click="productIngRegister" data-arg="${esc(n)}" title="자가 성분 사전에 등록 — 등록 즉시 분석에 반영">사전 등록</button>`;
    return `<span class="prod-ing-chip${known ? '' : ' is-unknown'}"><span class="prod-chip-no">${i + 1}</span>${esc(n)}${badge}
      ${reg}<button type="button" class="prod-chip-x" data-click="productChipRemove" data-arg="${i}" aria-label="${esc(n)} 제거"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></span>`;
  }).join('')
    // FO-47 — 미등록 다수(사진 인식 초안 등) 시 일괄 자가 사전 등록 단축
    + (unknownCount > 1
      ? `<button type="button" class="btn btn-secondary btn-sm prod-bulk-reg" data-click="productIngRegisterAll" title="미등록 성분 전부를 자가 사전에 이름만으로 등록 — 등록 후 칩에서 항목별 정보 보완 가능"><i class="fa-solid fa-book-medical" aria-hidden="true"></i> 미등록 ${unknownCount}종 사전 일괄 등록</button>`
      : '');
}

export function productChipRemove(arg) {
  const i = parseInt(arg, 10);
  if (Number.isNaN(i) || i < 0 || i >= prodForm.ingredients.length) return;
  prodForm.ingredients.splice(i, 1);
  getEl('prod-inci-input').value = prodForm.ingredients.join(', ');
  prodForm.dropped = 0; // textarea 재작성 — 잘린 성분은 더 이상 입력에 없음
  renderInciChips();
}

/** 미등록 성분 칩 → 자가 사전 등록 단축 경로 (FO-32 재사용) */
export function productIngRegister(name) {
  customIngAdd(typeof name === 'string' ? name : '');
}

/**
 * 미등록 성분 일괄 자가 사전 등록 (FO-47) — 이름-only 스텁으로 대량 등록.
 * 개별 칩의 '사전 등록' 모달 반복을 대신한다 — 한도·중복은 건너뛰고 보고.
 */
export function productIngRegisterAll() {
  const index = getIndex();
  const names = prodForm.ingredients.filter(n => !findIngredient(index, n));
  if (!names.length) { showToast('미등록 성분이 없습니다.', 'info'); return; }
  let ok = 0;
  let skipped = 0;
  for (const name of names) {
    const r = createCustomIngredient({ name }, { officialIndex: index });
    if (r.ok) ok++;
    else skipped++;
  }
  if (ok) invalidateIngredientIndex(); // 인덱스 재구축 → 칩·분석 즉시 갱신 (DI-09)
  showToast(
    `자가 사전에 ${ok}종을 등록했습니다.${skipped ? ` ${skipped}종은 건너뛰었습니다(중복·등록 한도).` : ''}`,
    ok ? 'success' : 'warning'
  );
}

export async function productSave() {
  const catGroup = getEl('prod-category');
  const catChecked = /** @type {HTMLInputElement|null} */ (catGroup && catGroup.querySelector('input[name="prod-cat"]:checked'));
  const data = {
    name: getEl('prod-name').value,
    brand: getEl('prod-brand').value,
    category: catChecked ? catChecked.value : '',
    ingredients: prodForm.ingredients,
    note: getEl('prod-note').value,
  };
  let r = prodForm.editingId
    ? updateProduct(prodForm.editingId, data)
    : createProduct(data);
  if (!r.ok && r.code === 'duplicate' && !prodForm.editingId) {
    // 동명 리뉴얼·개정 — 전성분이 바뀐 같은 이름의 제품은 별도 항목으로 등록 (FO-52)
    const yes = await showConfirm(
      '동명 제품이 이미 등록되어 있습니다. 전성분이 바뀐 리뉴얼·개정 제품이면 별도 항목으로 등록할 수 있습니다. 리뉴얼 제품으로 등록할까요?',
      '동명 제품');
    if (!yes) { showStoreError(r, '기성품 DB', showToast, '등록에 실패했습니다.'); return; }
    r = createProduct(data, { allowVariant: true });
  }
  if (!r.ok) { showStoreError(r, '기성품 DB', showToast, '등록에 실패했습니다.'); return; }
  const wasEdit = !!prodForm.editingId;
  showToast(`"${r.item.name}"을(를) ${wasEdit ? '수정' : '등록'}했습니다.`, 'success');
  productOpen(r.item.id);
}

export async function productDelete(id) {
  const p = getProduct(id);
  if (!p) return;
  const ok = await showConfirm(`"${p.brand ? `${p.brand} ${p.name}` : p.name}" 제품을 삭제할까요? 이 작업은 되돌릴 수 없습니다.`, '기성품 삭제');
  if (!ok) return;
  const r = deleteProduct(id);
  if (!r.ok) { showToast(r.error || '삭제에 실패했습니다.', 'error'); return; }
  showToast('제품이 삭제되었습니다.', 'success');
  openProductPanel();
}

/* =======================================================
   상세 — 전성분 분석 + 교차 (FO-39·FO-40)
   ======================================================= */

export function productOpen(id) {
  const p = getProduct(id);
  if (!p) { showToast('등록된 제품을 찾을 수 없습니다.', 'error'); return; }
  showPanel('formula-product-detail-panel');
  const panel = getEl('formula-product-detail-panel');
  if (panel) panel.dataset.currentProductId = p.id;
  const subnav = getEl('product-detail-subnav');
  if (subnav) subnav.innerHTML = formulaSubNav('products');
  const box = getEl('product-detail');
  if (!box) return;

  const index = getIndex();
  const { results, summary } = classifyProductIngredients(p, index);
  const title = p.brand ? `${p.brand} ${p.name}` : p.name;

  const summaryHtml = [
    summary.banned ? `<span class="f-check f-check-banned">금지 성분명 매칭 ${summary.banned}</span>` : '',
    summary.restricted ? `<span class="f-check f-check-warn">사용 제한 ${summary.restricted}</span>` : '',
    summary.custom ? `<span class="f-check f-check-custom">자가 등록 ${summary.custom}</span>` : '',
    summary.unknown ? `<span class="f-check f-check-unknown">DB 미등록 ${summary.unknown}</span>` : '',
    summary.official ? `<span class="f-check f-check-ok">공식 등록 ${summary.official}</span>` : '',
  ].filter(Boolean).join('');

  // 비공식 배지는 판정 근거(note)를 인라인 표시 — 툴팁은 모바일에서 접근 불가
  const rowsHtml = results.map((r, i) => `
    <div class="prod-ing-row">
      <span class="prod-ing-no">${i + 1}</span>
      <span class="prod-ing-name">${esc(r.name)}</span>
      ${r.cls === PRODUCT_ING_CLASS.OFFICIAL ? '' : `<button type="button" class="prod-ing-dict" data-click="dictOpenByName" data-arg="${esc(r.name)}" title="사전에서 이 성분 보기"><i class="fa-solid fa-book-open" aria-hidden="true"></i></button>`}
      ${classBadgeHtml(r.cls, r.note)}
      ${r.cls === PRODUCT_ING_CLASS.OFFICIAL ? '' : `<span class="prod-ing-note">${esc(r.note)}</span>`}
    </div>`).join('');

  // 고객 알레르기 교차 — 알레르기 보유 고객이 있을 때만 섹션 표시
  const customers = listCustomers().filter(c => c.allergies && c.allergies.length);
  const allergyHits = customers
    .map(c => ({ customer: c, hits: findAllergyHits(p, c.allergies) }))
    .filter(x => x.hits.length);
  const allergyHtml = allergyHits.length
    ? allergyHits.map(x =>
        `<div class="prod-allergy-hit"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          <strong>${esc(x.customer.name)}</strong> — 알레르기 성분 매칭: ${esc(x.hits.join(', '))}
          <button class="formula-rec-chip" data-click="custOpen" data-arg="${esc(x.customer.id)}" title="고객 카드 보기">고객 카드</button></div>`).join('')
    : (customers.length
        ? '<div class="formula-rec-note">알레르기 매칭 없음 — 등록 고객의 알레르기 성분과 겹치지 않습니다.</div>'
        : '<div class="formula-rec-note">알레르기 이력이 등록된 고객이 없습니다 — 고객 카드에 알레르기를 기록하면 교차 확인됩니다.</div>');

  // 전성분 순서 힌트 (FO-44) — 색소 뒤에 비색소가 오면 법정 표시 규칙과 어긋남
  const orderHint = detectOrderHint(p);
  const hintHtml = orderHint
    ? `<div class="prod-order-hint"><i class="fa-solid fa-circle-info" aria-hidden="true"></i>
        <strong>표시 순서 검토</strong> — 색소 계열(${esc(orderHint.misplaced.join(', '))}) 뒤에 다른 성분이 표기되어
        법정 표시 규칙(색소는 함량 무관 최하단)과 다를 수 있습니다. 라벨 원문 또는 입력 순서를 확인하세요.</div>`
    : '';

  // 포뮬러 비교 셀렉트 — 전성분 보유(안정성 양호) 포뮬러만
  const formulas = listFormulas().filter(f => f.fullIngredients && f.fullIngredients.length);
  // 유사 포뮬러 자동 랭킹 (FO-45) — 중첩도 상위 3건, 클릭 시 셀렉트에 즉시 적용
  const ranked = rankFormulasByOverlap(p, formulas);
  const rankHtml = ranked.length
    ? `<div class="prod-rank-chips"><span class="prod-compare-label">유사 포뮬러</span>${ranked.map(r =>
        `<button type="button" class="formula-rec-chip" data-click="productRankPick" data-arg="${esc(r.formula.id)}" title="공통 성분 ${r.common}종 · 유사도 ${Math.round(r.ratio * 100)}%">${esc(r.formula.name)} <span class="fold-hint">${Math.round(r.ratio * 100)}%</span></button>`).join('')}</div>`
    : '';
  const compareHtml = formulas.length
    ? `${rankHtml}<select id="prod-compare-select" class="form-select" aria-label="비교할 내 포뮬러">
        <option value="">비교할 포뮬러 선택</option>
        ${formulas.map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('')}
      </select>
      <div id="prod-compare-result"></div>`
    : '<div class="formula-rec-note">전성분이 생성된 포뮬러가 없습니다 — 안정성 "양호" 확인된 배합을 저장하면 비교할 수 있습니다.</div>';

  // 기성품 ↔ 기성품 비교 (FO-45) — 자기 자신 제외
  const others = listProducts().filter(x => x.id !== p.id);
  const p2pHtml = others.length
    ? `<select id="prod-p2p-select" class="form-select" aria-label="비교할 다른 기성품">
        <option value="">비교할 제품 선택</option>
        ${others.map(x => `<option value="${esc(x.id)}">${esc(x.brand ? `${x.brand} ${x.name}` : x.name)}</option>`).join('')}
      </select>
      <div id="prod-p2p-result"></div>`
    : '<div class="formula-rec-note">비교할 다른 기성품이 없습니다 — 2종 이상 등록하면 성분을 대조할 수 있습니다.</div>';

  box.innerHTML = `
    <div class="formula-card">
      <div class="formula-card-head">
        <h4 class="formula-card-name">${esc(title)}</h4>
        <span class="formula-card-meta">${esc(p.category || '제형 미지정')} · 성분 ${results.length}종 · ${p.updatedAt ? new Date(p.updatedAt).toLocaleDateString('ko-KR') : ''}</span>
      </div>
      ${p.note ? `<div class="formula-card-meta">메모: ${esc(p.note)}</div>` : ''}
      <div class="formula-card-checks">${summaryHtml}</div>

      <div class="cust-section">
        <div class="cust-section-head">전성분 분석 <span class="fold-hint">표시 순서 — 조회 시점 원료 DB 기준 라이브 매칭</span></div>
        <div class="prod-ing-list">${rowsHtml}</div>
        ${hintHtml}
        <p class="cing-note">판정은 등록 시점이 아닌 <strong>현재 원료 DB 기준</strong>으로 표시됩니다 — 고시 개정으로 DB가 갱신되면 분석도 자동으로 최신화됩니다. 함량 정보가 없으므로 '사용 제한'은 한도 초과 여부가 아닌 존재 표시입니다.</p>
      </div>

      <div class="cust-section">
        <div class="cust-section-head">고객 알레르기 교차</div>
        ${allergyHtml}
      </div>

      <div class="cust-section">
        <div class="cust-section-head">내 포뮬러와 비교</div>
        ${compareHtml}
      </div>

      <div class="cust-section">
        <div class="cust-section-head">다른 기성품과 비교</div>
        ${p2pHtml}
      </div>

      <div class="formula-card-actions">
        <button class="btn btn-secondary btn-sm" data-click="productEdit" data-arg="${esc(p.id)}"><i class="fa-solid fa-pen" aria-hidden="true"></i> 수정</button>
        <button class="btn btn-secondary btn-sm" data-click="productCardExport" data-arg="${esc(p.id)}" title="JSON 파일로 보내기"><i class="fa-solid fa-file-export" aria-hidden="true"></i> 보내기</button>
        <button class="btn btn-secondary btn-sm" data-click="productAnalysisExport" data-arg="${esc(p.id)}" title="분석 결과를 JSON으로 내보내기"><i class="fa-solid fa-microscope" aria-hidden="true"></i> 분석 내보내기</button>
        <button class="btn btn-secondary btn-sm f-danger" data-click="productDelete" data-arg="${esc(p.id)}" title="제품 삭제 (복구 불가)"><i class="fa-solid fa-trash" aria-hidden="true"></i> 삭제</button>
      </div>
    </div>`;

  const sel = getEl('prod-compare-select');
  if (sel) {
    sel.addEventListener('change', () => renderCompareResult(p, sel.value));
  }
  const p2pSel = getEl('prod-p2p-select');
  if (p2pSel) {
    p2pSel.addEventListener('change', () => renderProductCompare(p, p2pSel.value));
  }
}

/** 유사 포뮬러 랭킹 칩 선택 — 셀렉트에 즉시 적용 (FO-45) */
export function productRankPick(formulaId) {
  const panel = getEl('formula-product-detail-panel');
  const pid = panel && panel.dataset.currentProductId;
  const p = pid && getProduct(pid);
  const sel = /** @type {HTMLSelectElement|null} */ (document.getElementById('prod-compare-select'));
  if (!p || !sel) return;
  sel.value = formulaId;
  renderCompareResult(p, formulaId);
}

/** 기성품 ↔ 기성품 비교 결과 렌더 (FO-45) */
function renderProductCompare(product, otherId) {
  const box = getEl('prod-p2p-result');
  if (!box) return;
  if (!otherId) { box.innerHTML = ''; return; }
  const other = getProduct(otherId);
  const cmp = other && compareWithProduct(product, other);
  if (!cmp) { box.innerHTML = '<div class="formula-rec-note">비교할 수 없습니다.</div>'; return; }
  const otherTitle = other.brand ? `${other.brand} ${other.name}` : other.name;
  const col = (label, items, cls) => `
    <div class="prod-compare-col">
      <div class="prod-compare-label">${label} <span class="fold-hint">${items.length}종</span></div>
      ${items.length ? items.map(n => `<span class="prod-ing-chip ${cls}">${esc(n)}</span>`).join('') : '<span class="formula-rec-note">없음</span>'}
    </div>`;
  box.innerHTML = `<div class="prod-compare-grid">
    ${col('공통 성분', cmp.common, '')}
    ${col('이 제품에만', cmp.aOnly, 'is-unknown')}
    ${col(`${esc(otherTitle)}에만`, cmp.bOnly, 'is-formula')}
  </div>`;
}

/** 포뮬러 비교 결과 렌더 — 공통/제품에만/내 포뮬러에만 3분할 */
function renderCompareResult(product, formulaId) {
  const box = getEl('prod-compare-result');
  if (!box) return;
  if (!formulaId) { box.innerHTML = ''; return; }
  const f = getFormulaForCompare(formulaId);
  const cmp = f && compareWithFormula(product, f);
  if (!cmp) { box.innerHTML = '<div class="formula-rec-note">비교할 수 없습니다.</div>'; return; }
  const col = (label, items, cls) => `
    <div class="prod-compare-col">
      <div class="prod-compare-label">${label} <span class="fold-hint">${items.length}종</span></div>
      ${items.length ? items.map(n => `<span class="prod-ing-chip ${cls}">${esc(n)}</span>`).join('') : '<span class="formula-rec-note">없음</span>'}
    </div>`;
  box.innerHTML = `<div class="prod-compare-grid">
    ${col('공통 성분', cmp.common, '')}
    ${col('이 제품에만', cmp.productOnly, 'is-unknown')}
    ${col('내 포뮬러에만', cmp.formulaOnly, 'is-formula')}
  </div>`;
}

function getFormulaForCompare(id) {
  return listFormulas().find(f => f.id === id) || null;
}

/* =======================================================
   JSON보내기·가져오기 (FO-40)
   ======================================================= */

export function productCardExport(id) {
  const p = getProduct(id);
  if (!p) { showToast('등록된 제품을 찾을 수 없습니다.', 'error'); return; }
  const safeName = ((p.brand ? `${p.brand} ${p.name}` : p.name) || 'product').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
  downloadJson(serializeProduct(p), `product_${safeName}_${todayKey()}.json`);
  showToast(`"${p.name}" 제품을 다운로드했습니다.`, 'success');
}

/** 분석 결과 JSON 내보내기 (FO-45) — 조회 시점 라이브 판정의 스냅샷 */
export function productAnalysisExport(id) {
  const p = getProduct(id);
  if (!p) { showToast('등록된 제품을 찾을 수 없습니다.', 'error'); return; }
  const safeName = ((p.brand ? `${p.brand} ${p.name}` : p.name) || 'product').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
  downloadJson(serializeProductAnalysis(p, getIndex()), `product-analysis_${safeName}_${todayKey()}.json`);
  showToast(`"${p.name}" 분석 결과를 다운로드했습니다.`, 'success');
}

export function productImportJson() {
  const input = getEl('product-file-input');
  if (!input) return;
  if (!input.dataset.bound) {
    input.dataset.bound = '1';
    input.addEventListener('change', productImportFile);
  }
  input.click();
}

function productImportFile(event) {
  const input = event.target;
  const file = input && input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const r = importProduct(e.target && e.target.result);
    if (!r.ok) {
      showStoreError(r, '기성품 DB', showToast, '가져오기에 실패했습니다.');
    } else {
      showToast(`"${r.item.name}" 제품을 가져왔습니다.`, 'success');
      openProductPanel();
    }
    input.value = '';
  };
  reader.onerror = () => { showToast('파일을 읽지 못했습니다.', 'error'); input.value = ''; };
  reader.readAsText(file);
}

/* =======================================================
   자가 사전 변경 반영 — 미등록 칩 배지 즉시 갱신
   formula.js가 성분 변경 시 'formula:ingredients-changed'를 발화한다.
   ======================================================= */

if (typeof document !== 'undefined') {
  document.addEventListener('formula:ingredients-changed', () => {
    const formPanel = document.getElementById('formula-product-form-panel');
    if (formPanel && !formPanel.classList.contains('is-hidden')) renderInciChips();
    const detailPanel = document.getElementById('formula-product-detail-panel');
    if (detailPanel && !detailPanel.classList.contains('is-hidden')) {
      // 상세는 스토어 id 재조회로 재렌더 — 칩 분류가 인덱스 기준이라 갱신 필요
      const id = detailPanel.dataset.currentProductId;
      if (id) productOpen(id);
    }
  });
}
