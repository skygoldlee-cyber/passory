// tools/build/build_notice_diff.js — 참조 문서 개정 조문 diff 생성 (FO-24 연장)
// @spec FO-24
//
// 참조자료 교체(예: 화장품법 제20901호 → 제21525호)가 발생하면 ref_md 현행본과
// _archive 구본을 조문 단위로 정규화 비교해 data/exams/<id>/notice_diff.json을 생성한다.
// 앱은 이 파일을 읽어 '고시 정보 보기' 패널과 개정 배너에 신설·개정·삭제 조문을 표시한다.
//
// 정규화 목적: PDF 변환 아티팩트(목차 중복 조문명, 개정이력 태그, 장·절 헤딩 흡수,
// 이미지 태그)를 제거해 실제 개정 조문만 남긴다.
//   - 본문은 첫 '부칙' 헤딩 이전까지만 비교 (부칙은 개정 메타라 diff 대상 아님)
//   - 같은 조문이 목차/본문에 2회 나타나면 본문(더 긴 쪽)을 취함
//   - 조문이 없는 비정형 문서는 전체 본문 비교로 폴백 (unstructured 표시)
const fs = require('fs');
const path = require('path');
const { getExamTargets } = require('./exam_targets');

const ROOT = path.join(__dirname, '..', '..');

/** 본문 구간 — 첫 '부칙' 헤딩 이전 (부칙은 개정 이력 메타) */
function splitMain(text) {
    const m = /^부\s*칙/m.exec(text);
    return m ? text.slice(0, m.index) : text;
}

/** 조문 본문 정규화 — 변환 아티팩트·개정이력 태그 제거 후 공백 정규화 */
function normalizeArticle(body) {
    let t = body;
    t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');                        // 이미지
    t = t.replace(/[<[][^>\]]*(개정|신설|삭제|시행)[^>\]]*[>\]](?:\s*제\d+조(?:의\d+)?)?/g, ' '); // <개정 ...>·[시행일 ...] 및 뒤따르는 시행유예 조문 토큰
    t = t.replace(/\[법률 제?\d+호[^\]]*\]/g, ' ');                      // [법률 제20901호 ...]
    t = t.replace(/^제\d+[장절]\s.*$/gm, ' ');                           // 장·절 헤딩 흡수분
    t = t.replace(/(\([^()\n]{2,40}\))(\s*\1)+/g, '$1');                // '(제목) (제목)' 중복 축약
    t = t.replace(/[\s　]+/g, ' ').trim();
    return t;
}

/**
 * md 텍스트 → { '제N조(의M)': 정규화 본문 }. 조문 헤딩이 하나도 없으면 null 반환.
 * 목차/본문 중복 조문은 본문(가장 긴 후보)을 채택한다.
 */
function splitArticles(text) {
    const parts = splitMain(text).split(/^(제\d+조(?:의\d+)?)/m);
    if (parts.length < 3) return null;
    const arts = {};
    for (let i = 1; i < parts.length; i += 2) {
        (arts[parts[i]] = arts[parts[i]] || []).push(parts[i + 1]);
    }
    const out = {};
    for (const [k, v] of Object.entries(arts)) {
        out[k] = normalizeArticle(v.reduce((a, b) => (b.length > a.length ? b : a), ''));
    }
    return out;
}

/** '제2조의4' → [2,4] 정렬 키 */
function artKey(a) {
    const m = /^제(\d+)조(?:의(\d+))?/.exec(a);
    return m ? [+m[1], +(m[2] || 0)] : [Infinity, 0];
}
const artSort = (a, b) => artKey(a)[0] - artKey(b)[0] || artKey(a)[1] - artKey(b)[1];

const SNIPPET_LEN = 320;   // 조문 본문 요약 최대 길이 (알림창 표시용)
const DIFF_CTX = { pre: 60, post: 240 }; // 개정 조문 첫 차이 지점 전후 표시 구간

function snippet(t, len = SNIPPET_LEN) {
    t = String(t || '').trim();
    return t.length > len ? t.slice(0, len) + '…' : t;
}

/** 두 본문의 첫 차이 지점 인덱스 */
function firstDiffAt(a, b) {
    const n = Math.min(a.length, b.length);
    let i = 0;
    while (i < n && a[i] === b[i]) i++;
    return i;
}

/** 개정 조문의 구/신 차이 발췌 — 첫 차이점 주변 구간만 추출 */
function diffExcerpt(oldBody, newBody) {
    const i = firstDiffAt(oldBody, newBody);
    const pre = i > DIFF_CTX.pre ? '…' : '';
    const s = Math.max(0, i - DIFF_CTX.pre);
    return {
        old: pre + snippet(oldBody.slice(s, i + DIFF_CTX.post)),
        new: pre + snippet(newBody.slice(s, i + DIFF_CTX.post)),
    };
}

/**
 * 구본/신본 md 텍스트 diff → { added, removed, changed, unstructured, details }.
 * details[조문] = {kind, text} 또는 {kind:'changed', old, new} — 알림창에 변경 내용 표시용.
 * 조문 단위 비교가 불가하면 unstructured=true로 전체 본문 비교 폴백.
 */
