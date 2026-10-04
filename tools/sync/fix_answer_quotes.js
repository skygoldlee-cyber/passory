#!/usr/bin/env node
/**
 * fix_answer_quotes.js — 부실 인용문 자동 보강
 *
 * check_answer_overlap.js의 [인용문 부실] 항목(인용 원문은 정답을 지지하는데
 * 내장 인용문이 절단·축약되어 지지하지 못하는 경우)을 자동 수정한다.
 *
 * 규칙:
 *   1. 인용 라인부터 순방향으로 원문 라인을 누적해, 누적 텍스트가 정답을 지지하는
 *      첫 지점까지를 새 인용문으로 채택 (최대 6라인)
 *   2. 순방향으로 지지를 찾지 못하면, 원문 블록(표 전체·섹션 ±10줄) 내에서
 *      정답과 최다 n-gram을 공유하는 라인을 선택해 교체 — 수동 검토 목록에 표시
 *   3. 인용 원문 자체가 미지지([정답 미지지])인 항목은 건드리지 않는다
 *
 * 사용법:
 *   node tools/sync/fix_answer_quotes.js          # 수정 실행
 *   node tools/sync/fix_answer_quotes.js --check  # 변경 예정만 보고
 */

// @spec CQ-06
const fs = require('fs');
const path = require('path');
const { getExamTargets } = require('../build/exam_targets');
const { parseQuestionBank, isSupported, sourceContext, compact, NEGATIVE_STEM_RE } = require('../check/check_answer_overlap');

