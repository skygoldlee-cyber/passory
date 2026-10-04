// src/exams/cosmetic/product-store.js — 기성품 전성분 DB (FO-37~40, FO-44~45)
// @spec FO-37,FO-38,FO-39,FO-40,FO-44,FO-45,FO-48,FO-49
//
// 시판 제품(브랜드·제형·전성분)을 등록해 개인 기성품 DB를 구축한다.
// localStorage `product_items` (scopedKey → 시험별 네임스페이스 자동).
// 설계: docs/dev/design/PRODUCT_DB_DESIGN.md (DOC-DSN-12)
//
// 스키마:
//   { id:'prod_…', name, brand, category, ingredients:string[] (전성분 표시
//     순서 보존), note, createdAt, updatedAt }
//
// 정책:
//   - 성분은 이름 문자열만 — 전성분 표시에 함량이 없으므로 농도 필드는
//     거짓 정밀도다. 배열 순서가 ≈함량 서열을 담는다 (화장품법 표시 규칙).
//   - 규제 판정은 저장하지 않는다 — 조회 시점에 공식+자가 병합 인덱스로
//     라이브 매칭해 원료 DB 갱신이 등록 제품 전체에 자동 반영되게 한다.
//   - 미등록 성분도 전성분 원문 그대로 보존한다 — 정보 손실 없음.
//   - 금지 매칭은 '제품이 불법' 판정이 아니라 동명이인·개정 시차 가능성을
//     포함한 매칭 경고다 — 배지 문구가 '원문 확인'을 안내한다 (DI-07 계승).

import { STORAGE_KEYS } from '../../storage-keys.js';
import { normalizeEntityName } from '../../utils.js';
import { BAN_TEXT_RE, findIngredient } from './formula-check.js';
import {
  loadItems, saveItems, newId, clampStr, pickEnum,
} from './store-utils.js';
import { CUSTOMER_OPTIONS, COLORANT_RE } from './formula-store.js';

// Free 플랜 저장 한도
export const PRODUCT_LIMIT_FREE = 30;

const MAX_NAME_LEN = 120;
const MAX_BRAND_LEN = 60;
const MAX_NOTE_LEN = 300;
const MAX_ING_NAME_LEN = 120;
const MAX_ING_COUNT = 150;

function loadAll() {
  return loadItems(STORAGE_KEYS.PRODUCT_ITEMS);
}

function saveAll(items) {
  return saveItems(STORAGE_KEYS.PRODUCT_ITEMS, items);
}

/* =======================================================
   전성분 파싱 (FO-38)
   ======================================================= */

