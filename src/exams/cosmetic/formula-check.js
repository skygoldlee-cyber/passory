// src/exams/cosmetic/formula-check.js — Formula OS 규정 Check 엔진 (Phase 5-A)
// @spec FO-02,FO-50,FO-55,DI-07
//
// 원료 + 배합 농도(%) → 법정 한도 검증. 배합을 "생성"하지 않고 공식 고시
// 데이터로 "검증"만 수행한다 (생성·검증 분리 원칙).
//
// 핵심 원칙: 파싱 실패·모호한 경우는 반드시 'unknown'.
// 잘못된 ok/warn 판정보다 사람이 원문을 확인하게 하는 미탐이 안전하다.

import { normalizeEntityName } from '../../utils.js';

export const CHECK = Object.freeze({
  OK: 'ok',
  WARN: 'warn',
  BANNED: 'banned',
  UNKNOWN: 'unknown',
});

// "5.0%"·"0.0015%" 형태의 백분율 수치 추출
const PCT_RE = /(\d+(?:\.\d+)?)\s*%/g;
// "N% 초과 시 표시" — 사용 한도가 아니라 라벨 표시 기준
const LABELING_RE = /초과\s*시\s*표시/;
// 명시적 금지 표현 — 기성품 분석(product-store.js)도 같은 규칙으로 금지 성분명을 매칭한다
export const BAN_TEXT_RE = /사용\s*불가|사용\s*금지/;

/**
 * 한도 문자열을 파싱한다.
 * @param {string|null|undefined} limitText - INGREDIENTS_DATA의 limit 필드
 * @returns {{values:number[], primary:number|null, conditional:boolean, labeling:boolean}}
 *   values: 발견된 % 수치 전부 (내림차순 아님, 원문 순서)
 *   primary: 검증 기준값 = 가장 엄격한 값(min). 수치 없으면 null
 *   conditional: 수치 외 적용 조건 텍스트 존재 여부 (제품별/씻어내는 등)
 *   labeling: "N% 초과 시 표시" 등 한도가 아닌 표시 기준 여부
 */
export function parseLimitText(limitText) {
  /** @type {{values:number[], primary:number|null, conditional:boolean, labeling:boolean}} */
  const result = { values: [], primary: null, conditional: false, labeling: false };
  if (!limitText || typeof limitText !== 'string') return result;

  const text = limitText.trim();
  if (!text) return result;

  if (LABELING_RE.test(text)) {
    result.labeling = true;
    return result;
  }

  /** @type {number[]} */
  const values = [];
  let m;
  PCT_RE.lastIndex = 0;
  while ((m = PCT_RE.exec(text)) !== null) {
    const v = parseFloat(m[1]);
    if (!Number.isNaN(v)) values.push(v);
  }
  result.values = values;

  if (values.length > 0) {
    result.primary = Math.min(...values);
    // 수치와 구분 기호(쉼표·중점·공백·괄호조건)를 제외한 텍스트가 남으면 조건부로 간주
    const stripped = text
      .replace(PCT_RE, '')
      .replace(/\([^)]*\)/g, '')
      .replace(/[,\s•·.\-–—]/g, '');
    // 괄호 안 조건도 실질 조건이므로, 괄호가 있었거나 잔여 문자가 있으면 conditional
    result.conditional = /\([^)]*\)/.test(text) || stripped.length > 0 || values.length > 1;
  }
  return result;
}

/**
 * 단일 원료의 배합 농도를 검증한다.
 * @param {object|null} ingredient - INGREDIENTS_DATA 항목 {name,type,limit,...}
 * @param {number|string} concentration - 배합 농도 (%)
 * @returns {{check:string, primaryLimit:number|null, conditional:boolean, note:string, raw:string}}
 */
