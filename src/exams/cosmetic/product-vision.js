// src/exams/cosmetic/product-vision.js — 기성품 사진 인식 (FO-41~43, FO-46, FO-54)
// @spec FO-41,FO-42,FO-43,FO-46,FO-54
//
// 제품 사진(정면: 제품명·브랜드 / 후면: 전성분)을 Gemini Flash에 보내
// 전성분을 JSON으로 추출한다. 추출 결과는 기성품 폼에 프리필되는 초안이며
// 직접 저장 경로는 없다 — 사용자 검토(칩) 후 기존 productSave 경로로 저장.
//
// BYOK 계약 (설계: docs/dev/design/PRODUCT_VISION_DESIGN.md):
//   - 사용자 자기 Gemini API 키 — FORMULA_GEMINI_KEY에 디바이스 로컬 저장
//   - BACKUP_KEYS 제외 — 백업·동기로 키가 새지 않도록 의도적 제외
//   - 사진·응답 원문은 영속하지 않는다 — 추출 후 폐기
//
// CSP: vercel.json connect-src에 generativelanguage.googleapis.com 등록됨.

import { STORAGE_KEYS } from '../../storage-keys.js';
import { getItem, setItem, removeItem } from '../../storage.js';
import { clampStr } from './store-utils.js';
import { normalizeEntityName } from '../../utils.js';

/** 기본 모델 — 미설정 시 사용되는 폴백 */
export const GEMINI_MODEL = 'gemini-2.0-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** 사용할 Gemini 모델명 — 사용자 설정(FORMULA_GEMINI_MODEL) 또는 기본값 (FO-46) */
export function getVisionModel() {
  return clampStr(getItem(STORAGE_KEYS.FORMULA_GEMINI_MODEL) || '', 80).trim() || GEMINI_MODEL;
}

/** 모델명 저장 — 비우면 기본값으로 되돌린다 */
export function saveVisionModel(model) {
  const m = clampStr(model || '', 80).trim();
  if (!m) { removeItem(STORAGE_KEYS.FORMULA_GEMINI_MODEL); return GEMINI_MODEL; }
  // 모델명 문자만 허용 — 경로 조작·프롬프트 주입 방지
  const safe = m.replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safe) return null;
  setItem(STORAGE_KEYS.FORMULA_GEMINI_MODEL, safe);
  return safe;
}

/** 고해상도 모드 여부 — 전송량 증가와 인식률의 트레이드오프를 사용자가 선택 (FO-54) */
export function getVisionHiRes() {
  return getItem(STORAGE_KEYS.FORMULA_VISION_HIRES) === '1';
}

export function saveVisionHiRes(on) {
  if (on) setItem(STORAGE_KEYS.FORMULA_VISION_HIRES, '1');
  else removeItem(STORAGE_KEYS.FORMULA_VISION_HIRES);
  return getVisionHiRes();
}

/** 현재 설정 기준 리사이즈 장변 상한 */
export function visionMaxSide() {
  return getVisionHiRes() ? MAX_SIDE_HIRES : MAX_SIDE;
}

function visionEndpoint() {
  return `${API_BASE}/${getVisionModel()}:generateContent`;
}

const MAX_SIDE = 1024;
/** 고해상도 모드 장변 — 촘촘한 전성분표 인식률 우선 (FO-54, opt-in) */
const MAX_SIDE_HIRES = 2048;
const JPEG_QUALITY = 0.85;
const MAX_ING_LEN = 120;
const MAX_ING_COUNT = 150;

/* =======================================================
   API 키 관리 (FO-41) — 디바이스 로컬·백업 제외
   ======================================================= */

export function getVisionKey() {
  return getItem(STORAGE_KEYS.FORMULA_GEMINI_KEY) || '';
}

export function saveVisionKey(key) {
  const k = clampStr(key || '', 200).trim();
  if (!k) return false;
  setItem(STORAGE_KEYS.FORMULA_GEMINI_KEY, k);
  return true;
}

export function clearVisionKey() {
  removeItem(STORAGE_KEYS.FORMULA_GEMINI_KEY);
}

/** 표시용 마스킹 — 앞 4자리만 노출 */
export function maskVisionKey(key) {
  const k = typeof key === 'string' ? key.trim() : '';
  if (!k) return '';
  return k.length <= 4 ? '••••' : `${k.slice(0, 4)}••••${k.slice(-4)}`;
}

/* =======================================================
   이미지 전처리 — 캔버스 리사이즈 + JPEG base64 (FO-41)
   ======================================================= */