const ROOT = path.resolve(__dirname, '..', '..');
const CHECK = process.argv.includes('--check');
const MAX_EXPANSION = 6;
const CIRCLED_IDX = { '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5 };

// 강한 지지 — 우연한 짧은 n-gram("화장품에", "맞춤형화")은 지지로 인정하지 않는다.
//   ① 숫자를 포함한 4-gram 공유 ("15일이내" ↔ "15일 이내에")
//   ② 6-gram 이상 연속 공유 ("금속이온과" ↔ "금속이온의" → "금속이온" 4자는 약하나 6자면 강함)
//   ③ 5자 이하 짧은 정답의 완전 포함 (단답 "15", "피부" 등)
function strongShare(a, b) {
    const A = compact(a), B = compact(b);
    if (!A || !B) return false;
    if (A.length <= 5) return B.includes(A);
    for (let i = 0; i <= A.length - 4; i++) {
        const g = A.slice(i, i + 4);
        if (/\d/.test(g) && B.includes(g)) return true;
    }
    for (let i = 0; i <= A.length - 6; i++) {
        if (B.includes(A.slice(i, i + 6))) return true;
    }
    return false;
}

// 숫자 정답의 주제 일치 — stem과 text가 비숫자 4-gram을 2개 이상 공유해야 한다.
// 단일 4-gram("화장품법" 등 도메인 상용구)으로는 같은 숫자의 무관한 조항
// (예: "15일 이내" → 과징금 독촉 조항)과 구분되지 않으므로 다중 공유를 요구한다.
function stemTopicMatch(stem, text) {
    if (!stem) return true; // stem 정보가 없으면 게이트 생략
    const A = compact(stem), B = compact(text);
    if (!A || !B) return true;
    let hits = 0;
    const seen = new Set();
    for (let i = 0; i + 4 <= A.length; i++) {
        const g = A.slice(i, i + 4);
        if (/\d/.test(g) || seen.has(g)) continue;
        seen.add(g);
        if (B.includes(g) && ++hits >= 2) return true;
    }
    return false;
}

// 수정 후보 텍스트가 정답을 '강하게' 지지하는가 — isSupported보다 엄격한 게이트
function stronglySupported(q, a, text) {
    const isChoice = /^[①-⑤]$/.test(a.answer);
    if (!isChoice) {
        const cands = [a.answer, ...a.allowed];
        for (const c of [...cands]) {
            const inner = c.match(/^(.*?)\(또는\s*(.+)\)$/);
            if (inner) cands.push(inner[1].trim(), inner[2].trim());
        }
        return cands.some(c => strongShare(c, text));
    }
    if (!q) return false;
    const opt = q.options[CIRCLED_IDX[a.answer] - 1] || '';
    if (/해설/.test(text)) {
        // 해설은 '이 문항과 관련된' 설명이어야 지지 — 선택지 중 하나와라도 겹쳐야 함
        // (교재 내 확인문제 라인 "(정답: ④) **해설**"이 무관한 문항에 오작동하는 것을 차단)
        if (q.options.some(o => strongShare(o, text))) return true;
    }
    if (!NEGATIVE_STEM_RE.test(q.stem)) {
        return strongShare(opt, text); // 긍정형: 정답 강한 지지
    }
    // 부정형: 오답이 2개 이상 강하게 지지되는 경우만 (정답 약한 언급은 무시)
    let wrong = 0;
    q.options.forEach((o, i) => {
        if (i !== CIRCLED_IDX[a.answer] - 1 && strongShare(o, text)) wrong++;
    });
    return wrong >= 2;
}

const sourceCache = new Map();
function sourceLines(bankAbs, a) {
    if (!a.citePath || !a.citeLine) return null;
    const target = path.resolve(path.dirname(bankAbs), a.citePath);
    if (!sourceCache.has(target)) {
        try {
            sourceCache.set(target, fs.readFileSync(target, 'utf-8').replace(/\r\n/g, '\n').split('\n'));
        } catch { sourceCache.set(target, null); }
    }
    return sourceCache.get(target);
}

// 인용 라인부터 순방향 누적 → 첫 '강한' 지지 지점까지의 라인 배열 (없으면 null)
function expandForward(lines, citeIdx, q, a) {
    const picked = [];
    for (let i = citeIdx; i < Math.min(lines.length, citeIdx + MAX_EXPANSION + 4); i++) {
        const s = lines[i].trim();
        if (s === '' || s === '---') {
            if (picked.length === 0) continue; // 인용 라인 이후의 빈 줄/구분선은 건너뜀
            break; // 본문 수집 중 빈 줄이면 문단 종료
        }
        picked.push(lines[i]);
        if (stronglySupported(q, a, picked.join(' '))) return picked;
        if (picked.length >= MAX_EXPANSION) break;
    }
    return null;
}

// 지지 라인을 포함하는 인용 창 — ref_md는 PDF 변환 과정에서 문장이 임의 줄로
// 래핑되므로, 단일 라인만 인용하면 조각("번에 기재할 수 있다.")이 된다.
// 지지 라인이 문단 시작 마커가 아니면 위로 문단 시작까지, 아래로 래핑 연속행까지 확장한다.
function quoteWindow(lines, i, maxLines = 5) {
    const isBoundary = s => /^\s*(#{1,6}\s|\||>|제\d+조|\d+\.|[①-⑮]|\([가-힣]\)|[-•*]\s)/.test(s) || s.trim() === '';
    let lo = i;
    while (lo > 0 && !isBoundary(lines[lo]) && i - lo < maxLines) lo--;
    if (lines[lo].trim() === '') lo++;
    let hi = i;
    while (hi < lines.length - 1 && !isBoundary(lines[hi + 1]) && hi - i < maxLines) hi++;
    return lines.slice(lo, hi + 1);
}

// 원문 블록 내 정답을 '강하게' 지지하는 라인의 인용 창 (수동 검토 대상)
function bestBlockLine(lines, citeIdx, q, a) {
    const lo = Math.max(0, citeIdx - 10), hi = Math.min(lines.length - 1, citeIdx + 10);
    for (let i = citeIdx; i <= hi; i++) {
        if (stronglySupported(q, a, lines[i])) return quoteWindow(lines, i);
    }
    for (let i = lo; i < citeIdx; i++) {
        if (stronglySupported(q, a, lines[i])) return quoteWindow(lines, i);
    }
    return null;
}

function run() {
    const report = { fixed: 0, manual: 0, skipped: 0, items: [] };

    for (const target of getExamTargets(ROOT)) {
        if (!target.manifest) continue;
        for (const exam of target.manifest.exams || []) {
            const rel = `${target.contentRoot}/문제은행/${exam.file}`;
            const abs = path.join(ROOT, rel);
            if (!fs.existsSync(abs)) continue;

            const raw = fs.readFileSync(abs, 'utf-8');
            const eol = raw.includes('\r\n') ? '\r\n' : '\n';
            const lines = raw.replace(/\r\n/g, '\n').split('\n');
            const { questions, answers } = parseQuestionBank(abs);
            const edits = []; // {start, end, newLines}

            for (const [num, a] of answers) {
                if (a.passageStart === undefined) continue;
                const q = questions.get(num);
                if (isSupported(q, a, a.passage).ok) continue;          // 내장 인용문이 이미 지지
                const src = sourceContext(abs, a);
                if (!src || !isSupported(q, a, src).ok) continue;      // 원문도 미지지 → 정답 미지지군 (손대지 않음)

                const sLines = sourceLines(abs, a);
                if (!sLines) { report.skipped++; continue; }
                const citeIdx = a.citeLine - 1;

                let newQuote = expandForward(sLines, citeIdx, q, a);
                let mode = 'expand';
                if (!newQuote) {
                    const best = bestBlockLine(sLines, citeIdx, q, a);
                    if (best) { newQuote = best; mode = 'relocate'; }
                }
                if (!newQuote) { report.skipped++; continue; }
                // 인용 선두가 헤딩·빈 줄이면 제거 — 본문 라인만 인용문으로 사용
                newQuote = newQuote.filter(l => !/^#{1,6}\s/.test(l.trim()));

                edits.push({
                    start: a.passageStart,
                    end: a.passageEnd,
                    newLines: newQuote.map(l => `> ${l.trim()}`),
                });
                report.items.push({ file: exam.file, q: num, mode });
                if (mode === 'expand') report.fixed++; else report.manual++;
            }

            if (edits.length && !CHECK) {
                edits.sort((x, y) => y.start - x.start); // 뒤에서부터 교체
                for (const e of edits) lines.splice(e.start, e.end - e.start + 1, ...e.newLines);
                fs.writeFileSync(abs, lines.join(eol), 'utf-8');
            }
        }
    }

    console.log(`\n[인용문 보강] 순방향 확장 ${report.fixed} · 블록 내 재배치 ${report.manual} · 건너뜀 ${report.skipped}`);
    for (const it of report.items.slice(0, 30)) {
        console.log(`  ${it.file} Q${it.q} — ${it.mode === 'expand' ? '인용 라인 이후로 확장' : '지지 라인으로 교체'}`);
    }
    if (report.items.length > 30) console.log(`  … 외 ${report.items.length - 30}건`);
    if (CHECK) console.log('\n(--check: 파일은 변경하지 않았습니다)');
}

if (require.main === module) run();
module.exports = { expandForward, bestBlockLine, quoteWindow, strongShare, stronglySupported, stemTopicMatch };
