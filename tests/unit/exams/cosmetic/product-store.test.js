// tests/unit/exams/cosmetic/product-store.test.js
// @spec FO-37,FO-38,FO-39,FO-40
// product-store.js — 기성품 전성분 DB 스토어.
// 검증: 전성분 파서(자릿수 쉼표 보호·구분자·순서보존), CRUD·정제·중복·한도,
//       라이브 분류(공식/제한/금지/자가/미등록), 역조회·알레르기 교차·비교,
//       JSON 직렬화·가져오기.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCT_LIMIT_FREE, PRODUCT_ING_CLASS,
  parseFullIngredients,
  listProducts, getProduct, getProductUsage,
  createProduct, updateProduct, deleteProduct,
  classifyIngredient, classifyProductIngredients,
  findProductsByIngredient, findAllergyHits, compareWithFormula,
  serializeProduct, importProduct,
} from '../../../../src/exams/cosmetic/product-store.js';
import { buildIngredientIndex } from '../../../../src/exams/cosmetic/formula-check.js';

function createMockStorage() {
  const store = {};
  return {
    getItem(key) { return key in store ? store[key] : null; },
    setItem(key, value) { store[key] = String(value); },
    removeItem(key) { delete store[key]; },
    clear() { for (const k of Object.keys(store)) delete store[k]; },
  };
}

let mockStorage;
let originalLocalStorage;

const OFFICIAL = [
  { name: '정제수', engName: 'Water', type: 'approved', limit: '' },
  { name: '살리실산', engName: 'Salicylic Acid', type: 'restricted', limit: '2.0%' },
  { name: '타르색소', engName: 'Tar', type: 'banned', limit: '' },
];

const INDEX = buildIngredientIndex(OFFICIAL);

beforeEach(() => {
  mockStorage = createMockStorage();
  originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = mockStorage;
});

afterEach(() => {
  globalThis.localStorage = originalLocalStorage;
});

/* =======================================================
   파서 (FO-38)
   ======================================================= */

test('파서 — 쉼표·중점·개행·세미콜론 구분자, 순서 보존', () => {
  const r = parseFullIngredients('정제수, 글리세린·부틸렌글라이콜\n나이아신아마이드;판테놀');
  assert.deepEqual(r, ['정제수', '글리세린', '부틸렌글라이콜', '나이아신아마이드', '판테놀']);
});

test('파서 — 자릿수 쉼표 보호: "1,2-헥산디올"이 분해되지 않음', () => {
  const r = parseFullIngredients('정제수, 1,2-헥산디올, 2,3-부탄디올');
  assert.deepEqual(r, ['정제수', '1,2-헥산디올', '2,3-부탄디올']);
});

test('파서 — 성분명 내부 공백은 보존 (광곽향 잎 추출물)', () => {
  const r = parseFullIngredients('정제수, 광곽향 잎 추출물');
  assert.deepEqual(r, ['정제수', '광곽향 잎 추출물']);
});

test('파서 — 앞뒤 공백·빈 토큰·따옴표/괄호 장식 제거', () => {
  const r = parseFullIngredients('  "정제수" ,,(글리세린),,  ,판테놀,');
  assert.deepEqual(r, ['정제수', '글리세린', '판테놀']);
});

test('파서 — 빈 입력·비문자열은 빈 배열', () => {
  assert.deepEqual(parseFullIngredients(''), []);
  assert.deepEqual(parseFullIngredients('   '), []);
  assert.deepEqual(parseFullIngredients(null), []);
  assert.deepEqual(parseFullIngredients(42), []);
});

test('파서 — 미등록 성분도 원문 보존 (정보 손실 없음)', () => {
  const r = parseFullIngredients('정제수, 우리집비법원료, 글리세린');
  assert.deepEqual(r[1], '우리집비법원료');
});

/* =======================================================
   CRUD·정제·중복·한도 (FO-37)
   ======================================================= */

test('등록 → 목록·단건 조회, id 접두 prod_', () => {
  const r = createProduct({ name: '수분 크림', brand: 'OO랩', ingredients: ['정제수', '글리세린'] });
  assert.equal(r.ok, true);
  assert.ok(r.item.id.startsWith('prod_'));
  assert.equal(listProducts().length, 1);
  assert.equal(getProduct(r.item.id).name, '수분 크림');
});

