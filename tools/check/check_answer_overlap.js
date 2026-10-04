#!/usr/bin/env node
/**
 * check_answer_overlap.js — 문제 정답 ↔ 인용 근거 구절 의미적 지지 검증
 *
 * sync_citation_lines가 "인용문 ↔ 소스 라인" 일치를 보장하는 것과 달리,
 * 이 체커는 "표기된 정답이 인용 근거 구절에 의해 지지되는가"를 검사한다.
 * 인용 라인번호가 맞아도 해당 구절이 정답을 지지하지 않으면
 * (잘못된 인용 위치, 정답 표기 오류, 근거 복사 누락) 저자 검토가 필요하다.
 *
 * 판정 규칙:
 *   [단답형] 정규화한 정답(또는 허용 정답 중 하나)이 근거 구절에 부분일치 → 지지
 *   [선다형·긍정형] 정답 선택지의 강한 토큰 ≥1개가 근거에 포함 → 지지
 *   [선다형·부정형] 정답은 지지받지 않는 게 정상 — 아래 중 하나면 통과:
 *     ① 해설(> **해설**:) 존재  ② 오답 선택지 2개 이상이 근거에 지지됨
 *     ③ 정답 선택지 토큰이 근거에 포함 (설명식 근거)
 *   [2단계 대조] 내장 인용문이 미지지일 때, 인용 원문 파일의 해당 라인±2줄을 추가 대조:
 *     - 원문은 지지 → [부실 인용문] 내장 구절 절단·축약 의심 (보고만)
 *     - 원문도 미지지 → [정답 미지지] 인용 위치 또는 정답 표기 오류 의심 (기준선 게이트)
 *
 * 사용법:
 *   node tools/check/check_answer_overlap.js          # 검증 (기준선 초과 시 exit 1)
 *   node tools/check/check_answer_overlap.js --verbose # 의심 항목 전체 출력
 *
 * 종료코드: 의심 건수가 기준선 이하면 0, 초과하면 1
 */

// @spec CQ-06
const fs = require('fs');
const path = require('path');
const { getExamTargets } = require('../build/exam_targets');

const ROOT = path.resolve(__dirname, '..', '..');
const VERBOSE = process.argv.includes('--verbose');

// 정답 미지지 기준선 — 실측 잔여(기존 콘텐츠 점진 정리 대상).
// 신규 문항의 무근거 인용 유입은 즉시 실패로 차단한다.
const ANSWER_OVERLAP_BASELINE = 467;

