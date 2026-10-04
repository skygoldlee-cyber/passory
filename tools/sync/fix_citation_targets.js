#!/usr/bin/env node
/**
 * fix_citation_targets.js — 정답 미지지 문항의 인용 위치 자동 교정
 *
 * check_answer_overlap.js의 [정답 미지지] 항목(내장 인용문도, 인용 블록도
 * 정답을 지지하지 않는 경우)에 대해, 정답을 실제로 지지하는 위치를
 * ① 인용 파일 전체 → ② 시험 코퍼스 전체(교재→참조자료) 순으로 탐색해
 * 인용 링크(경로·라인번호·라벨)와 내장 인용문을 실제 근거로 교정한다.
 *
 * 규칙:
 *   - stronglySupported(fix_answer_quotes) 게이트를 통과하는 라인만 후보
 *   - 인용문은 quoteWindow로 문단 경계까지 포함 (래핑 조각 방지)
 *   - 같은 파일 → L#### 교정, 다른 파일 → 경로+라벨+L#### 전부 교정
 *   - 코퍼스 전체에도 지지가 없는 항목은 [nowhere] 수동 저작 목록으로 보고
 *
 * 사용법:
 *   node tools/sync/fix_citation_targets.js             # 수정 실행
 *   node tools/sync/fix_citation_targets.js --check     # 변경 예정만 보고
 *   node tools/sync/fix_citation_targets.js --annotate  # 미검증 인용에 ⚠️ 마커 표기·해제 (교정 없음)
 */

// @spec CQ-06
const fs = require('fs');
const path = require('path');
const { getExamTargets } = require('../build/exam_targets');
const { parseQuestionBank, isSupported, sourceContext } = require('../check/check_answer_overlap');
const { stronglySupported, quoteWindow, stemTopicMatch } = require('./fix_answer_quotes');
const { compact } = require('../check/check_answer_overlap');

const ROOT = path.resolve(__dirname, '..', '..');
const CHECK = process.argv.includes('--check');
const ANNOTATE = process.argv.includes('--annotate');

// 인용 위치 미검증 마커 — 지지 근거를 자동으로 확인할 수 없거나 인용 대상이
// 확인문제 블록인 문항의 근거 블록 끝에 삽입하고, 지지가 회복되면 제거한다 (멱등)
const FLAG_RE = /^>\s*⚠️/;
const FLAG_LINE = '> ⚠️ *인용 위치 자동검증 불가 — 근거가 부정확할 수 있습니다*';

const CITE_LINK_RE = /\]\(<([^>]+\.md)#L(\d+)>\)/;

// 파일 → 인용 라벨 (교재=교재, 참조자료=문서명 정제)
function labelOf(absPath, contentRootAbs) {
    const rel = path.relative(contentRootAbs, absPath).replace(/\\/g, '/');
    if (rel.startsWith('교재/')) return '교재';
    const stem = path.basename(absPath, '.md');
    // "화장품법 시행규칙(총리령)(제02109호)(20260402)" → "화장품법 시행규칙"
    return stem.replace(/(\(제[\w가-힣]*호\)|\(\d{8}\)|\([^)]*\))+\s*$/, '').replace(/\([^)]*\)\s*$/, '').trim() || stem;
}

// 시험 코퍼스 — 교재 먼저, 참조자료 다음 순으로 탐색 대상 구성.
// 이야기형·서사 패치는 표준형에서 생성되는 파생물이라 인용 대상에서 제외한다 (SSOT=표준형).
function corpusOf(contentRootAbs) {
    const files = [];
    const walk = d => {
        if (!fs.existsSync(d)) return;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) { if (e.name !== 'story') walk(p); }
            else if (e.name.endsWith('.md') && !/_이야기형\.md$|_서사\.md$/.test(e.name)) files.push(p);
        }
    };
    walk(path.join(contentRootAbs, '교재'));
    walk(path.join(contentRootAbs, '참조자료'));
    return files;
}

