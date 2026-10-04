// tests/unit/exams/cosmetic/product-store.test.js
// @spec FO-37,FO-38,FO-39,FO-40,FO-44,FO-45,FO-48,FO-49,FO-50,FO-51,FO-52,FO-53
// product-store.js — 기성품 전성분 DB 스토어.
// 검증: 전성분 파서(자릿수 쉼표 보호·구분자·순서보존), CRUD·정제·중복·한도,
//       라이브 분류(공식/제한/금지/자가/미등록), 역조회·알레르기 교차·비교,
//       JSON 직렬화·가져오기.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCT_LIMIT_FREE, PRODUCT_ING_CLASS,
  parseFullIngredients, parseFullIngredientsDetailed,
  listProducts, getProduct, getProductUsage,
  createProduct, updateProduct, deleteProduct,
  classifyIngredient, classifyProductIngredients,
  findProductsByIngredient, findAllergyHits, compareWithFormula,
  compareWithProduct, rankFormulasByOverlap, detectOrderHint,
  serializeProduct, serializeProductAnalysis, importProduct,
} from '../../../../src/exams/cosmetic/product-store.js';
import { buildIngredientIndex, findIngredient } from '../../../../src/exams/cosmetic/formula-check.js';

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

test('파서 — 전성분 필드 라벨은 구분자로 승격 (FO-48)', () => {
  const want = ['정제수', '글리세린'];
  assert.deepEqual(parseFullIngredients('전성분: 정제수, 글리세린'), want);
  assert.deepEqual(parseFullIngredients('전 성분\n정제수, 글리세린'), want);
  assert.deepEqual(parseFullIngredients('전성분표 : 정제수, 글리세린'), want);
  assert.deepEqual(parseFullIngredients('全成分：정제수, 글리세린'), want);
  assert.deepEqual(parseFullIngredients('INGREDIENTS: 정제수, 글리세린'), want);
  assert.deepEqual(parseFullIngredients('전성분(배합 순서): 정제수, 글리세린'), want);
});

test('파서 — 문장 끝 마침표·줄임표 제거 (FO-48)', () => {
  assert.deepEqual(
    parseFullIngredients('정제수, 글리세린, 부틸렌글라이콜.'),
    ['정제수', '글리세린', '부틸렌글라이콜']);
  assert.deepEqual(
    parseFullIngredients('정제수, 글리세린, 부틸렌글라이콜…'),
    ['정제수', '글리세린', '부틸렌글라이콜']);
});

test('파서 — 다른 필드 라벨은 제거하지 않음 — 칩 삭제로 처리 (FO-48)', () => {
  // '제품명:' 같은 비전성분 필드는 원문 보존 — 라벨 승격은 성분명 불가 키워드 한정
  const r = parseFullIngredients('제품명: 어떤세럼, 전성분: 정제수, 글리세린');
  assert.deepEqual(r, ['제품명: 어떤세럼', '정제수', '글리세린']);
});

