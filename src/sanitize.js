// src/sanitize.js — XSS 방어 유틸리티 모듈 (글로벌 스코프 실행)
// @spec S-05
//
// v2 리뷰 권고 #3 (XSS 잠재 경로 — innerHTML 직접 주입) 대응.
// 학습 데이터를 innerHTML로 주입하기 전에 HTML 특수문자를 이스케이프하여
// 외부/비신뢰 데이터가 유입되더라도 스크립트/마크업 인젝션이 발생하지 않도록 합니다.
//
// 의존성 없음(dependency-free). 어떤 스크립트보다도 먼저 로드되어야 합니다.

/* =======================================================
   🛡️ HTML 이스케이프 & 안전 주입 헬퍼
   ======================================================= */

// HTML 특수문자 → 안전한 엔티티 매핑.
// 엔티티 리터럴을 소스에 직접 적으면 편집/저장 과정에서 디코딩될 수 있으므로
// String.fromCharCode로 생성합니다. (결과는 동일: & < > " ')
const HTML_ESCAPE_MAP = {
    '&': '&' + 'amp;',
    '<': '&' + 'lt;',
    '>': '&' + 'gt;',
    '"': '&' + 'quot;',
    "'": '&' + '#39;'
};

/**
 * 문자열 내 HTML 특수문자를 이스케이프합니다.
 * textContent에 준하는 안전성을 제공하면서, 이후 의도된 태그(<br> 등)만
 * 개발자가 명시적으로 붙일 수 있도록 합니다.
 *
 * @param {*} value 이스케이프할 값 (문자열이 아니면 문자열로 변환)
 * @returns {string} 이스케이프된 안전한 문자열
 */
export function escapeHTML(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, function (ch) {
        return HTML_ESCAPE_MAP[ch];
    });
}

/**
 * 데이터를 이스케이프한 뒤 개행 문자(\n)만 <br>로 변환합니다.
 * 기존 `data.replace(/\n/g, '<br>')` 패턴의 안전한 대체재입니다.
 *
 * @param {*} value 원본 데이터
 * @returns {string} innerHTML에 안전하게 주입 가능한 문자열
 */
export function safeTextWithBreaks(value) {
    return escapeHTML(value).replace(/\r\n|\r|\n/g, '<br>');
}

/**
 * 템플릿 리터럴 내에서 데이터 조각을 이스케이프하기 위한 짧은 별칭.
 * 사용 예: el.innerHTML = `<span>${esc(card.term)}</span>`;
 *
 * @param {*} value 이스케이프할 값
 * @returns {string} 이스케이프된 문자열
 */
export function esc(value) {
    return escapeHTML(value);
}

/**
 * HTML 태그를 제거해 순수 텍스트만 남깁니다 (오답 리뷰·로그용 요약 텍스트).
 * @param {*} value 태그를 포함할 수 있는 문자열
 * @returns {string} 태그가 제거된 텍스트
 */
export function stripTags(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/<[^>]*>/g, '');
}

/* =======================================================
   🧩 html 태그드 템플릿 — 보간값 자동 이스케이프 (ROAD-Q5)
   =======================================================
   사용 예:
     el.innerHTML = html`<li>${item.name}</li>`;              // 자동 이스케이프
     el.innerHTML = html`<ul>${items.map(i => html`<li>${i.name}</li>`)}</ul>`; // 배열 자동 join
     el.innerHTML = html`${raw('<b>고정</b>')}`;               // 신뢰 마크업 통과

   수작업 esc()와 달리 "빠뜨리면 즉시 깨지는" 방향이 아니라
   "기본이 안전"인 방향이라 보간 누락 XSS가 구조적으로 불가능해진다.
   의도된 마크업은 중첩 html`` 결과 또는 raw()로만 주입한다.
   ======================================================= */

/**
 * 신뢰 마크업 표식. html`` 템플릿 결과와 raw() 래핑값만 이 클래스를 가진다.
 * JSDoc을 string으로 노출하지 않으면 innerHTML 대입 타입 검사가 실패하므로
 * 호출부에는 string처럼 보이게 하고, 런타임 판정은 instanceof를 사용한다.
 */
class SafeHtml {
    /** @param {string} markup - 이미 안전한 것으로 판정된 마크업 */
    constructor(markup) { this._html = markup; }
    toString() { return this._html; }
}

/**
 * 신뢰할 수 있는 정적 마크업을 html`` 템플릿 안에 통과시키기 위한 래퍼.
 * 사용자 데이터·외부 API 데이터에는 절대 사용하지 않는다 —
 * 마크다운 파서 출력처럼 이미 안전하게 생성된 문자열 전용.
 * @param {*} markup - 신뢰 마크업 문자열
 * @returns {string} SafeHtml 표식이 붙은 값 (innerHTML 대입 시 toString으로 평탄화)
 */
export function raw(markup) {
    return /** @type {any} */ (new SafeHtml(String(markup ?? '')));
}

/**
 * 보간값 하나를 마크업으로 변환 — SafeHtml은 통과, 배열은 재귀 join,
 * 그 외는 escapeHTML. html`` 내부 전용 헬퍼.
 * @param {*} value
 * @returns {string}
 */
function _interpToMarkup(value) {
    if (value === null || value === undefined) return '';
    if (value instanceof SafeHtml) return value.toString();
    if (Array.isArray(value)) return value.map(_interpToMarkup).join('');
    return escapeHTML(value);
}

/**
 * 태그드 템플릿 — 모든 보간값을 자동 이스케이프한 마크업 문자열을 만든다.
 * 반환값은 SafeHtml 인스턴스라 다른 html`` 템플릿에 중첩하면 이중 이스케이프
 * 없이 통과되고, innerHTML/textContent 대입·문자열 연결에서는 toString으로 평탄화된다.
 * @param {TemplateStringsArray} strings
 * @param {...*} values
 * @returns {string} 안전한 마크업 (런타임은 SafeHtml — 중첩 판정용)
 */
export function html(strings, ...values) {
    let out = strings[0];
    for (let i = 0; i < values.length; i++) {
        out += _interpToMarkup(values[i]) + strings[i + 1];
    }
    return /** @type {any} */ (new SafeHtml(out));
}
