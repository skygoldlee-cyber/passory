// tests/unit/exams/cosmetic/product-vision.test.js
// @spec FO-41,FO-42,FO-43,FO-46,FO-54
// product-vision.js — 기성품 사진 인식 (BYOK Gemini).
// 검증: API 키 저장 계약(디바이스 로컬·백업 제외·마스킹),
//       요청 형상(프롬프트·inlineData·JSON 스키마·x-goog-api-key 헤더),
//       응답 파싱(정제·빈 배열·불량 JSON), 오류 분기(키·네트워크·쿼터·중단).

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getVisionKey, saveVisionKey, clearVisionKey, maskVisionKey,
  getVisionModel, saveVisionModel, validateVisionKey,
  getVisionHiRes, saveVisionHiRes, visionMaxSide,
  buildExtractionPrompt, buildRequestBody, parseExtractionResponse,
  extractProductFromImages, fileToBase64Jpeg,
} from '../../../../src/exams/cosmetic/product-vision.js';
import { STORAGE_KEYS, BACKUP_KEYS } from '../../../../src/storage-keys.js';

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

beforeEach(() => {
  mockStorage = createMockStorage();
  originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = mockStorage;
});

afterEach(() => {
  globalThis.localStorage = originalLocalStorage;
});

const IMG = { data: 'aGVsbG8=', mimeType: 'image/jpeg' };

function geminiResponse(payload) {
  return {
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
  };
}

/* =======================================================
   API 키 계약 (FO-41)
   ======================================================= */

test('키 저장·조회·삭제 — 디바이스 로컬 스토리지', () => {
  assert.equal(getVisionKey(), '');
  assert.equal(saveVisionKey('  test-key-1234  '), true);
  assert.equal(getVisionKey(), 'test-key-1234');
  clearVisionKey();
  assert.equal(getVisionKey(), '');
});

test('키 저장 — 빈 값은 거부', () => {
  assert.equal(saveVisionKey(''), false);
  assert.equal(saveVisionKey('   '), false);
  assert.equal(getVisionKey(), '');
});

test('키는 BACKUP_KEYS에 포함되지 않음 — 백업·동기 제외 계약', () => {
  assert.equal(BACKUP_KEYS.includes(STORAGE_KEYS.FORMULA_GEMINI_KEY), false);
});

test('키 마스킹 — 앞4+뒤4 노출, 짧은 키는 전부 마스킹', () => {
  assert.equal(maskVisionKey('AIza1234567890abcd'), 'AIza••••abcd');
  assert.equal(maskVisionKey('ab'), '••••');
  assert.equal(maskVisionKey(''), '');
});

/* =======================================================
   요청 형상 (FO-42)
   ======================================================= */

test('프롬프트 — 자릿수 쉼표·순서·추측 금지 규칙 포함', () => {
  const p = buildExtractionPrompt();
  assert.match(p, /1,2-헥산디올/);
  assert.match(p, /표시 순서/);
  assert.match(p, /추측하지/);
  assert.match(p, /그대로 옮겨라/);   // FO-55 — 유사어 치환·'교정' 금지
  assert.match(p, /치환하지/);
});

test('요청 바디 — 프롬프트 + inlineData 이미지 + JSON 스키마', () => {
  const body = buildRequestBody([IMG, { data: 'YWJj', mimeType: 'image/jpeg' }]);
  const parts = body.contents[0].parts;
  assert.equal(parts[0].text, buildExtractionPrompt());
  assert.equal(parts[1].inlineData.data, 'aGVsbG8=');
  assert.equal(parts[2].inlineData.data, 'YWJj');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(body.generationConfig.responseSchema.required, ['ingredients']);
});

/* =======================================================
   응답 파싱 (FO-42·FO-43)
   ======================================================= */

test('응답 파싱 — name·brand·ingredients 정제 반환', () => {
  const r = parseExtractionResponse(geminiResponse({
    name: '  수분 크림 ', brand: ' OO랩 ',
    ingredients: ['정제수', ' 글리세린 ', '', 42, '1,2-헥산디올'],
  }));
  assert.equal(r.ok, true);
  assert.equal(r.name, '수분 크림');
  assert.equal(r.brand, 'OO랩');
  assert.deepEqual(r.ingredients, ['정제수', '글리세린', '1,2-헥산디올']);
});

test('응답 파싱 — 빈 ingredients는 unreadable', () => {
  const r = parseExtractionResponse(geminiResponse({ ingredients: [] }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'unreadable');
});

test('응답 파싱 — 불량 JSON·candidates 없음은 unreadable', () => {
  assert.equal(parseExtractionResponse({ candidates: [{ content: { parts: [{ text: '{bad' }] } }] }).code, 'unreadable');
  assert.equal(parseExtractionResponse({}).code, 'unreadable');
  assert.equal(parseExtractionResponse(null).code, 'unreadable');
});

/* =======================================================
   호출 오류 분기 (FO-42)
   ======================================================= */

test('호출 — 키 미설정이면 nokey (fetch 미호출)', async () => {
  let called = false;
  const r = await extractProductFromImages([IMG], { fetchImpl: () => { called = true; } });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'nokey');
  assert.equal(called, false);
});

test('호출 — 이미지 없음은 noimage', async () => {
  saveVisionKey('k');
  assert.equal((await extractProductFromImages([], { fetchImpl: () => {} })).code, 'noimage');
  assert.equal((await extractProductFromImages([{}], { fetchImpl: () => {} })).code, 'noimage');
});

