#!/usr/bin/env node
/**
 * check_html_escape.js — innerHTML/insertAdjacentHTML 싱크의 미이스케이프 보간 검출 (ROAD-Q5)
 *
 * 규약: HTML 싱크에 직접 대입되는 템플릿 리터럴의 모든 보간은
 *   - sanitize.js의 안전 호출로 시작해야 한다:
 *       esc( · escapeHTML( · safeTextWithBreaks( · stripTags( · raw(
 *   - 또는 `html` 태그드 템플릿(자동 이스케이프)이어야 한다
 *   - 또는 문자/숫자 리터럴이어야 한다
 *   - map(...).join(...) 안의 중첩 템플릿은 그 보간이 모두 안전하면 통과
 *   - 검토된 예외는 해당 라인에 `esc-ok` 주석으로 명시 면제한다
 *
 * 신규 코드는 html`...` 태그드 템플릿 사용을 권장한다 — 수작업 esc()는
 * 누락이 곧 XSS가 되지만, html``은 기본이 안전이라 보간을 빠뜨려도
 * 깨지지 않는다. ESCAPE_GAP_BASELINE은 기존 수작업 사이트의 승계 상한이며
 * 이관이 진행될수록 하향 조정한다 (단조 감소 — 신규 위반 유입 차단).
 *
 * 한계: `el.innerHTML = someVar` 형태의 변수 경유 대입은 정적 추적 불가 —
 * 직접 템플릿 대입만 검사한다.
 *
 * 사용법:
 *   node tools/check/check_html_escape.js
 */

// @spec S-05
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC_DIR = path.join(ROOT, 'src');

// 기존 수작업 esc() 사이트의 승계 상한 — 신규 위반 유입 시 초과로 실패.
// html`` 이관으로 줄이면 이 수치도 함께 낮춘다.
const ESCAPE_GAP_BASELINE = 86;

// 보간 식이 안전한 것으로 인정되는 시작 패턴
const SAFE_START_RE = /^\s*(?:esc|escapeHTML|safeTextWithBreaks|stripTags|raw)\s*\(|^html\s*`/;
// 리터럴 보간 — 숫자·따옴표 문자열·true/false/null/undefined는 이스케이프 불필요
const LITERAL_RE = /^\s*(?:\d|['"`]|true\b|false\b|null\b|undefined\b)/;

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.js')) yield p;
  }
}

/** 문자열 리터럴 종료 위치를 찾는다 (' " ` 공통 — ` 내부 ${} 는 호출부가 별도 처리) */
function skipString(src, i) {
  const q = src[i];
  i++;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === q) return i + 1;
    i++;
  }
  return i;
}

function skipLineComment(src, i) {
  const nl = src.indexOf('\n', i + 2);
  return nl === -1 ? src.length : nl;
}
function skipBlockComment(src, i) {
  const end = src.indexOf('*/', i + 2);
  return end === -1 ? src.length : end + 2;
}

/** { 또는 ( 또는 [ 에 대응하는 닫힘 위치 — 문자열·주석·템플릿을 건너뛴다 */
function matchBrace(src, open, close, i) {
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") { i = skipString(src, i); continue; }
    if (c === '`') { i = skipTemplate(src, i); continue; }
    if (c === '/' && src[i + 1] === '/') { i = skipLineComment(src, i); continue; }
    if (c === '/' && src[i + 1] === '*') { i = skipBlockComment(src, i); continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i + 1; }
    i++;
  }
  return i;
}

/**
 * 템플릿 리터럴을 스캔해 모든 보간식을 수집한다 (중첩 템플릿 안의 것 포함).
 * 반환: { end, interps: [{ expr, offset }] } — offset은 ` 위치 기준 소스 인덱스.
 */
function skipTemplate(src, i, interps) {
  i++; // ` 건너뜀
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') return i + 1;
    if (c === '$' && src[i + 1] === '{') {
      const end = matchBrace(src, '{', '}', i + 1);
      if (interps) {
        const expr = src.slice(i + 2, end - 1);
        interps.push({ expr, offset: i });
        collectNested(src, i + 2, end - 1, interps);
      }
      i = end;
      continue;
    }
    i++;
  }
  return i;
}

/** 보간식 내부의 중첩 템플릿 리터럴에서 보간을 재귀 수집한다 */
function collectNested(src, start, end, interps) {
  let i = start;
  while (i < end) {
    const c = src[i];
    if (c === '"' || c === "'") { i = skipString(src, i); continue; }
    if (c === '/' && src[i + 1] === '/') { i = skipLineComment(src, i); continue; }
    if (c === '/' && src[i + 1] === '*') { i = skipBlockComment(src, i); continue; }
    if (c === '`') { i = skipTemplate(src, i, interps); continue; }
    i++;
  }
}