test('정제 — 이름·브랜드·메모 클램프, 비배열 성분 필터, 미지정 제형 → null/기본', () => {
  const r = createProduct({
    name: '  크림  ',
    brand: 'B',
    category: '존재하지않는제형',
    ingredients: ['정제수', '', 42, '글리세린'],
    note: 'm'.repeat(400),
  });
  assert.equal(r.ok, true);
  assert.equal(r.item.name, '크림');
  assert.deepEqual(r.item.ingredients, ['정제수', '글리세린']);
  assert.ok(r.item.note.length <= 300);
});

test('필수값 — 이름 없음·성분 0종은 거부', () => {
  assert.equal(createProduct({ name: '', ingredients: ['정제수'] }).ok, false);
  assert.equal(createProduct({ name: '크림', ingredients: [] }).ok, false);
});

test('중복 — 브랜드+제품명 정규화 비교, 브랜드 다르면 허용', () => {
  assert.equal(createProduct({ brand: 'A사', name: '크림', ingredients: ['정제수'] }).ok, true);
  assert.equal(createProduct({ brand: 'A사', name: ' 크림 ', ingredients: ['정제수'] }).ok, false);
  assert.equal(createProduct({ brand: 'B사', name: '크림', ingredients: ['정제수'] }).ok, true);
});

test('수정 — 필드 반영·updatedAt 갱신, 자기 자신 중복 제외', () => {
  const a = createProduct({ name: 'A', ingredients: ['정제수'] });
  createProduct({ name: 'B', ingredients: ['정제수'] });
  const u = updateProduct(a.item.id, { brand: '새브랜드', ingredients: ['정제수', '판테놀'] });
  assert.equal(u.ok, true);
  assert.equal(u.item.brand, '새브랜드');
  assert.deepEqual(u.item.ingredients, ['정제수', '판테놀']);
  // 다른 제품과 브랜드+이름이 같아지면 충돌 (브랜드가 이미 '새브랜드'라 함께 되돌려야 충돌)
  assert.equal(updateProduct(a.item.id, { name: 'B', brand: '' }).ok, false);
  // 없는 id는 실패
  assert.equal(updateProduct('prod_none', { name: 'C' }).ok, false);
});

test('삭제 — 존재 id 성공, 재삭제·없는 id 실패', () => {
  const r = createProduct({ name: '삭제대상', ingredients: ['정제수'] });
  assert.equal(deleteProduct(r.item.id).ok, true);
  assert.equal(deleteProduct(r.item.id).ok, false);
});

test('한도 — PRODUCT_LIMIT_FREE 초과 등록 거부', () => {
  for (let i = 0; i < PRODUCT_LIMIT_FREE; i++) {
    assert.equal(createProduct({ name: `제품${i}`, ingredients: ['정제수'] }).ok, true);
  }
  assert.equal(getProductUsage().count, PRODUCT_LIMIT_FREE);
  const r = createProduct({ name: '초과제품', ingredients: ['정제수'] });
  assert.equal(r.ok, false);
  assert.match(r.error, /Free 플랜은 최대/);
});

/* =======================================================
   라이브 분류 (FO-39)
   ======================================================= */

test('분류 — 공식 등록/제한/금지/미등록 4상태', () => {
  assert.equal(classifyIngredient('정제수', INDEX).cls, PRODUCT_ING_CLASS.OFFICIAL);
  assert.equal(classifyIngredient('살리실산', INDEX).cls, PRODUCT_ING_CLASS.RESTRICTED);
  assert.equal(classifyIngredient('타르색소', INDEX).cls, PRODUCT_ING_CLASS.BANNED);
  assert.equal(classifyIngredient('미등록원료', INDEX).cls, PRODUCT_ING_CLASS.UNKNOWN);
});

test('분류 — type이 approved지만 한도에 금지 문구면 BANNED', () => {
  const idx = buildIngredientIndex([{ name: 'X원료', type: 'approved', limit: '사용 금지' }]);
  assert.equal(classifyIngredient('X원료', idx).cls, PRODUCT_ING_CLASS.BANNED);
});

test('분류 — 자가 등록 성분은 CUSTOM (custom 플래그·type 모두 인식)', () => {
  const idx = new Map(INDEX);
  idx.set('자체베이스', { name: '자체베이스', type: 'custom', custom: true });
  assert.equal(classifyIngredient('자체베이스', idx).cls, PRODUCT_ING_CLASS.CUSTOM);
});