/**
 * 이미지 파일을 장변 상한 이하 JPEG로 압축해 base64로 반환.
 * 상한은 opts.maxSide — 미지정 시 현재 설정(visionMaxSide: 기본 1024 ·
 * 고해상도 모드 2048, FO-54). jsdom 등 canvas 미지원 환경에서는 실패 결과를 돌려준다.
 * @param {Blob|File} file
 * @param {object} [opts] - {maxSide?: number}
 * @returns {Promise<{ok:boolean, data?:string, mimeType?:string, width?:number, height?:number, error?:string}>}
 */
export async function fileToBase64Jpeg(file, opts = {}) {
  try {
    if (!file) return { ok: false, error: '이미지가 없습니다.' };
    /** @type {ImageBitmap|HTMLImageElement} */
    let bmp;
    if (typeof createImageBitmap === 'function') {
      bmp = await createImageBitmap(file);
    } else {
      bmp = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('decode'));
        img.src = URL.createObjectURL(file);
      });
    }
    const maxSide = Number.isFinite(opts.maxSide) && opts.maxSide > 0 ? opts.maxSide : visionMaxSide();
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, error: '이미지 인코딩에 실패했습니다.' };
    ctx.drawImage(bmp, 0, 0, w, h);
    if (typeof /** @type {any} */ (bmp).close === 'function') /** @type {any} */ (bmp).close();
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    const data = dataUrl.split(',')[1] || '';
    if (!data) return { ok: false, error: '이미지 인코딩에 실패했습니다.' };
    return { ok: true, data, mimeType: 'image/jpeg', width: w, height: h };
  } catch (e) {
    return { ok: false, error: '이미지를 읽지 못했습니다 — 다른 사진으로 시도해 보세요.' };
  }
}

/* =======================================================
   Gemini 호출 — 프롬프트 계약·요청 형상·응답 파싱 (FO-42)
   ======================================================= */

/** 추출 프롬프트 — 전성분 표시 순서·자릿수 쉼표 규칙을 명시 */
export function buildExtractionPrompt() {
  return [
    '이 사진은 한국 화장품 제품의 라벨이다. 다음 규칙으로 정보를 추출하라.',
    '1. "전성분"(全成分) 표기를 찾아 표시 순서 그대로 성분명 배열로 추출하라.',
    '2. 성분명 안의 숫자 쉼표(예: 1,2-헥산디올, 2,3-부탄디올)는 성분을 나누지 않는다 — 한 토큰으로 유지하라.',
    '3. 광고 문구·사용법·제조번호·주의사항 등 전성분 외 텍스트는 무시하라.',
    '4. 읽을 수 없는 부분은 추측하지 말고 배열에서 빼라 — 확실하게 읽힌 성분만 담는다.',
    '5. 제품 정면이 보이면 제품명(name)·브랜드(brand)를 추출하고, 모르면 빈 문자열로 둬라.',
    '6. 제형이 확실히 판별되면 category에 한국어 제형명(예: 세럼, 로션, 크림)을 담고, 모르면 빈 문자열로 둬라.',
    '7. 전성분 표기가 없거나 라벨이 아니면 ingredients를 빈 배열로 반환하라.',
  ].join('\n');
}

/** 구조화 출력 스키마 — responseMimeType: application/json과 함께 사용 */
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    brand: { type: 'STRING' },
    category: { type: 'STRING' },
    ingredients: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['ingredients'],
};

/**
 * generateContent 요청 바디 — 텍스트 프롬프트 + 인라인 이미지들.
 * @param {Array<{data:string, mimeType:string}>} images
 */