// 자릿수 사이 쉼표는 구분자가 아니다 — "1,2-헥산디올"·"2,3-부탄디올" 등
// 성분명 내부 쉼표를 보호한다. 보호 문자로 치환 후 분리, 복원한다.
const PROTECTED_COMMA_RE = /(\d),(\d)/g;
// 보호 문자 — 성분명에 나타날 수 없는 NUL 센티널 (공백 등 일반 문자를 쓰면
// '광곽향 잎 추출물' 같은 정상 문자가 쉼표로 오염된다)
const COMMA_GUARD = '\u0000';
// 전성분 구분자 — 쉼표·중점·개행·세미콜론·파이프
const SEP_RE = /[,·•\n;|]+/;
// 필드 라벨 — 판매 페이지·라벨 원문 복사 시 '전성분:' 같은 필드 표기가 첫 성분
// 토큰에 딸려 오는 오염 방지. 성분명이 될 수 없는 키워드만 구분자로 승격한다
// (뒤따르는 괄호 주석·콜론·공백까지 흡수 — "전성분(배합 순서): " 패턴 대응).
// '제품명:' 등 다른 필드는 의도적으로 남긴다 — 원문 보존 원칙 (FO-48).
const FIELD_LABEL_RE = /(?:전\s*성\s*분\s*표?|全\s*成\s*分|성\s*분\s*표|ingredients?\b(?:\s+list)?)\s*(?:[(\[（][^)\]）]{0,40}[)\]）])?\s*[:：]?\s*/gi;
// 토큰 양끝 장식 — 따옴표·괄호에 문장부호(마침표·줄임표·콜론) 추가. 한국 INCI
// 성분명은 이 문자들로 시작·끝나지 않으므로 무손실 제거다 (FO-48).
const TOKEN_EDGE_RE = /^["'「『(\[〈《.。…:：]+|["'」』)\]〉》。.…:：]+$/g;

/**
 * 전성분 텍스트 파싱 + 절단 보고 — 표시 순서 보존 (FO-49).
 * 구분자: 쉼표·중점·개행·세미콜론·파이프 (자릿수 쉼표 제외).
 * 중복 제거·공식 매칭은 하지 않는다 — 전성분 원문 재현이 우선.
 * dropped: MAX_ING_COUNT 초과로 잘라낸 성분 수 — 무음 손실 방지를 위해
 * 폼 카운터 경고에 사용한다.
 * @param {string} text
 * @returns {{ingredients:string[], dropped:number}}
 */
export function parseFullIngredientsDetailed(text) {
  if (typeof text !== 'string' || !text.trim()) return { ingredients: [], dropped: 0 };
  const tokens = text
    .replace(FIELD_LABEL_RE, '\n')
    .replace(PROTECTED_COMMA_RE, `$1${COMMA_GUARD}$2`)
    .split(SEP_RE)
    .map(s => s.replace(new RegExp(COMMA_GUARD, 'g'), ',').trim().replace(TOKEN_EDGE_RE, '').trim())
    .filter(Boolean);
  return {
    ingredients: tokens.slice(0, MAX_ING_COUNT).map(s => s.slice(0, MAX_ING_NAME_LEN)),
    dropped: Math.max(0, tokens.length - MAX_ING_COUNT),
  };
}

/**
 * 전성분 텍스트를 성분명 배열로 파싱한다 — 절단 보고가 필요하면
 * parseFullIngredientsDetailed를 사용한다.
 * @param {string} text
 * @returns {string[]}
 */
export function parseFullIngredients(text) {
  return parseFullIngredientsDetailed(text).ingredients;
}

/* =======================================================
   정제·CRUD
   ======================================================= */

function sanitizeIngredients(ingredients) {
  if (!Array.isArray(ingredients)) return [];
  return ingredients
    .map(v => clampStr(typeof v === 'string' ? v : '', MAX_ING_NAME_LEN).trim())
    .filter(Boolean)
    .slice(0, MAX_ING_COUNT);
}

function sanitize(data) {
  return {
    name: clampStr(data.name || '', MAX_NAME_LEN).trim(),
    brand: clampStr(data.brand || '', MAX_BRAND_LEN).trim(),
    category: pickEnum(data.category, CUSTOMER_OPTIONS.formulation),
    ingredients: sanitizeIngredients(data.ingredients),
    note: clampStr(data.note || '', MAX_NOTE_LEN).trim(),
  };
}

/** 등록 목록 — 최신 수정 순 */
export function listProducts() {
  return loadAll().slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function getProduct(id) {
  return loadAll().find(p => p.id === id) || null;
}

/** 저장 한도·현재 개수 */
export function getProductUsage() {
  const count = loadAll().length;
  return { count, limit: PRODUCT_LIMIT_FREE, canCreate: count < PRODUCT_LIMIT_FREE };
}

/**
 * 동명 충돌 검사 — 브랜드+제품명 정규화 비교.
 * 같은 이름 다른 제품은 브랜드로 구분한다.
 * @param {string} brand
 * @param {string} name
 * @param {string|null} [excludeId] - 수정 시 자기 자신 제외
 * @returns {string|null} 충돌 사유 또는 null
 */
function collisionReason(brand, name, excludeId) {
  if (!normalizeEntityName(name)) return '제품명을 입력하세요.';
  const key = `${normalizeEntityName(brand)}|${normalizeEntityName(name)}`;
  const dup = loadAll().find(p =>
    p.id !== excludeId
    && `${normalizeEntityName(p.brand)}|${normalizeEntityName(p.name)}` === key);
  if (dup) {
    const label = dup.brand ? `${dup.brand} ${dup.name}` : dup.name;
    return `"${label}"은(는) 이미 등록된 제품입니다 — 기존 항목을 수정하세요.`;
  }
  return null;
}

/**
 * @param {object} data - {name, brand, category, ingredients, note}
 * @returns {{ok:boolean, item?:object, error?:string}}
 */
export function createProduct(data) {
  const clean = sanitize(data || {});
  const err = collisionReason(clean.brand, clean.name, null);
  if (err) return { ok: false, error: err };
  if (!clean.ingredients.length) return { ok: false, error: '전성분을 1종 이상 입력하세요.' };
  const usage = getProductUsage();
  if (!usage.canCreate) {
    return { ok: false, error: `Free 플랜은 최대 ${usage.limit}종까지 등록할 수 있습니다.` };
  }
  const now = Date.now();
  const item = { id: newId('prod'), ...clean, createdAt: now, updatedAt: now };
  const items = loadAll();
  items.push(item);
  if (!saveAll(items)) return { ok: false, error: '저장에 실패했습니다.' };
  return { ok: true, item };
}

export function updateProduct(id, data) {
  const items = loadAll();
  const idx = items.findIndex(p => p.id === id);
  if (idx < 0) return { ok: false, error: '등록된 제품을 찾을 수 없습니다.' };
  const clean = sanitize({ ...items[idx], ...(data || {}) });
  const err = collisionReason(clean.brand, clean.name, id);
  if (err) return { ok: false, error: err };
  if (!clean.ingredients.length) return { ok: false, error: '전성분을 1종 이상 입력하세요.' };
  items[idx] = { ...items[idx], ...clean, updatedAt: Date.now() };
  if (!saveAll(items)) return { ok: false, error: '저장에 실패했습니다.' };
  return { ok: true, item: items[idx] };
}

export function deleteProduct(id) {
  const items = loadAll();
  const next = items.filter(p => p.id !== id);
  if (next.length === items.length) return { ok: false, error: '등록된 제품을 찾을 수 없습니다.' };
  if (!saveAll(next)) return { ok: false, error: '삭제에 실패했습니다.' };
  return { ok: true };
}

/* =======================================================
   성분 분석 — 조회 시점 라이브 매칭 (FO-39)
   ======================================================= */

export const PRODUCT_ING_CLASS = Object.freeze({
  OFFICIAL: 'official',     // 공식 DB 등록 (사용 가능)
  RESTRICTED: 'restricted', // 사용 제한 원료 — 한도 원문 확인 필요
  BANNED: 'banned',         // 금지 성분명 매칭 — 원문 확인 권장
  CUSTOM: 'custom',         // 자가 등록 원료
  UNKNOWN: 'unknown',       // DB 미등록
});

/**
 * 단일 성분의 유형 분류 — 함량 정보가 없으므로 함유 여부+유형만 분류한다.
 * @param {string} name
 * @param {Map<string,object>} index - 공식+자가 병합 인덱스 (formula.js getIndex())
 * @returns {{name:string, cls:string, note:string}}
 */
export function classifyIngredient(name, index) {
  const ing = findIngredient(index, name);
  if (!ing) {
    return { name, cls: PRODUCT_ING_CLASS.UNKNOWN, note: '원료 DB 미등록 — 공식 고시 원문을 직접 확인하세요.' };
  }
  if (ing.custom === true || ing.type === 'custom') {
    return { name, cls: PRODUCT_ING_CLASS.CUSTOM, note: '자가 등록 원료 — 자가 선언 정보이며 법정 판정이 아닙니다.' };
  }
  if (ing.type === 'banned' || BAN_TEXT_RE.test(ing.limit || '')) {
    return {
      name,
      cls: PRODUCT_ING_CLASS.BANNED,
      note: '사용 금지 성분명과 일치 — 동명이인·고시 개정 시차·표기 오류 가능성이 있으므로 원문 확인을 권장합니다.',
    };
  }
  if (ing.type === 'restricted') {
    return {
      name,
      cls: PRODUCT_ING_CLASS.RESTRICTED,
      note: `사용 제한 원료${ing.limit ? ` — 한도: ${ing.limit}` : ''} (함량 미표기라 초과 여부는 원문 확인)`,
    };
  }
  return { name, cls: PRODUCT_ING_CLASS.OFFICIAL, note: '공식 원료 DB 등록 성분' };
}

/**
 * 제품 전성분 전체 분류 + 요약.
 * @param {object} product
 * @param {Map<string,object>} index
 * @returns {{results: Array<{name:string,cls:string,note:string}>, summary: object}}
 */
export function classifyProductIngredients(product, index) {
  const results = [];
  const summary = { official: 0, restricted: 0, banned: 0, custom: 0, unknown: 0 };
  for (const name of (product && product.ingredients) || []) {
    const r = classifyIngredient(name, index);
    results.push(r);
    summary[r.cls] += 1;
  }
  return { results, summary };
}

/* =======================================================
   교차 분석 (FO-40)
   ======================================================= */

/**
 * 성분 → 함유 제품 역조회 (정규화 이름 비교).
 * @param {string} name
 * @returns {object[]} 해당 성분을 함유한 제품 목록
 */
export function findProductsByIngredient(name) {
  const norm = normalizeEntityName(name);
  if (!norm) return [];
  return listProducts().filter(p =>
    (p.ingredients || []).some(n => normalizeEntityName(n) === norm));
}

/**
 * 고객 알레르기 ↔ 제품 전성분 교차 — 부분일치 ('파라벤류' ↔ '메칠파라벤').
 * @param {object} product
 * @param {string[]} allergies
 * @returns {string[]} 매칭된 성분명 목록 (전성분 원문)
 */
export function findAllergyHits(product, allergies) {
  const list = Array.isArray(allergies) ? allergies.filter(a => typeof a === 'string' && a.trim()) : [];
  if (!list.length || !product || !Array.isArray(product.ingredients)) return [];
  const hits = [];
  for (const ing of product.ingredients) {
    const n = normalizeEntityName(ing);
    if (!n) continue;
    if (list.some(a => {
      const an = normalizeEntityName(a);
      return an && (n.includes(an) || an.includes(n));
    })) {
      hits.push(ing);
    }
  }
  return hits;
}

/**
 * 두 전성분 목록의 3분할 비교 (정규화 이름 기준).
 * @param {string[]} aList
 * @param {string[]} bList
 * @returns {{common:string[], aOnly:string[], bOnly:string[]}|null}
 */
export function compareIngredientLists(aList, bList) {
  const a = Array.isArray(aList) ? aList : [];
  const b = Array.isArray(bList) ? bList : [];
  if (!a.length || !b.length) return null;
  const aNorm = new Map(a.map(n => [normalizeEntityName(n), n]));
  const bNorm = new Map(b.map(n => [normalizeEntityName(n), n]));
  const common = [];
  const aOnly = [];
  aNorm.forEach((orig, norm) => (bNorm.has(norm) ? common : aOnly).push(orig));
  const bOnly = [];
  bNorm.forEach((orig, norm) => { if (!aNorm.has(norm)) bOnly.push(orig); });
  return { common, aOnly, bOnly };
}

/**
 * 기성품 전성분 ↔ My 포뮬러 전성분 3분할 비교 (정규화 이름 기준).
 * @param {object} product
 * @param {object} formula - fullIngredients 보유 포뮬러
 * @returns {{common:string[], productOnly:string[], formulaOnly:string[]}|null}
 */
export function compareWithFormula(product, formula) {
  const cmp = compareIngredientLists(
    (product && product.ingredients) || [],
    (formula && formula.fullIngredients) || []);
  return cmp ? { common: cmp.common, productOnly: cmp.aOnly, formulaOnly: cmp.bOnly } : null;
}

/**
 * 기성품 ↔ 기성품 3분할 비교 — 두 시판 제품의 성분 구성 대조 (FO-45).
 * @param {object} a
 * @param {object} b
 * @returns {{common:string[], aOnly:string[], bOnly:string[]}|null}
 */
export function compareWithProduct(a, b) {
  return compareIngredientLists(
    (a && a.ingredients) || [],
    (b && b.ingredients) || []);
}

/**
 * 전성분 중첩도 기준 유사 포뮬러 랭킹 — Jaccard 유사도 내림차순 (FO-45).
 * @param {object} product
 * @param {object[]} formulas - 후보 포뮬러 (fullIngredients 없는 항목은 제외)
 * @param {number} [limit] - 상위 개수
 * @returns {Array<{formula:object, common:number, union:number, ratio:number}>}
 */
export function rankFormulasByOverlap(product, formulas, limit = 3) {
  const pList = (product && product.ingredients) || [];
  if (!pList.length || !Array.isArray(formulas)) return [];
  return formulas
    .filter(f => f && Array.isArray(f.fullIngredients) && f.fullIngredients.length)
    .map(f => {
      const cmp = compareIngredientLists(pList, f.fullIngredients)
        || { common: [], aOnly: [], bOnly: [] };
      const union = cmp.common.length + cmp.aOnly.length + cmp.bOnly.length;
      return {
        formula: f,
        common: cmp.common.length,
        union,
        ratio: union ? cmp.common.length / union : 0,
      };
    })
    .filter(r => r.common > 0)
    .sort((x, y) => y.ratio - x.ratio || y.common - x.common)
    .slice(0, limit);
}

/* =======================================================
   전성분 표시 순서 힌트 (FO-44)
   ======================================================= */

/**
 * 색소 계열 성분 뒤에 비색소 성분이 표기되면 법정 표시 규칙(색소는 함량 무관
 * 최하단 — buildFullIngredients와 동일 규칙)과 어긋나므로 힌트를 돌려준다.
 * 판정이 아니라 라벨 원문·입력 오류 검토 유도다.
 * @param {object} product
 * @returns {{misplaced:string[]}|null} - 순서가 어긋난 색소명 목록 또는 null
 */
export function detectOrderHint(product) {
  const list = (product && product.ingredients) || [];
  const misplaced = [];
  for (let i = 0; i < list.length; i++) {
    if (!COLORANT_RE.test(list[i])) continue;
    if (list.slice(i + 1).some(n => !COLORANT_RE.test(n))) misplaced.push(list[i]);
  }
  return misplaced.length ? { misplaced } : null;
}

/* =======================================================
   JSON보내기·가져오기 — serializeFormula/importFormula 패턴
   ======================================================= */

/**
 * 제품 단건 JSON 직렬화 — 외부 공유용. id·타임스탬프는 제외(가져오기 시 재부여).
 */
export function serializeProduct(product) {
  const clean = sanitize(product || {});
  return JSON.stringify({ type: 'formula-os-product', version: 1, product: clean }, null, 2);
}

/**
 * 분석 결과 JSON 직렬화 — 조회 시점 라이브 판정을 스냅샷으로 내보낸다 (FO-45).
 * 판정은 내보내기 시점의 원료 DB 기준 — 고시 개정 후엔 재분석이 필요하다.
 * @param {object} product
 * @param {Map<string,object>} index - 공식+자가 병합 인덱스
 * @returns {string}
 */
export function serializeProductAnalysis(product, index) {
  const clean = sanitize(product || {});
  const { results, summary } = classifyProductIngredients(clean, index);
  const hint = detectOrderHint(clean);
  return JSON.stringify({
    type: 'formula-os-product-analysis',
    version: 1,
    generatedAt: new Date().toISOString(),
    product: { name: clean.name, brand: clean.brand, category: clean.category, note: clean.note },
    summary,
    orderHint: hint ? hint.misplaced : [],
    ingredients: results.map((r, i) => ({ order: i + 1, name: r.name, cls: r.cls, note: r.note })),
  }, null, 2);
}

/**
 * 제품 JSON 가져오기 — sanitize + createProduct(Free 한도·중복 적용).
 * type 래퍼가 있으면 풀고, 날것의 제품 객체도 허용한다.
 * @returns {{ok:boolean, item?:object, error?:string}}
 */
export function importProduct(input) {
  let parsed;
  try { parsed = typeof input === 'string' ? JSON.parse(input) : input; }
  catch (e) { return { ok: false, error: 'JSON 파일을 해석할 수 없습니다.' }; }
  const data = parsed && parsed.type === 'formula-os-product' ? parsed.product : parsed;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: '제품 데이터가 없습니다.' };
  }
  return createProduct(data);
}