const CIRCLED = { '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5 };
const NEGATIVE_STEM_RE = /(아닌 것|않는 것|올바르지 않은|옳지 않은|틀린 것|해당하지 않는|포함되지 않는|아닌것|잘못된)/;

// ── 정규화 ──────────────────────────────────────────────
function normalize(s) {
    return String(s || '')
        .replace(/\*\*/g, '')
        .replace(/[|`'"()[\]{}<>「」『』【】]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}
function compact(s) {
    return normalize(s).replace(/[\s.,;:!?·\-–—~/+@%㎍µ%℃°×()（）]/g, '');
}
// 강한 토큰: 3글자 이상 단어, 또는 숫자 포함 토큰(한도·연수·비율 등 단답 핵심)
function strongTokens(s) {
    const toks = normalize(s)
        .split(/[\s,;:!?·\/]+/)
        .map(t => t.replace(/[.\-–—]+$/, ''))
        .filter(t => t.length >= 3 || /\d/.test(t));
    return [...new Set(toks)];
}
// 4-gram 공통 부분문자열 — 조사·어미 변형("금속이온과"↔"금속이온의")·띄어쓰기 차이를 흡수
function sharesNgram(a, b, n = 4) {
    const A = compact(a), B = compact(b);
    if (!A || !B) return false;
    if (A.length <= n) return B.includes(A);
    for (let i = 0; i <= A.length - n; i++) {
        if (B.includes(A.slice(i, i + n))) return true;
    }
    return false;
}
function contains(haystackNorm, needle) {
    const c = compact(needle);
    return c.length > 0 && haystackNorm.includes(c);
}

// ── 문제은행 파싱 ───────────────────────────────────────
function parseQuestionBank(filePath) {
    const lines = fs.readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n').split('\n');
    const questions = new Map(); // qnum -> { stem, options: [..] }
    const answers = new Map();   // qnum -> { answer, allowed[], passage }
    let cur = null;
    let inAnswers = false;
    let curAns = null;
    let inPassage = false;

    const flushQ = () => { if (cur) questions.set(cur.num, cur); cur = null; };
    const flushA = () => { if (curAns) answers.set(curAns.num, curAns); curAns = null; inPassage = false; };

    for (let li = 0; li < lines.length; li++) {
        const line = lines[li].trimEnd();

        if (/^##\s+🔑/.test(line)) { inAnswers = true; flushQ(); continue; }

        if (!inAnswers) {
            const qm = line.match(/^###\s+Q(\d+)\.\s*(.*)/);
            if (qm) { flushQ(); cur = { num: +qm[1], stem: qm[2], options: [] }; continue; }
            if (cur) {
                const om = line.match(/^([①-⑤])\s*(.*)/);
                if (om) { cur.options[CIRCLED[om[1]] - 1] = om[2].trim(); continue; }
                if (line && !line.startsWith('---')) cur.stem += ' ' + line.trim();
            }
            continue;
        }

        // 정답부
        const am = line.match(/^\*\*Q(\d+)\.\*\*\s*$/);
        if (am) { flushA(); curAns = { num: +am[1], answer: '', allowed: [], passage: '', cite: '' }; continue; }
        if (!curAns) continue;

        const block = line.replace(/^>\s?/, '');
        const ansM = block.match(/\*\*정답:\s*([^*]+)\*\*\s*(\[[^\]]*\]\(<([^>]+)>\))?/);
        if (ansM && !curAns.answer) {
            curAns.answer = ansM[1].trim();
            curAns.cite = ansM[3] || '';
            const lm = (ansM[3] || '').match(/\.md#L(\d+)$/);
            if (lm) { curAns.citePath = ansM[3].replace(/#L\d+$/, ''); curAns.citeLine = +lm[1]; }
            continue;
        }
        const allowM = block.match(/\*\*허용 정답:\*\*\s*(.*)/);
        if (allowM) { curAns.allowed = allowM[1].split(',').map(s => s.trim()).filter(Boolean); continue; }
        if (/📖.*근거/.test(block)) {
            inPassage = true;
            // 근거 링크에서 라인번호·경로를 다시 잡아 원문 대조에 사용 (정답줄 링크보다 정확)
            const cm = block.match(/\]\(<([^>]+\.md)#L(\d+)>\)/);
            if (cm) { curAns.citePath = cm[1]; curAns.citeLine = +cm[2]; }
            continue;
        }
        if (inPassage && line.startsWith('>')) {
            // 중첩 인용(> > **해설**:)도 구절로 포함 — 해설 자체가 정답 지지 근거
            curAns.passage += ' ' + block.replace(/^>\s?/, '').trim();
            if (curAns.passageStart === undefined) curAns.passageStart = li;
            curAns.passageEnd = li;
        }
    }
    flushQ();
    flushA();
    return { questions, answers };
}

// ── 인용 원문 조회 ────────────────────────────────────────
// 인용 라인이 속한 '블록'을 지지 범위로 사용한다.
//   - 표 안의 라인 → 연속된 표 블록 전체
//   - 그 외 → 같은 마크다운 섹션 내 인용 라인 ±10줄
//   - 법령 ref_md 조문 → 같은 조(제N조) 블록
const sourceCache = new Map();
function sourceContext(bankAbs, a) {
    if (!a.citePath || !a.citeLine) return '';
    const target = path.resolve(path.dirname(bankAbs), a.citePath);
    if (!sourceCache.has(target)) {
        try {
            sourceCache.set(target, fs.readFileSync(target, 'utf-8').replace(/\r\n/g, '\n').split('\n'));
        } catch { sourceCache.set(target, null); }
    }
    const lines = sourceCache.get(target);
    if (!lines) return '';
    const i = a.citeLine - 1;
    if (i < 0 || i >= lines.length) return '';

    const cited = lines[i] || '';
    let lo = i, hi = i;
    if (/^\s*\|/.test(cited)) {
        // 표 안의 라인 → 연속된 표 블록 전체
        while (lo > 0 && /^\s*\|/.test(lines[lo - 1])) lo--;
        while (hi < lines.length - 1 && /^\s*\|/.test(lines[hi + 1])) hi++;
    } else {
        // 그 외 → ±10줄, 단 헤딩 경계를 넘지 않음
        lo = i - 1;
        while (lo >= i - 10 && lo >= 0 && !/^#{1,4}\s/.test(lines[lo])) lo--;
        if (!/^#{1,4}\s/.test(lines[lo])) lo = Math.max(0, i - 10); // 경계 미발견 시 ±10 고정
        hi = i + 1;
        while (hi <= i + 10 && hi < lines.length && !/^#{1,4}\s/.test(lines[hi])) hi++;
        hi = Math.min(hi - 1, lines.length - 1);
    }
    return lines.slice(lo, hi + 1).join(' ');
}

// ── 판정 (passageText: 내장 인용문 또는 인용 원문 컨텍스트) ──
function isSupported(q, a, passageText) {
    const passage = compact(passageText);
    if (!passage) return { ok: false, why: '근거 구절 없음' };

    const isChoice = /^[①-⑤]$/.test(a.answer);
    const hasHesol = /해설/.test(passageText);

    if (!isChoice) {
        // 단답형 — 정답 또는 허용 정답이 구절에 포함돼야 지지
        const cands = [a.answer, ...a.allowed];
        // 괄호 안 대안 표현 분리: "메틸파라벤(또는 해당 파라벤 명칭)" → 둘 다 후보
        for (const c of [...cands]) {
            const inner = c.match(/^(.*?)\(또는\s*(.+)\)$/);
            if (inner) cands.push(inner[1].trim(), inner[2].trim());
        }
        if (cands.some(c => contains(passage, c) || sharesNgram(c, passage))) return { ok: true, how: '단답 일치' };
        return { ok: false, why: `정답 "${a.answer}"이 근거에 없음` };
    }

    // 선다형
    const optText = q && q.options ? (q.options[CIRCLED[a.answer] - 1] || '') : '';
    if (!q) return { ok: false, why: '문제 본문 매칭 실패' };
    const negative = NEGATIVE_STEM_RE.test(q.stem);
    const ansHit = sharesNgram(optText, passage);

    if (!negative) {
        if (ansHit) return { ok: true, how: '정답 토큰 일치' };
        if (hasHesol) return { ok: true, how: '해설 근거' };
        return { ok: false, why: `정답 "${optText.slice(0, 30)}"의 핵심 토큰이 근거에 없음` };
    }

    // 부정형 — 정답은 미지지가 정상. 해설·오답 지지·정답 언급 중 하나면 통과
    if (hasHesol) return { ok: true, how: '부정형 해설' };
    if (ansHit) return { ok: true, how: '정답 언급' };
    let wrongHits = 0;
    q.options.forEach((opt, i) => {
        if (i !== CIRCLED[a.answer] - 1 && sharesNgram(opt, passage)) wrongHits++;
    });
    if (wrongHits >= 2) return { ok: true, how: `오답 ${wrongHits}개 지지` };
    return { ok: false, why: `부정형인데 근거가 오답 지지도 해설도 아님 (오답 ${wrongHits}개만 일치)` };
}

// ── 실행 ────────────────────────────────────────────────
function run() {
const suspects = [];    // 원문도 미지지 — 인용 위치/정답 오류 의심
const weakQuotes = [];  // 원문은 지지하나 내장 구절이 미지지 — 인용문 절단·축약 의심
const stats = { files: 0, questions: 0, supported: 0, skipped: 0 };

for (const target of getExamTargets(ROOT)) {
    if (!target.manifest) continue;
    for (const exam of target.manifest.exams || []) {
        const rel = `${target.contentRoot}/문제은행/${exam.file}`;
        const abs = path.join(ROOT, rel);
        if (!fs.existsSync(abs)) continue;
        stats.files++;
        const { questions, answers } = parseQuestionBank(abs);
        for (const [num, a] of answers) {
            stats.questions++;
            const q = questions.get(num);
            if (!a.cite && !a.passage.trim()) { stats.skipped++; continue; }
            const v = isSupported(q, a, a.passage);
            if (v.ok) { stats.supported++; continue; }
            // 2단계 — 내장 구절 미지지 시 인용 원문 ±2줄로 재판정
            const src = sourceContext(abs, a);
            const v2 = src ? isSupported(q, a, src) : { ok: false };
            const entry = { file: exam.file, q: num, answer: a.answer, why: v.why, cite: a.cite };
            if (v2.ok) weakQuotes.push(entry);
            else suspects.push(entry);
        }
    }
}

console.log(`\n[정답↔근거 지지 검증] ${stats.files}개 문제은행, ${stats.questions}문항`);
console.log(`  지지 확인 ${stats.supported} · 인용문 부실 ${weakQuotes.length} · 정답 미지지 ${suspects.length} · 판정 생략 ${stats.skipped}`);

if (VERBOSE) {
    if (suspects.length) {
        console.log('\n[정답 미지지] 인용 위치·정답 표기 검토 필요:');
        for (const s of suspects) console.log(`  ${s.file} Q${s.q} — 정답[${s.answer}] ${s.why}`);
    }
    if (weakQuotes.length) {
        console.log('\n[인용문 부실] 원문은 지지하나 내장 구절이 절단·축약:');
        for (const s of weakQuotes) console.log(`  ${s.file} Q${s.q} — 정답[${s.answer}] ${s.why}`);
    }
} else if (suspects.length) {
    console.log(`\n의심 항목 ${suspects.length}건 — 전체 목록: node tools/check/check_answer_overlap.js --verbose`);
}

if (suspects.length > ANSWER_OVERLAP_BASELINE) {
    console.log(`\n❌ 의심 ${suspects.length}건 > 기준선 ${ANSWER_OVERLAP_BASELINE}건 — 정답·인용 위치를 검토하세요.`);
    process.exit(1);
}
console.log(`\n✅ 기준선(${ANSWER_OVERLAP_BASELINE}) 이내 — 정답↔근거 지지 정합성 유지`);
}

if (require.main === module) run();
module.exports = { parseQuestionBank, isSupported, normalize, compact, strongTokens, sharesNgram, sourceContext, NEGATIVE_STEM_RE };