const fileCache = new Map();
function linesOf(f) {
    if (!fileCache.has(f)) {
        try { fileCache.set(f, fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').split('\n')); }
        catch { fileCache.set(f, null); }
    }
    return fileCache.get(f);
}

// 정답 텍스트가 숫자를 포함하는가 — 숫자 정답("15일 이내")은 같은 숫자의
// 무관한 조항에 오인될 수 있어 코퍼스 탐색 시 stem 주제 일치를 추가로 요구한다
function isDigitAnswer(q, a) {
    const m = a.answer.match(/^[①-⑤]$/);
    const opt = m && q ? (q.options['①②③④⑤'.indexOf(a.answer)] || '') : a.answer;
    return /\d/.test(compact(opt));
}

// 교재·참조자료 내 확인문제·자가퀴즈는 콘텐츠 근거가 아니다 — "정답:"/"**정답**:"/
// "(정답)"/"확인문제"/"**해설**:" 라인이 속한 blockquote 블록(선택지·해설 포함)
// 또는 문단 전체를 후보 라인에서 제외한다
const REVIEW_MARKER_RE = /확인문제|해설\*{0,2}\s*[:：]|정답\*{0,2}\s*[:：]|\(정답\)/;
function reviewQuestionLines(lines) {
    const skip = new Set();
    for (let i = 0; i < lines.length; i++) {
        if (!REVIEW_MARKER_RE.test(lines[i])) continue;
        let s = i, e = i;
        if (/^\s*>/.test(lines[i])) {
            while (s > 0 && /^\s*>/.test(lines[s - 1])) s--;
            while (e + 1 < lines.length && /^\s*>/.test(lines[e + 1])) e++;
        } else if (!/^#{1,6}\s/.test(lines[i])) {
            // 비인용 문단 — 헤딩 라인은 섹션 전체가 삼켜지지 않도록 확장하지 않음
            while (s > 0 && lines[s - 1].trim() !== '' && !/^#{1,6}\s/.test(lines[s - 1])) s--;
            while (e + 1 < lines.length && lines[e + 1].trim() !== '' && !/^#{1,6}\s/.test(lines[e + 1])) e++;
        }
        for (let j = s; j <= e; j++) skip.add(j);
    }
    return skip;
}

const reviewCache = new Map();
function reviewSkipOf(file) {
    if (!reviewCache.has(file)) reviewCache.set(file, reviewQuestionLines(linesOf(file) || []));
    return reviewCache.get(file);
}

// 파일 내 정답을 강하게 지지하는 첫 라인의 인용 창 (같은 과목 챕터를 우선하진 않음 — 첫 일치)
function findSupport(file, q, a) {
    const lines = linesOf(file);
    if (!lines) return null;
    const skip = reviewSkipOf(file);
    const digit = isDigitAnswer(q, a);
    for (let i = 0; i < lines.length; i++) {
        if (skip.has(i)) continue;
        if (!stronglySupported(q, a, lines[i])) continue;
        if (digit && !stemTopicMatch(q && q.stem, lines[i])) continue;
        return { line: i + 1, quote: quoteWindow(lines, i) };
    }
    return null;
}

function run() {
    const report = { sameFile: 0, crossFile: 0, nowhere: [], items: [], flagged: [], unflagged: 0 };

    for (const target of getExamTargets(ROOT)) {
        if (!target.manifest) continue;
        const contentRootAbs = path.join(ROOT, target.contentRoot);
        const corpus = corpusOf(contentRootAbs);
        for (const exam of target.manifest.exams || []) {
            const abs = path.join(contentRootAbs, '문제은행', exam.file);
            if (!fs.existsSync(abs)) continue;
            const bankDir = path.dirname(abs);

            const raw = fs.readFileSync(abs, 'utf-8');
            const eol = raw.includes('\r\n') ? '\r\n' : '\n';
            const lines = raw.replace(/\r\n/g, '\n').split('\n');
            const { questions, answers } = parseQuestionBank(abs);
            const edits = [];

            for (const [num, a] of answers) {
                if (a.passageStart === undefined || a.entryStart === undefined) continue;
                const q = questions.get(num);
                const citedFile = a.citePath ? path.resolve(bankDir, a.citePath) : null;
                const citedLines = citedFile ? linesOf(citedFile) : null;
                // 인용 위치가 교재 내 확인문제(정답·해설) 블록이면 근거로 부적절 → 재탐색 대상
                const inReview = !!(a.citeLine && citedLines && reviewSkipOf(citedFile).has(a.citeLine - 1));

                if (ANNOTATE) {
                    const src = sourceContext(abs, a);
                    const supported = isSupported(q, a, a.passage).ok || (src && isSupported(q, a, src).ok);
                    const flagged = !supported || inReview;
                    const markers = [];
                    const scanEnd = Math.min((a.passageEnd || a.entryStart) + 3, lines.length - 1);
                    for (let li = a.entryStart; li <= scanEnd; li++) {
                        if (FLAG_RE.test(lines[li])) markers.push(li);
                    }
                    if (flagged) {
                        report.flagged.push(`${exam.file} Q${num} [${a.answer}]`);
                        if (!markers.length) {
                            edits.push({ op: 'ins', at: a.passageEnd + 1, line: FLAG_LINE, entryStart: a.entryStart });
                        } else {
                            // 중복 마커는 첫 번째만 남기고 제거
                            for (const m of markers.slice(1)) edits.push({ op: 'del', at: m, entryStart: a.entryStart });
                        }
                    } else if (markers.length) {
                        for (const m of markers) edits.push({ op: 'del', at: m, entryStart: a.entryStart });
                        report.unflagged++;
                    }
                    continue;
                }

                if (!inReview) {
                    if (isSupported(q, a, a.passage).ok) continue;          // 내장 인용문이 지지
                    const src = sourceContext(abs, a);
                    if (src && isSupported(q, a, src).ok) continue;       // 부실군 — fix:quotes 담당
                }

                // ① 인용 파일 전체 — 이야기형 인용은 표준형 대응본을 우선 탐색 (SSOT)
                let found = null, file = null;
                const candidates = [];
                if (citedFile) {
                    if (/_이야기형\.md$/.test(citedFile)) {
                        const std = citedFile.replace(/_이야기형\.md$/, '_표준형.md');
                        if (fs.existsSync(std)) candidates.push(std);
                    }
                    candidates.push(citedFile);
                }
                for (const cf of candidates) {
                    const f = findSupport(cf, q, a);
                    if (f) { found = f; file = cf; break; }
                }
                // ② 코퍼스 전체 (인용 파일 제외)
                if (!found) {
                    for (const c of corpus) {
                        if (candidates.includes(c)) continue;
                        const f = findSupport(c, q, a);
                        if (f) { found = f; file = c; break; }
                    }
                }
                if (!found) { report.nowhere.push(`${exam.file} Q${num} [${a.answer}]`); continue; }
                const mode = file === citedFile ? 'same' : 'cross';

                const relPath = path.relative(bankDir, file).replace(/\\/g, '/');
                const newLink = `<${relPath}#L${found.line}>`;
                const newLabel = labelOf(file, contentRootAbs);

                edits.push({ num, mode, start: a.passageStart, end: a.passageEnd,
                    newLines: found.quote.map(l => `> ${l.trim()}`),
                    entryStart: a.entryStart, linkStart: a.entryStart, linkEnd: a.passageStart - 1,
                    newLink, newLabel, newLine: found.line, citePath: a.citePath });

                report.items.push({ file: exam.file, q: num, mode, to: `${path.basename(file)}#L${found.line}` });
                if (mode === 'same') report.sameFile++; else report.crossFile++;
            }

            if (edits.length && !CHECK) {
                edits.sort((x, y) => (y.at ?? y.entryStart) - (x.at ?? x.entryStart)); // 뒤에서부터
                for (const e of edits) {
                    if (e.op === 'ins') { lines.splice(e.at, 0, e.line); continue; }
                    if (e.op === 'del') { lines.splice(e.at, 1); continue; }
                    // 인용문 교체
                    lines.splice(e.start, e.end - e.start + 1, ...e.newLines);
                    // 링크·라벨 교체 — 항목 범위(entryStart~start) 내의 #L 링크만
                    for (let li = e.entryStart; li < e.start; li++) {
                        if (CITE_LINK_RE.test(lines[li])) {
                            lines[li] = lines[li]
                                .replace(CITE_LINK_RE, `](${e.newLink})`)
                                .replace(/(\[[^\]]*?:\s*)L\d+/, `$1L${e.newLine}`) // [교재: L123] 계열
                                .replace(/\[L\d+\]/, `[L${e.newLine}]`);           // [L123] 계열
                            // cross-file 시 라벨 접두도 교정
                            if (e.mode === 'cross') {
                                lines[li] = lines[li].replace(/(\[)[^\]]*?:(\s*L\d+)/, `$1${e.newLabel}:$2`);
                            }
                        }
                    }
                }
                fs.writeFileSync(abs, lines.join(eol), 'utf-8');
            }
        }
    }

    if (ANNOTATE) {
        console.log(`\n[인용 위치 미검증 표기] 표기 대상 ${report.flagged.length}건 · 마커 해제 ${report.unflagged}건`);
        for (const s of report.flagged.slice(0, 30)) console.log(`  ⚠️ ${s}`);
        if (report.flagged.length > 30) console.log(`  … 외 ${report.flagged.length - 30}건`);
        if (CHECK) console.log('\n(--check: 파일은 변경하지 않았습니다)');
        return;
    }
    console.log(`\n[인용 위치 교정] 같은 파일 ${report.sameFile} · 다른 파일 ${report.crossFile} · 지지 없음 ${report.nowhere.length}`);
    for (const it of report.items.slice(0, 25)) {
        console.log(`  ${it.file} Q${it.q} — ${it.mode === 'same' ? '라인 교정' : '파일 재지정'} → ${it.to}`);
    }
    if (report.items.length > 25) console.log(`  … 외 ${report.items.length - 25}건`);
    if (report.nowhere.length) {
        console.log('\n[지지 없음 — 수동 저작 필요]');
        for (const s of report.nowhere) console.log(`  ${s}`);
    }
    if (CHECK) console.log('\n(--check: 파일은 변경하지 않았습니다)');
}

if (require.main === module) run();
module.exports = { findSupport, labelOf, isDigitAnswer };