test('호출 — 성공 응답 → 파싱 결과 전달, 헤더에 키 전송', async () => {
  saveVisionKey('my-key');
  let sent;
  const fetchImpl = async (url, opts) => {
    sent = { url, opts };
    return { ok: true, status: 200, json: async () => geminiResponse({ name: 'A', brand: '', ingredients: ['정제수'] }) };
  };
  const r = await extractProductFromImages([IMG], { fetchImpl });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ingredients, ['정제수']);
  assert.equal(sent.opts.headers['x-goog-api-key'], 'my-key');
  assert.match(sent.url, /generativelanguage\.googleapis\.com/);
  assert.ok(!sent.url.includes('my-key')); // 키는 헤더 — URL에 남기지 않음
});

test('호출 — 400/403은 key 오류, 429는 quota, 네트워크 예외는 network', async () => {
  saveVisionKey('k');
  const mk = status => async () => ({ ok: false, status, json: async () => ({}) });
  assert.equal((await extractProductFromImages([IMG], { fetchImpl: mk(400) })).code, 'key');
  assert.equal((await extractProductFromImages([IMG], { fetchImpl: mk(403) })).code, 'key');
  assert.equal((await extractProductFromImages([IMG], { fetchImpl: mk(429) })).code, 'quota');
  assert.equal((await extractProductFromImages([IMG], { fetchImpl: mk(500) })).code, 'http');
  const boom = async () => { throw new Error('down'); };
  assert.equal((await extractProductFromImages([IMG], { fetchImpl: boom })).code, 'network');
});

test('호출 — AbortError는 aborted 코드', async () => {
  saveVisionKey('k');
  const aborter = async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; };
  const r = await extractProductFromImages([IMG], { fetchImpl: aborter });
  assert.equal(r.code, 'aborted');
});

test('이미지 전처리 — 입력 없음·canvas 미지원 환경에서 안전 실패', async () => {
  assert.equal((await fileToBase64Jpeg(null)).ok, false);
});

/* =======================================================
   모델 설정·키 검증·제형·dedupe (FO-46)
   ======================================================= */

test('모델 설정 — 기본값, 저장·정제·리셋', () => {
  assert.equal(getVisionModel(), 'gemini-2.0-flash');
  assert.equal(saveVisionModel('gemini-1.5-flash'), 'gemini-1.5-flash');
  assert.equal(getVisionModel(), 'gemini-1.5-flash');
  // 허용 문자 외는 제거 — 경로 조작 불가
  assert.equal(saveVisionModel('gemini/../x'), 'gemini..x');
  // 비우면 기본값 복귀
  assert.equal(saveVisionModel(''), 'gemini-2.0-flash');
  assert.equal(getVisionModel(), 'gemini-2.0-flash');
});

test('모델명은 백업 대상 — 크리덴셜 아닌 환경설정 계약', () => {
  assert.equal(BACKUP_KEYS.includes(STORAGE_KEYS.FORMULA_GEMINI_MODEL), true);
});

test('고해상도 모드 — 기본 1024, 켜면 2048, 끄면 복귀 (FO-54)', () => {
  assert.equal(getVisionHiRes(), false);
  assert.equal(visionMaxSide(), 1024);
  assert.equal(saveVisionHiRes(true), true);
  assert.equal(getVisionHiRes(), true);
  assert.equal(visionMaxSide(), 2048);
  assert.equal(saveVisionHiRes(false), false);
  assert.equal(visionMaxSide(), 1024);
});

test('고해상도 설정도 백업 대상 — 환경설정 계약 (FO-54)', () => {
  assert.equal(BACKUP_KEYS.includes(STORAGE_KEYS.FORMULA_VISION_HIRES), true);
  // 크리덴셜은 여전히 백업 제외
  assert.equal(BACKUP_KEYS.includes(STORAGE_KEYS.FORMULA_GEMINI_KEY), false);
});

test('전처리 옵션 — opts.maxSide를 받는 시그니처 (FO-54)', async () => {
  // jsdom은 canvas 미지원 — 파일 없이도 오류 경로만 확인 (시그니처 회귀 가드)
  const r = await fileToBase64Jpeg(null, { maxSide: 2048 });
  assert.equal(r.ok, false);
});

test('호출 URL — 설정 모델명이 엔드포인트에 반영', async () => {
  saveVisionKey('k');
  saveVisionModel('gemini-custom-9');
  let url = '';
  const r = await extractProductFromImages([IMG], {
    fetchImpl: async u => { url = u; return { ok: true, status: 200, json: async () => geminiResponse({ ingredients: ['정제수'] }) }; },
  });
  assert.equal(r.ok, true);
  assert.match(url, /models\/gemini-custom-9:generateContent/);
});

test('응답 파싱 — 중복 성분은 정규화 기준 제거, 제형 반환 (FO-46)', () => {
  const r = parseExtractionResponse(geminiResponse({
    name: '크림', category: '크림',
    ingredients: ['정제수', '글리세린', ' 정제수 ', '글리 세린', '판테놀'],
  }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.ingredients, ['정제수', '글리세린', '판테놀']);
  assert.equal(r.category, '크림');
});

test('키 검증 — nokey/성공/키오류/모델404/네트워크 분기 (FO-46)', async () => {
  assert.equal((await validateVisionKey()).code, 'nokey');
  saveVisionKey('k');
  const okRes = { ok: true, status: 200, json: async () => ({}) };
  assert.equal((await validateVisionKey({ fetchImpl: async () => okRes })).ok, true);
  const mk = status => async () => ({ ok: false, status, json: async () => ({}) });
  assert.equal((await validateVisionKey({ fetchImpl: mk(403) })).code, 'key');
  assert.equal((await validateVisionKey({ fetchImpl: mk(404) })).code, 'model');
  assert.equal((await validateVisionKey({ fetchImpl: mk(500) })).code, 'http');
  const boom = async () => { throw new Error('down'); };
  assert.equal((await validateVisionKey({ fetchImpl: boom })).code, 'network');
});