export function checkIngredient(ingredient, concentration) {
  /** @type {{check:string, primaryLimit:number|null, conditional:boolean, note:string, raw:string}} */
  const base = { check: CHECK.UNKNOWN, primaryLimit: null, conditional: false, note: '', raw: '' };

  if (!ingredient || typeof ingredient !== 'object') {
    return { ...base, note: '원료 DB에서 찾을 수 없습니다 — 한도를 직접 확인하세요.' };
  }
  base.raw = ingredient.limit || '';

  // 자가 등록 원료 (DI-07) — 법정 유형 선언 금지. 자가 선언 한도는 경고에 반영하되
  // 결과에 custom 플래그를 붙여 '법정 판정 통과'와 시각·문구를 구분한다.
  const isCustom = ingredient.custom === true || ingredient.type === 'custom';
  const mark = r => (isCustom ? { ...r, custom: true } : r);

  // 사용 금지 원료 — 수치 검증 이전에 차단
  if (!isCustom && (ingredient.type === 'banned' || BAN_TEXT_RE.test(ingredient.limit || ''))) {
    return { ...base, check: CHECK.BANNED, note: '사용 금지 원료 — 배합 불가' };
  }

  const conc = typeof concentration === 'string' ? parseFloat(concentration) : concentration;
  if (typeof conc !== 'number' || Number.isNaN(conc)) {
    return { ...base, note: '농도 미입력 — 배합률(%)을 입력하면 한도를 검증합니다.' };
  }
  if (conc <= 0) {
    return { ...base, note: '농도 확인 필요 — 0% 초과로 입력하세요.' };
  }

  const parsed = parseLimitText(ingredient.limit);
  base.primaryLimit = parsed.primary;
  base.conditional = parsed.conditional;

  // 한도 정보가 없는 경우
  if (!parsed.values.length) {
    if (parsed.labeling) {
      return mark({ ...base, note: '표시 기준 수치 — 사용 한도가 아닙니다. 원문 확인.' });
    }
    if (!base.raw) {
      if (isCustom) {
        return mark({ ...base, check: CHECK.OK, note: '자가 등록 원료 — 한도 미선언. 공급사 스펙을 확인하세요.' });
      }
      // 한도 표기 없음: approved는 사용 가능, restricted는 확인 필요
      return ingredient.type === 'restricted'
        ? { ...base, note: '사용 제한 원료 — 한도 정보가 없어 원문 확인이 필요합니다.' }
        : { ...base, check: CHECK.OK, note: '제한 없음 (사용 가능 원료)' };
    }
    return mark({ ...base, note: isCustom ? '자가 선언 한도 해석 불가 — 수치를 포함해 입력하세요.' : '한도 수치 해석 불가 — 원문을 확인하세요.' });
  }

  if (conc > /** @type {number} */ (parsed.primary)) {
    return mark({
      ...base,
      check: CHECK.WARN,
      note: isCustom
        ? `자가 등록 한도 ${parsed.primary}% 초과 — 공급사 스펙 기준`
        : `기준 한도 ${parsed.primary}% 초과${parsed.conditional ? ' — 조건별 한도 확인 필요' : ''}`,
    });
  }
  return mark({
    ...base,
    check: CHECK.OK,
    note: isCustom
      ? '자가 등록 한도 이내'
      : (parsed.conditional ? '한도 이내 — 조건부 한도(제품류·씻어내는 등) 적용 여부 확인' : '한도 이내'),
  });
}

/**
 * 원료 이름 → 항목 인덱스를 생성한다.
 * @param {Array<object>} ingredients - INGREDIENTS_DATA
 * @returns {Map<string, object>}
 */
export function buildIngredientIndex(ingredients) {
  const index = new Map();
  if (!Array.isArray(ingredients)) return index;
  for (const ing of ingredients) {
    if (ing && typeof ing.name === 'string' && !index.has(ing.name)) {
      index.set(ing.name, ing);
    }
  }
  return index;
}

// 인덱스 인스턴스별 정규화 키 맵 — getIndex() 재구축 시 인스턴스가 바뀌므로
/**
 * 조회 전용 정규화 — normalizeEntityName(공백·대소문자)에 하이픈·대시 제거 추가 (FO-50).
 * '1,2-헥산디올' ↔ '1,2 헥산디올'·'피이지-100' ↔ '피이지 100' 띄어쓰기-하이픈
 * 변형의 미스매치 방지. 식별(중복 검사)은 normalizeEntityName 유지 — 표기 변형이
 * 다른 항목을 합치지 않도록 조회 경로에만 느슨한 키를 쓴다.
 * @param {*} name
 * @returns {string}
 */
export function ingredientMatchKey(name) {
  return normalizeEntityName(name).replace(/[-‐-―–—−]/g, '');
}