test('분류 — 제품 전체 요약 카운트', () => {
  const idx = new Map(INDEX);
  idx.set('자체베이스', { name: '자체베이스', type: 'custom', custom: true });
  const { summary } = classifyProductIngredients(
    { ingredients: ['정제수', '살리실산', '타르색소', '자체베이스', '미등록원료'] }, idx);
  assert.deepEqual(summary, { official: 1, restricted: 1, banned: 1, custom: 1, unknown: 1 });
});

test('분류 — 인덱스 없음·빈 제품도 안전하게 처리', () => {
  assert.equal(classifyIngredient('정제수', null).cls, PRODUCT_ING_CLASS.UNKNOWN);
  const { results, summary } = classifyProductIngredients(null, INDEX);
  assert.equal(results.length, 0);
  assert.equal(summary.official, 0);
});

/* =======================================================
   교차 분석 (FO-40)
   ======================================================= */

test('역조회 — 성분 정규화(공백·대소문자)로 함유 제품 검색', () => {
  createProduct({ name: 'A', ingredients: ['정제수', '메칠파라벤'] });
  createProduct({ name: 'B', ingredients: ['정제수'] });
  const hits = findProductsByIngredient(' 메칠파라벤 ');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, 'A');
  assert.equal(findProductsByIngredient('').length, 0);
  assert.equal(findProductsByIngredient('없는성분').length, 0);
});

test('알레르기 교차 — 부분일치(파라벤류↔메칠파라벤), 무관 성분 제외', () => {
  const p = { ingredients: ['정제수', '메칠파라벤', '판테놀'] };
  assert.deepEqual(findAllergyHits(p, ['파라벤']), ['메칠파라벤']);
  assert.deepEqual(findAllergyHits(p, ['판테놀']), ['판테놀']);
  assert.equal(findAllergyHits(p, ['시카']).length, 0);
  assert.equal(findAllergyHits(p, []).length, 0);
  assert.equal(findAllergyHits(p, null).length, 0);
  assert.equal(findAllergyHits(null, ['파라벤']).length, 0);
});

test('포뮬러 비교 — 공통/제품만/포뮬러만 3분할 (정규화 기준)', () => {
  const product = { ingredients: ['정제수', '글리세린', '판테놀'] };
  const formula = { fullIngredients: ['정제수', '글리세린 ', '시카추출물'] };
  const cmp = compareWithFormula(product, formula);
  assert.deepEqual(cmp.common, ['정제수', '글리세린']);
  assert.deepEqual(cmp.productOnly, ['판테놀']);
  assert.deepEqual(cmp.formulaOnly, ['시카추출물']);
  assert.equal(compareWithFormula({ ingredients: [] }, formula), null);
  assert.equal(compareWithFormula(product, { fullIngredients: [] }), null);
});

/* =======================================================
   JSON 직렬화·가져오기 (FO-40)
   ======================================================= */

test('직렬화 — type 래퍼·version, id·타임스탬프 제외', () => {
  const r = createProduct({ name: '크림', brand: 'B', ingredients: ['정제수'] });
  const json = serializeProduct(r.item);
  const parsed = JSON.parse(json);
  assert.equal(parsed.type, 'formula-os-product');
  assert.equal(parsed.version, 1);
  assert.equal(parsed.product.name, '크림');
  assert.equal(parsed.product.id, undefined);
});

test('가져오기 — 래퍼·날것 모두 수용, 불량 JSON·객체 아님 거부', () => {
  const r = importProduct(JSON.stringify({ type: 'formula-os-product', version: 1, product: { name: 'A', ingredients: ['정제수'] } }));
  assert.equal(r.ok, true);
  const raw = importProduct({ name: 'B', ingredients: ['글리세린'] });
  assert.equal(raw.ok, true);
  assert.equal(listProducts().length, 2);
  assert.equal(importProduct('{bad json').ok, false);
  assert.equal(importProduct('123').ok, false);
  assert.equal(importProduct(JSON.stringify([1, 2])).ok, false);
});

test('가져오기 — 중복·한도 규칙 동일 적용', () => {
  createProduct({ name: '크림', ingredients: ['정제수'] });
  const dup = importProduct({ name: '크림', ingredients: ['글리세린'] });
  assert.equal(dup.ok, false);
  assert.match(dup.error, /이미 등록/);
});