/**
 * 보간식의 안전 판정.
 * - 안전 호출·html``·리터럴로 시작 → 안전
 * - 식 안에 중첩 템플릿이 있고 .join( 또는 .map( 을 포함 → 구조식 (중첩 보간은 별도 검사됨)
 * - 그 외 식별자·호출 시작 → 미이스케이프 후보
 */
// Html 접미 식별자 — 조립 완료 마크업 변수의 명명 관례 (대소문자 무관)
const MARKUP_VAR_RE = /^[A-Za-z_$][\w.$[\]]*html$/i;
// 숫자 산술 보간 — .length 속성·루프 카운터 연산은 마크업을 만들 수 없다
const NUMERIC_RE = /\.length\s*$|^[A-Za-z_$][\w$]*\s*[+\-]\s*\d+\s*$|^\d+\s*[+\-]\s*[A-Za-z_$][\w$]*\s*$|^[ijkn]$/;
// 로케일 포맷·고정 소수점 — 비마크업 텍스트 생성 호출
const FORMAT_RE = /\.toLocale(?:Date|Time)?String\s*\(|\.toFixed\s*\(|\.toExponential\s*\(/;

function isSafeInterp(expr) {
  const t = expr.trim();
  if (!t) return true;
  if (SAFE_START_RE.test(t)) return true;
  if (LITERAL_RE.test(t)) return true;
  if (MARKUP_VAR_RE.test(t)) return true;
  if (NUMERIC_RE.test(t)) return true;
  if (FORMAT_RE.test(t)) return true;
  // 중첩 템플릿을 가진 구조식 (cond ? `…` : '' · map(x => `…`)) —
  // 중첩 템플릿 안의 보간은 재귀 수집으로 별도 검사되므로 바깥은 통과
  if (t.includes('`')) return true;
  // 괄호로 감싼 안전 호출 — (esc(x)), (cond ? esc(a) : esc(b))의 단순 형태
  if (/^\(/.test(t)) {
    const inner = t.replace(/^\(+/, '').trim();
    if (SAFE_START_RE.test(inner) || LITERAL_RE.test(inner)) return true;
  }
  // 조건식 — 양쪽 가지가 모두 안전/리터럴이면 통과
  // (cond ? esc(a) : esc(b)) · (qc === 'bad' ? ' selected' : '')
  const qm = t.match(/^[^?:]+\?([^:]+):(.*)$/s);
  if (qm) {
    const ok = (b) => SAFE_START_RE.test(b.trim()) || LITERAL_RE.test(b.trim());
    if (ok(qm[1]) && ok(qm[2])) return true;
  }
  return false;
}

// 싱크 패턴 — 대입/연결 대상이 곧바로 백틱(또는 html 태그 백틱)으로 시작하는 경우
const SINK_RE = /(?:\.innerHTML|\.outerHTML)\s*[+]?=\s*(html)?\s*`/g;
const SINK_IAH_RE = /\.insertAdjacentHTML\s*\(\s*['"][^'"]*['"]\s*,\s*(html)?\s*`/g;

const violations = [];
let sinkCount = 0;
let interpCount = 0;

for (const file of walk(SRC_DIR)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const lineOf = (idx) => src.slice(0, idx).split('\n').length;

  for (const re of [SINK_RE, SINK_IAH_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      if (m[1] === 'html') continue; // html`` 태그드 — 자동 이스케이프로 안전
      sinkCount++;
      const tickIdx = m.index + m[0].length - 1;
      const interps = [];
      skipTemplate(src, tickIdx, interps);
      for (const { expr, offset } of interps) {
        interpCount++;
        const line = lineOf(offset);
        if (lines[line - 1] && lines[line - 1].includes('esc-ok')) continue;
        if (!isSafeInterp(expr)) {
          violations.push(`${rel}:${line} — 미이스케이프 보간 후보: \${${expr.trim().slice(0, 60)}}`);
        }
      }
    }
  }
}

console.log('HTML 이스케이프 싱크 검사 (ROAD-Q5)');
console.log(`  스캔: src/**/*.js — 직접 템플릿 싱크 ${sinkCount}개, 보간 ${interpCount}개`);
console.log(`  미이스케이프 보간 후보: ${violations.length}개 (기준선 ${ESCAPE_GAP_BASELINE}개)`);

if (violations.length) {
  for (const v of violations.slice(0, 40)) console.log(`  - ${v}`);
  if (violations.length > 40) console.log(`  …외 ${violations.length - 40}개`);
}
if (violations.length > ESCAPE_GAP_BASELINE) {
  console.log('\n실패 — 기준선 초과. 신규 보간은 esc()/html`` 로 감싸거나, 검토 후 `esc-ok` 주석으로 면제하세요.');
  process.exit(1);
}
console.log('\n통과 — 기준선 이내 (신규 코드는 html`` 태그드 템플릿 권장).');
process.exit(0);