test('파서 — 150종 초과분은 dropped로 보고 (FO-49)', () => {
  const many = Array.from({ length: 160 }, (_, i) => `성분${i}`).join(', ');
  const r = parseFullIngredientsDetailed(many);
  assert.equal(r.ingredients.length, 150);
  assert.equal(r.dropped, 10);
  // 상한 이내는 dropped 0, 빈 입력도 안전
  assert.equal(parseFullIngredientsDetailed('정제수, 글리세린').dropped, 0);
  assert.deepEqual(parseFullIngredientsDetailed(''), { ingredients: [], dropped: 0 });
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

test('중복 — 동명 충돌은 code:duplicate + existingId 반환 (FO-52)', () => {
  const a = createProduct({ name: '세럼', brand: 'X', ingredients: ['정제수'] });
  assert.equal(a.ok, true);
  const r = createProduct({ name: '세럼', brand: 'x ', ingredients: ['정제수', '글리세린'] });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'duplicate');
  assert.equal(r.existingId, a.item.id);
});

test('중복 — allowVariant로 리뉴얼 별도 등록 허용 (FO-52)', () => {
  createProduct({ name: '세럼', brand: 'X', ingredients: ['정제수'] });
  const r = createProduct(
    { name: '세럼', brand: 'X', ingredients: ['정제수', '나이아신아마이드'] },
    { allowVariant: true });
  assert.equal(r.ok, true);
  assert.equal(listProducts().length, 2);
});

test('중복 — 수정 경로는 리뉴얼 허용 없이 차단 (FO-52)', () => {
  const a = createProduct({ name: '세럼', brand: 'X', ingredients: ['정제수'] });
  createProduct({ name: '로션', brand: 'X', ingredients: ['정제수'] });
  const r = updateProduct(a.item.id, { name: '로션' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'duplicate');
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

test('분류 — 공백·대소문자 오차는 정규화 폴백으로 매칭 (미등록 오분류 방지)', () => {
  assert.equal(classifyIngredient('살리 실산', INDEX).cls, PRODUCT_ING_CLASS.RESTRICTED);
  assert.equal(classifyIngredient('정제 수', INDEX).cls, PRODUCT_ING_CLASS.OFFICIAL);
  assert.equal(classifyIngredient('타르 색소', INDEX).cls, PRODUCT_ING_CLASS.BANNED);
  // 정규화해도 없는 성분은 여전히 UNKNOWN
  assert.equal(classifyIngredient('그냥없는원료', INDEX).cls, PRODUCT_ING_CLASS.UNKNOWN);
});

/* =======================================================
   교차 분석 (FO-40)
   ======================================================= */

test('매칭 — 하이픈↔공백 변형은 조회 정규화로 해석 (FO-50)', () => {
  const idx = buildIngredientIndex([{ name: '1,2-헥산디올', type: 'approved', limit: '' }]);
  assert.equal(findIngredient(idx, '1,2 헥산디올').name, '1,2-헥산디올');
  assert.equal(findIngredient(idx, '1,2-헥산디올').name, '1,2-헥산디올');
});

test('매칭 — 괄호 병기 부분 키 해석 (FO-50)', () => {
  const idx = buildIngredientIndex([{ name: '토코페롤(비타민E)', type: 'approved', limit: '' }]);
  assert.equal(findIngredient(idx, '비타민E').name, '토코페롤(비타민E)');
  assert.equal(findIngredient(idx, '토코페롤').name, '토코페롤(비타민E)');
  // 입력 쪽 병기도 바깥 부분으로 해석 — '살리실산(베타)' → '살리실산'
  assert.equal(findIngredient(INDEX, '살리실산(베타)').name, '살리실산');
});

test('매칭 — 명시 동의어 속칭·영문 → 표준명 (FO-50)', () => {
  const idx = buildIngredientIndex([
    { name: '파라벤류', type: 'approved', limit: '0.4% (단일), 0.8% (혼합)' },
    { name: '징크옥사이드', type: 'restricted', limit: '25%' },
  ]);
  assert.equal(findIngredient(idx, '메칠파라벤').name, '파라벤류');
  assert.equal(findIngredient(idx, '에틸파라벤').name, '파라벤류');
  assert.equal(findIngredient(idx, '산화아연').name, '징크옥사이드');
  assert.equal(findIngredient(INDEX, 'BHA').name, '살리실산'); // 영문 약칭 → 표준명 (INDEX는 살리실산 보유)
});

test('매칭 — 동의어가 아닌 별개 성분은 건드리지 않음 (FO-50)', () => {
  // 스쿠알란↔스쿠알렌은 화학적으로 별개 — 의도적 미등록 유지
  const idx = buildIngredientIndex([{ name: '스쿠알렌', type: 'approved', limit: '' }]);
  assert.equal(findIngredient(idx, '스쿠알란'), null);
});

test('역조회 — 동의어 양방향 확장 (FO-50)', () => {
  createProduct({ name: 'A제품', brand: '', ingredients: ['파라벤류', '정제수'] });
  assert.equal(findProductsByIngredient('메칠파라벤').length, 1); // 속칭 → 클래스
  assert.equal(findProductsByIngredient('파라벤류').length, 1);
  createProduct({ name: 'B제품', brand: '', ingredients: ['메칠파라벤'] });
  assert.equal(findProductsByIngredient('파라벤류').length, 2); // 클래스 → 속칭 양방향
});

test('역조회 — 부분일치로 개별 성분 검색 (FO-51)', () => {
  // '파라벤' 검색은 동의어 없이도 '메칠파라벤'·'파라벤류' 함유 제품을 함유 관계로 포착
  createProduct({ name: 'A제품', brand: '', ingredients: ['파라벤류', '정제수'] });
  createProduct({ name: 'B제품', brand: '', ingredients: ['메칠파라벤'] });
  createProduct({ name: 'C제품', brand: '', ingredients: ['정제수'] });
  assert.equal(findProductsByIngredient('파라벤').length, 2);
  // 하이픈 변형도 matchKey로 해석
  createProduct({ name: 'D제품', brand: '', ingredients: ['1,2-헥산디올'] });
  assert.equal(findProductsByIngredient('1,2 헥산디올').length, 1);
});

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

test('제품 비교 — 기성품↔기성품 3분할 (FO-45)', () => {
  const a = { ingredients: ['정제수', '글리세린', '판테놀'] };
  const b = { ingredients: ['정제수', '스쿠알란', '판테놀'] };
  const cmp = compareWithProduct(a, b);
  assert.deepEqual(cmp.common, ['정제수', '판테놀']);
  assert.deepEqual(cmp.aOnly, ['글리세린']);
  assert.deepEqual(cmp.bOnly, ['스쿠알란']);
  assert.equal(compareWithProduct(a, { ingredients: [] }), null);
});

test('포뮬러 랭킹 — 유사도 내림차순·공통 없는 후보 제외·limit (FO-45)', () => {
  const product = { ingredients: ['정제수', '글리세린', '판테놀', '시카추출물'] };
  const formulas = [
    { id: 'f1', name: '저유사', fullIngredients: ['정제수', '미네랄오일'] },
    { id: 'f2', name: '고유사', fullIngredients: ['정제수', '글리세린', '판테놀', '시카추출물'] },
    { id: 'f3', name: '중유사', fullIngredients: ['정제수', '글리세린', '판테놀'] },
    { id: 'f4', name: '무공통', fullIngredients: ['스쿠알란'] },
    { id: 'f5', name: '전성분없음' },
  ];
  const ranked = rankFormulasByOverlap(product, formulas, 2);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].formula.id, 'f2');
  assert.equal(ranked[1].formula.id, 'f3');
  assert.ok(!ranked.some(r => r.formula.id === 'f4' || r.formula.id === 'f5'));
  assert.equal(rankFormulasByOverlap({ ingredients: [] }, formulas).length, 0);
});

/* =======================================================
   전성분 순서 힌트 (FO-44)
   ======================================================= */

test('순서 힌트 — 색소 뒤에 비색소가 오면 misplaced 보고', () => {
  const hint = detectOrderHint({ ingredients: ['정제수', '황색4호', '글리세린'] });
  assert.deepEqual(hint.misplaced, ['황색4호']);
});

test('순서 힌트 — 색소가 최하단이면 정상(null), 비색소만·색소만도 null', () => {
  assert.equal(detectOrderHint({ ingredients: ['정제수', '글리세린', '황색4호'] }), null);
  assert.equal(detectOrderHint({ ingredients: ['정제수', '글리세린'] }), null);
  assert.equal(detectOrderHint({ ingredients: ['황색4호', '적색201호'] }), null);
  assert.equal(detectOrderHint(null), null);
  assert.equal(detectOrderHint({ ingredients: [] }), null);
});

test('순서 힌트 — 무기안료·광택소재·레이크·금속가루도 색소로 검출 (FO-53)', () => {
  for (const colorant of ['황색4호레이크', '마이카티타늄', '비스무트옥시클로라이드', '알루미늄가루', '카본블랙', '틴옥사이드']) {
    const hint = detectOrderHint({ ingredients: ['정제수', colorant, '글리세린'] });
    assert.deepEqual(hint && hint.misplaced, [colorant], colorant);
  }
  // 색소끼리는 최하단 그룹 — 서로의 순서는 힌트 대상 아님
  assert.equal(detectOrderHint({ ingredients: ['정제수', '마이카티타늄', '황색4호'] }), null);
});

test('순서 힌트 — 탈크·마이카 단독은 색소 아님 — 기재 성분 오판 방지 (FO-53)', () => {
  assert.equal(detectOrderHint({ ingredients: ['탈크', '글리세린', '정제수'] }), null);
  assert.equal(detectOrderHint({ ingredients: ['마이카', '글리세린', '정제수'] }), null);
  assert.equal(detectOrderHint({ ingredients: ['합성플루오르플로고파이트', '글리세린'] }), null);
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

test('분석 직렬화 — 라이브 판정 스냅샷 (FO-45): 순서·배지·요약·힌트 포함', () => {
  const product = { name: '크림', brand: 'B', ingredients: ['정제수', '황색4호', '살리실산', '미등록원료'] };
  const parsed = JSON.parse(serializeProductAnalysis(product, INDEX));
  assert.equal(parsed.type, 'formula-os-product-analysis');
  assert.equal(parsed.version, 1);
  assert.equal(parsed.product.name, '크림');
  assert.equal(parsed.ingredients.length, 4);
  assert.equal(parsed.ingredients[0].order, 1);
  assert.equal(parsed.ingredients[2].cls, 'restricted');
  assert.equal(parsed.ingredients[3].cls, 'unknown');
  assert.equal(parsed.summary.official, 1);
  assert.deepEqual(parsed.orderHint, ['황색4호']);
  assert.ok(parsed.generatedAt);
});

test('가져오기 — 중복·한도 규칙 동일 적용', () => {
  createProduct({ name: '크림', ingredients: ['정제수'] });
  const dup = importProduct({ name: '크림', ingredients: ['글리세린'] });
  assert.equal(dup.ok, false);
  assert.match(dup.error, /이미 등록/);
});