// 괄호 안의 설명·제외 문구 — 병기 부분 키에서 걸러낸다
const PAREN_ANNOTATION_RE = /제외|한함|이하|이상|까지|로서|부가|예\s*:/;

/**
 * 괄호 병기명의 부분 키 — '토코페롤(비타민E)'는 '토코페롤'·'비타민E'로도
 * 해석한다. DB가 '성분명(속칭)'·'클래스(구성원 A, B에 한함)' 형태를 쓰므로
 * 바깥쪽·괄호 내 각 요소를 부분 키로 등록한다 (FO-50).
 * @param {string} name
 * @returns {string[]}
 */
export function parenNameParts(name) {
  if (typeof name !== 'string' || !/[(\[（]/.test(name)) return [];
  const parts = [];
  const outer = name.replace(/[(\[（][^)\]）]*[)\]）]/g, '').trim();
  if (outer) parts.push(outer);
  const innerRe = /[(\[（]([^)\]）]*)[)\]）]/g;
  let m;
  while ((m = innerRe.exec(name)) !== null) {
    for (const p of m[1].split(/[,·/]/)) {
      const t = p.trim();
      if (t.length >= 2 && !PAREN_ANNOTATION_RE.test(t)) parts.push(t);
    }
  }
  return parts;
}

/**
 * 명시 동의어 — 판매 페이지 속칭·영문 → 표준명 (키는 ingredientMatchKey 정규화값).
 * 괄호 병기로 해결되지 않는 쌍만 등록한다. 염·유도체가 다른 성분(스쿠알렌↔
 * 스쿠알란, 세틸↔세테아릴)은 화학적으로 별개라 등록하지 않는다.
 */
export const INGREDIENT_ALIASES = Object.freeze({
  'bha': '살리실산',
  '비타민a': '레티놀',
  '비타민b3': '나이아신아마이드',
  '프로비타민b5': '판테놀',
  '아스코빅애씨드': '아스코르브산',
  '산화아연': '징크옥사이드',
  '이산화티타늄': '티타늄디옥사이드',
  '티타늄이산화물': '티타늄디옥사이드',
  '소듐하이알루로네이트': '히알루론산',
  '소디움하이알루로네이트': '히알루론산',
  '히알루론산나트륨': '히알루론산',
  '히아루론산': '히알루론산',
  '알코올': '에탄올',
  '글리세롤': '글리세린',
  '호호바씨오일': '호호바오일',
  '메칠파라벤': '파라벤류',
  '메틸파라벤': '파라벤류',
  '에칠파라벤': '파라벤류',
  '에틸파라벤': '파라벤류',
  '프로필파라벤': '파라벤류',
  '부틸파라벤': '파라벤류',
  '이소프로필파라벤': '파라벤류',
  '이소부틸파라벤': '파라벤류',
});

// WeakMap으로 묶어 캐시한다 (공백·대소문자·하이픈 차이만 있는 입력의 미스매치 방지)
const _normIndexCache = new WeakMap();

function normalizedIndex(index) {
  let m = _normIndexCache.get(index);
  if (!m) {
    m = new Map();
    if (index && typeof index.forEach === 'function') {
      index.forEach((v, k) => {
        const nk = ingredientMatchKey(k);
        if (nk && !m.has(nk)) m.set(nk, v);
        // 괄호 병기 부분 키 — '토코페롤(비타민E)' → '토코페롤'·'비타민e' (FO-50)
        for (const part of parenNameParts(k)) {
          const pk = ingredientMatchKey(part);
          if (pk && !m.has(pk)) m.set(pk, v);
        }
      });
    }
    _normIndexCache.set(index, m);
  }
  return m;
}

/**
 * 원료 조회 — 정확 일치 우선, 실패 시 matchKey(공백·대소문자·하이픈 무시) 폴백
 * → 입력 자체의 괄호 부분 → 명시 동의어 순으로 해석한다 (FO-50).
 * 전성분 붙여넣기·OCR·속칭 입력이 '미등록'으로 오분류되는 것을 막는다.
 * @param {Map<string,object>} index - buildIngredientIndex() 결과 (자가 병합 포함)
 * @param {string} name
 * @returns {object|null}
 */