function diffDocs(oldText, newText) {
    const oldArts = splitArticles(oldText);
    const newArts = splitArticles(newText);
    if (!oldArts || !newArts) {
        const same = normalizeArticle(splitMain(oldText)) === normalizeArticle(splitMain(newText));
        return same
            ? { added: [], removed: [], changed: [], unstructured: true, details: {} }
            : { added: [], removed: [], changed: ['(전체 문서)'], unstructured: true,
                details: { '(전체 문서)': { kind: 'changed', ...diffExcerpt(normalizeArticle(splitMain(oldText)), normalizeArticle(splitMain(newText))) } } };
    }
    const added = [], removed = [], changed = [], details = {};
    for (const k of Object.keys(newArts)) if (!(k in oldArts)) {
        added.push(k);
        details[k] = { kind: 'added', text: snippet(newArts[k]) };
    }
    for (const k of Object.keys(oldArts)) if (!(k in newArts)) {
        removed.push(k);
        details[k] = { kind: 'removed', text: snippet(oldArts[k]) };
    }
    for (const k of Object.keys(newArts)) {
        if (k in oldArts && oldArts[k] !== newArts[k]) {
            changed.push(k);
            details[k] = { kind: 'changed', ...diffExcerpt(oldArts[k], newArts[k]) };
        }
    }
    return { added: added.sort(artSort), removed: removed.sort(artSort), changed: changed.sort(artSort), details, unstructured: false };
}

/** 파일명 → { name, issuer, notice, effectiveDate } — '화장품법(법률)(제21525호)(20261008).md' */
function parseDocName(base) {
    const m = /^(.+?)\(([^()]+)\)\(제([\d-]+)호\)\((\d{8})\)/.exec(base);
    if (!m) return null;
    return { key: `${m[1]}(${m[2]})`, name: m[1], issuer: m[2],
             notice: `제${m[3]}호`,
             effectiveDate: `${m[4].slice(0, 4)}-${m[4].slice(4, 6)}-${m[4].slice(6, 8)}`,
             doc: base };
}

/** dir 하위에서 basename==dirname 인 {doc}/{doc}.md 목록을 재귀 수집 */
function collectDocs(dir) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    (function walk(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith('.md') && e.name.slice(0, -3) === path.basename(d)) {
                out.push({ dir: d, file: p, base: e.name.slice(0, -3) });
            }
        }
    })(dir);
    return out;
}

/**
 * 시험 1개의 개정 diff 생성 — ref_md 현행본 ↔ _archive 구본을 '문서명(발행기관)' 키로 쌍지어
 * 현행본이 더 새 판본(다른 공포번호/시행일)인 쌍만 개정으로 기록한다.
 * @returns {object} notice_diff.json 본문
 */
function buildExamDiff(contentRoot) {
    const refRoot = path.join(ROOT, contentRoot, '참조자료');
    const current = collectDocs(path.join(refRoot, 'ref_md'));
    const archived = collectDocs(path.join(refRoot, '_archive'));
    const archByKey = new Map();
    for (const a of archived) {
        const meta = parseDocName(a.base);
        if (!meta) continue;
        const prev = archByKey.get(meta.key);
        if (!prev || prev.meta.doc < meta.doc) archByKey.set(meta.key, { meta, file: a.file });
    }
    const docs = [];
    for (const c of current) {
        const meta = parseDocName(c.base);
        if (!meta) continue;
        const arch = archByKey.get(meta.key);
        if (!arch || arch.meta.doc === meta.doc) continue;
        const d = diffDocs(fs.readFileSync(arch.file, 'utf-8'), fs.readFileSync(c.file, 'utf-8'));
        if (!d.added.length && !d.removed.length && !d.changed.length) continue;
        docs.push({
            key: meta.key, name: meta.name,
            from: { doc: arch.meta.doc, notice: arch.meta.notice, effectiveDate: arch.meta.effectiveDate },
            to: { doc: meta.doc, notice: meta.notice, effectiveDate: meta.effectiveDate },
            added: d.added, removed: d.removed, changed: d.changed,
            details: d.details,
            unstructured: !!d.unstructured,
        });
    }
    docs.sort((a, b) => a.key.localeCompare(b.key, 'ko'));
    return { docs };
}

function main() {
    let written = 0;
    for (const t of getExamTargets(ROOT)) {
        const refRoot = path.join(ROOT, t.contentRoot, '참조자료');
        if (!fs.existsSync(refRoot)) continue;
        const result = buildExamDiff(t.contentRoot);
        const outPath = path.join(ROOT, t.dataRoot, 'notice_diff.json');
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n', 'utf-8');
        console.log(`  [notice-diff] ${t.id}: 개정 문서 ${result.docs.length}종 → ${path.relative(ROOT, outPath)}`);
        written += result.docs.length;
    }
    if (!written) console.log('  [notice-diff] 감지된 개정 문서 없음 (ref_md↔_archive 쌍 없음)');
}

if (require.main === module) main();
module.exports = { splitArticles, normalizeArticle, splitMain, diffDocs, parseDocName, buildExamDiff, artSort };