export function buildRequestBody(images) {
  return {
    contents: [{
      parts: [
        { text: buildExtractionPrompt() },
        ...(images || []).map(img => ({
          inlineData: { mimeType: img.mimeType || 'image/jpeg', data: img.data },
        })),
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };
}

/**
 * Gemini 응답 → {name, brand, category, ingredients[]} 정제 결과.
 * 추출 성분도 스토어와 같은 클램프 규칙을 적용한다.
 * @param {object} json - API 응답 원문
 * @returns {{ok:boolean, name?:string, brand?:string, category?:string, ingredients?:string[], error?:string, code?:string}}
 */
export function parseExtractionResponse(json) {
  try {
    const text = json && json.candidates && json.candidates[0]
      && json.candidates[0].content && json.candidates[0].content.parts
      && json.candidates[0].content.parts[0]
      ? json.candidates[0].content.parts[0].text : '';
    if (!text) return { ok: false, code: 'unreadable', error: '전성분을 읽지 못했습니다.' };
    const parsed = JSON.parse(text);
    // 중복 제거 — 인식 초안이라 원문 보존 대상이 아니며, OCR 중복은
    // 성분 수·분석 요약을 오염시킨다 (정규화 이름 기준, 첫 등장 순서 유지)
    const seen = new Set();
    const ingredients = (Array.isArray(parsed.ingredients) ? parsed.ingredients : [])
      .map(s => clampStr(typeof s === 'string' ? s : '', MAX_ING_LEN).trim())
      .filter(s => {
        if (!s) return false;
        const n = normalizeEntityName(s);
        if (seen.has(n)) return false;
        seen.add(n);
        return true;
      })
      .slice(0, MAX_ING_COUNT);
    if (!ingredients.length) {
      return { ok: false, code: 'unreadable', error: '전성분을 읽지 못했습니다 — 후면 라벨이 잘 보이는 사진으로 다시 시도해 보세요.' };
    }
    return {
      ok: true,
      name: clampStr(parsed.name || '', 120).trim(),
      brand: clampStr(parsed.brand || '', 60).trim(),
      category: clampStr(parsed.category || '', 60).trim(),
      ingredients,
    };
  } catch (e) {
    return { ok: false, code: 'unreadable', error: '인식 결과를 해석하지 못했습니다 — 다시 시도해 보세요.' };
  }
}

/**
 * 사진으로 기성품 정보 추출 — 네트워크·키·파싱 오류를 code로 분기.
 * @param {Array<{data:string, mimeType:string}>} images - 전처리된 이미지 (후면 필수)
 * @param {object} [opts] - {signal?: AbortSignal, fetchImpl?: typeof fetch}
 * @returns {Promise<{ok:boolean, name?:string, brand?:string, category?:string, ingredients?:string[], error?:string, code?:string}>}
 */
export async function extractProductFromImages(images, opts = {}) {
  const key = getVisionKey();
  if (!key) return { ok: false, code: 'nokey', error: 'Gemini API 키가 설정되지 않았습니다.' };
  if (!Array.isArray(images) || !images.length || !images[0] || !images[0].data) {
    return { ok: false, code: 'noimage', error: '전성분이 보이는 사진이 필요합니다.' };
  }
  const fetchImpl = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchImpl) return { ok: false, code: 'network', error: '네트워크를 사용할 수 없습니다.' };
  let res;
  try {
    res = await fetchImpl(visionEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify(buildRequestBody(images)),
      signal: opts.signal,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') return { ok: false, code: 'aborted', error: '인식이 취소되었습니다.' };
    return { ok: false, code: 'network', error: '네트워크 연결을 확인하세요 — 사진 인식에는 온라인이 필요합니다.' };
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    return { ok: false, code: 'key', error: 'API 키가 유효하지 않습니다 — 키를 다시 확인하거나 새로 발급하세요.' };
  }
  if (res.status === 429) {
    return { ok: false, code: 'quota', error: '무료 사용량을 초과했습니다 — 잠시 후 다시 시도하세요.' };
  }
  if (!res.ok) {
    return { ok: false, code: 'http', error: `인식 요청이 실패했습니다 (HTTP ${res.status}).` };
  }
  let json;
  try { json = await res.json(); }
  catch (e) { return { ok: false, code: 'unreadable', error: '인식 응답을 해석하지 못했습니다.' }; }
  return parseExtractionResponse(json);
}

/**
 * 저장된 API 키 유효성 확인 — 모델 메타데이터 조회로 검증한다 (FO-46).
 * 추출 요청 없이 키·모델명 문제를 미리 구분한다.
 * @param {object} [opts] - {signal?: AbortSignal, fetchImpl?: typeof fetch}
 * @returns {Promise<{ok:boolean, model?:string, error?:string, code?:string}>}
 */
export async function validateVisionKey(opts = {}) {
  const key = getVisionKey();
  if (!key) return { ok: false, code: 'nokey', error: 'Gemini API 키가 설정되지 않았습니다.' };
  const fetchImpl = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchImpl) return { ok: false, code: 'network', error: '네트워크를 사용할 수 없습니다.' };
  let res;
  try {
    res = await fetchImpl(`${API_BASE}/${getVisionModel()}`, {
      headers: { 'x-goog-api-key': key },
      signal: opts.signal,
    });
  } catch (e) {
    return { ok: false, code: 'network', error: '네트워크 연결을 확인하세요.' };
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    return { ok: false, code: 'key', error: 'API 키가 유효하지 않습니다 — 키를 다시 확인하거나 새로 발급하세요.' };
  }
  if (res.status === 404) {
    return { ok: false, code: 'model', error: `모델 '${getVisionModel()}'을(를) 찾을 수 없습니다 — 모델명을 확인하세요.` };
  }
  if (!res.ok) {
    return { ok: false, code: 'http', error: `확인 요청이 실패했습니다 (HTTP ${res.status}).` };
  }
  return { ok: true, model: getVisionModel() };
}