export function findIngredient(index, name) {
  if (!index || typeof index.get !== 'function' || typeof name !== 'string') return null;
  const direct = index.get(name);
  if (direct) return direct;
  const idx = normalizedIndex(index);
  const norm = ingredientMatchKey(name);
  let hit = norm ? idx.get(norm) : null;
  if (hit) return hit;
  // 입력 자체의 괄호 병기 — '살리실산(베타)'는 바깥·안쪽 부분으로도 해석
  for (const part of parenNameParts(name)) {
    const pk = ingredientMatchKey(part);
    hit = pk ? idx.get(pk) : null;
    if (hit) return hit;
  }
  // 명시 동의어 — 속칭·영문 → 표준명 (1회 전이, 순환 없음)
  const alias = norm && INGREDIENT_ALIASES[norm];
  if (alias) {
    return index.get(alias) || idx.get(ingredientMatchKey(alias)) || null;
  }
  return null;
}

/* =======================================================
   OCR 치환 의심 — 근사 매칭 검토 유도 (FO-55)
   ======================================================= */

/**
 * 경계 편집거리 — max 초과 시 Infinity로 조기 종료.
 * 사진 인식의 1~2자 오인(메칠↔메틸, 이탄올↔에탄올)을 잡기 위한 상한 계산.
 */
function boundedEditDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return Infinity;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    let rowMin = row[0];
    for (let j = 1; j <= b.length; j++) {
      const t = row[j];
      row[j] = Math.min(t + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
      if (row[j] < rowMin) rowMin = row[j];
    }
    if (rowMin > max) return Infinity;
  }
  return row[b.length];
}

/**
 * 인식 초안의 치환 의심 — 사전 표준명·동의어 속칭과 키가 1~2자만 다른
 * 미등록 성분을 '라벨 원문 대조' 제안으로 돌려준다 (FO-55).
 * findIngredient로 해석되는 성분(정확·병기·동의어)은 제외하고, 키 길이
 * 4자 미만이거나 3자 이상 다른 이름도 걸러 노이즈를 제한한다.
 * 판정이 아닌 검토 유도 — 사용자가 원본 사진과 최종 대조한다.
 * @param {string[]} names
 * @param {Map<string,object>} index - buildIngredientIndex() 결과 (자가 병합 포함)
 * @returns {Array<{input:string, suggestion:string}>}
 */
export function suspectOcrSubstitutions(names, index) {
  if (!index || typeof index.forEach !== 'function') return [];
  // 후보 키 — 사전 표준명 + 동의어 속칭 (표시는 라벨에 가까운 속칭 우선)
  const known = new Map();
  index.forEach(v => {
    if (v && typeof v.name === 'string') {
      const k = ingredientMatchKey(v.name);
      if (k && !known.has(k)) known.set(k, v.name);
    }
  });
  for (const k of Object.keys(INGREDIENT_ALIASES)) {
    if (!known.has(k)) known.set(k, k);
  }
  const out = [];
  const seen = new Set();
  for (const n of names || []) {
    const key = ingredientMatchKey(n);
    if (!key || key.length < 4 || seen.has(key)) continue;
    seen.add(key);
    if (known.has(key) || findIngredient(index, n)) continue;
    const max = key.length >= 8 ? 2 : 1;
    let best = null;
    let bestD = Infinity;
    for (const [k, label] of known) {
      if (Math.abs(k.length - key.length) > max) continue;
      const d = boundedEditDistance(key, k, max);
      if (d > 0 && d < bestD) { bestD = d; best = label; }
    }
    if (best) out.push({ input: n, suggestion: best });
  }
  return out;
}

/**
 * 포뮬러의 원료 배열 전체를 검증한다.
 * @param {Array<{name:string, concentration:number|string}>} items
 * @param {Map<string, object>} index - buildIngredientIndex() 결과
 * @returns {{results: Array<object>, summary: {ok:number, warn:number, banned:number, unknown:number}}}
 */
export function checkFormulaItems(items, index) {
  const results = [];
  const summary = { ok: 0, warn: 0, banned: 0, unknown: 0 };
  if (!Array.isArray(items)) return { results, summary };

  for (const item of items) {
    if (!item) continue;
    const ingredient = index && typeof item.name === 'string' ? findIngredient(index, item.name) : null;
    const r = checkIngredient(ingredient, item.concentration);
    results.push({ name: item.name, ...r });
    summary[r.check] += 1;
  }
  return { results, summary };
}
