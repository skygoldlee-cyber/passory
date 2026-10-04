#!/usr/bin/env node
/**
 * check_numbering.js — 교재 번호체계 정합성 게이트
 *
 * 기준: docs/dev/reference/NUMBERING_SYSTEM.md §2(헤딩 레벨)·§3.1(연속)·§3.3(금지 패턴)·§5.2(검증 항목)·§5.3(표준↔이야기 동기화)
 *
 * 검사 범위: content/exams/<id>/교재/ 아래의 *_표준형.md·*_이야기형.md
 *   서사 패치(*_서사.md)는 패치 DSL 문서로 렌더링 대상이 아니므로 제외 — 패치가 만든 산출물은
 *   이야기형 파일 검사에서 잡힌다. 시리즈 설정 문서 등 비교재 파일도 제외.
 *
 * 실패(exit 1): 구 체계 잔재·잘린 헤더·번호 형식·연속성·계층·헤더-본문 중복·본문 잔재
 * 경고(exit 0): 표준형↔이야기형 번호 시퀀스 불일치 — 이야기형 고유 부록(예: 2과목 🗂️ 원료 목록)을 허용하기 위함
 *
 * 사용법:
 *   npm.cmd run check:numbering
 */

// @spec none (검증 스크립트)
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const EXAMS = path.join(ROOT, 'content', 'exams');

const ROOTS = fs.readdirSync(EXAMS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(EXAMS, e.name, '교재'))
    .filter((p) => fs.existsSync(p));

function collect(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) collect(p, out);
        else if (/_(표준형|이야기형)\.md$/.test(e.name)) out.push(p);
    }
    return out;
}

const files = ROOTS.flatMap((r) => collect(r)).sort();
const findings = [];
const headingSeqByFile = {};

function add(file, line, kind, msg) {
    findings.push({ file: path.relative(ROOT, file), line, kind, msg });
}

// 헤딩-본문 중복 비교용 정규화
const norm = (s) => (s || '')
    .replace(/^#+\s*/, '')
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/[*_`>①-⑳•·\s]/g, '')
    .trim();

for (const file of files) {
    const rel = path.relative(ROOT, file);
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    let inCode = false;

    // 번호 컨텍스트
    let h2seq = 0;           // 현재 챕터 블록 내 ## N. 기대값
    let h3seq = 0;           // 현재 ## 블록 내 ### N. 기대값
    let h3num = 0;           // 현재 ### 번호 (#### N.M의 N 검증용)
    let h4m = 0;             // 현재 ### 블록 내 #### N.M의 M 기대값
    let h4prefix = '';       // 현재 #### N.M (##### N.M.K 검증용)
    let h5k = 0;             // 현재 #### 블록 내 ##### K 기대값
    let seenH3InH2 = false;  // 현재 ## 블록에서 ### 출현 여부
    let prevHeading = null;  // {line, title} 직전 헤딩 — 본문 중복 검사
    const numbered = [];     // 표준형↔이야기형 비교용 번호 헤딩 목록

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const t = raw.trim();

        if (t.startsWith('```') || t.startsWith('~~~')) { inCode = !inCode; continue; }
        if (inCode) continue;
        if (!t) continue;

        const hm = t.match(/^(#{1,6})\s+(.*)$/);
        if (hm) {
            const level = hm[1].length;
            const title = hm[2].trim();

            // --- 금지 패턴 (구 체계 잔재) ---
            if (/^\(\d+\)/.test(title)) add(file, i + 1, '잔재', `헤딩 번호 (N) 구식: ${title.slice(0, 40)}`);
            if (/^[①-⑳]/.test(title)) add(file, i + 1, '잔재', `헤딩 번호 원형숫자: ${title.slice(0, 40)}`);
            if (/^[가-하]\.\s/.test(title)) add(file, i + 1, '잔재', `헤딩 번호 가.: ${title.slice(0, 40)}`);
            if (/^[A-Za-z]\.\s/.test(title)) add(file, i + 1, '잔재', `헤딩 번호 알파벳: ${title.slice(0, 40)}`);
            if (/^\d+\)\s/.test(title)) add(file, i + 1, '잔재', `헤딩 번호 N): ${title.slice(0, 40)}`);
            if (level === 4 && /^0\./.test(title)) add(file, i + 1, '잔재', `#### 0.N: ${title.slice(0, 40)}`);
            if (/\.{3,}$|…$/.test(title)) add(file, i + 1, '잘림', `잘린 헤더 .../…: ${title.slice(0, 50)}`);

            // --- 레벨별 번호 형식 검증 (번호가 있을 때만) ---
            const numMatch = title.match(/^(\d+(?:\.\d+)*)\.?\s/);
            if (numMatch) {
                const dots = (numMatch[1].match(/\./g) || []).length;
                const expected = { 2: 0, 3: 0, 4: 1, 5: 2 }[level];
                if (expected !== undefined && dots !== expected) {
                    add(file, i + 1, '형식', `h${level}인데 번호 ${numMatch[1]} (기대 depth ${expected}): ${title.slice(0, 40)}`);
                }
            }

            // --- 연속성 검증 ---
            if (level === 2) {
                if (/^📚\s*Chapter\s+\d+|^Chapter\s+\d+/i.test(title)) {
                    h2seq = 0; seenH3InH2 = false; h3seq = 0; h3num = 0; h4m = 0; h4prefix = ''; h5k = 0;
                } else if (/^\d+\./.test(title)) {
                    h2seq++;
                    const n = parseInt(title);
                    if (n !== h2seq) { add(file, i + 1, '연속', `## ${n}. — 기대 ${h2seq} (챕터 블록 내 비연속)`); h2seq = n; }
                    numbered.push(`##${n}`);
                    h3seq = 0; h3num = 0; h4m = 0; h4prefix = ''; h5k = 0; seenH3InH2 = false;
                } else {
                    // 비번호 ## — ### 시퀀스만 리셋 (보조 ## 아래 ###는 보조 헤더여야 함)
                    h3seq = 0; h3num = 0; h4m = 0; h4prefix = ''; h5k = 0; seenH3InH2 = false;
                }
            } else if (level === 3) {
                seenH3InH2 = true;
                if (/^\d+\./.test(title)) {
                    h3seq++;
                    const n = parseInt(title);
                    if (n !== h3seq) { add(file, i + 1, '연속', `### ${n}. — 기대 ${h3seq} (## 블록 내 비연속)`); h3seq = n; }
                    h3num = n; h4m = 0; h4prefix = ''; h5k = 0;
                    numbered.push(`###${n}`);
                }
            } else if (level === 4) {
                const m = title.match(/^(\d+)\.(\d+)/);
                if (m) {
                    if (!seenH3InH2) add(file, i + 1, '계층', `#### ${m[0]} — ### 없이 #### (level skip)`);
                    else if (parseInt(m[1]) !== h3num) add(file, i + 1, '연속', `#### ${m[0]} — 부모 ### 번호 ${h3num}와 불일치`);
                    h4m++;
                    if (parseInt(m[2]) !== h4m) { add(file, i + 1, '연속', `#### ${m[0]} — M 기대 ${h3num}.${h4m}`); h4m = parseInt(m[2]); }
                    h4prefix = `${m[1]}.${m[2]}`; h5k = 0;
                    numbered.push(`####${m[0]}`);
                }
            } else if (level === 5) {
                const m = title.match(/^(\d+\.\d+)\.(\d+)/);
                if (m) {
                    if (!h4prefix) add(file, i + 1, '계층', `##### ${m[0]} — #### 없이 ##### (level skip)`);
                    else if (m[1] !== h4prefix) add(file, i + 1, '연속', `##### ${m[0]} — 부모 #### ${h4prefix}와 불일치`);
                    h5k++;
                    if (parseInt(m[2]) !== h5k) { add(file, i + 1, '연속', `##### ${m[0]} — K 기대 ${h4prefix}.${h5k}`); h5k = parseInt(m[2]); }
                    numbered.push(`#####${m[0]}`);
                }
            }

            // 헤더-본문 중복 검사용
            prevHeading = { line: i + 1, title };
            continue;
        }

        // --- 헤더 직후 본문 중복 ---
        if (prevHeading && !t.startsWith('|') && !t.startsWith('>') && !t.startsWith('<!--')) {
            if (norm(t) && norm(t) === norm(prevHeading.title)) {
                add(file, prevHeading.line, '중복', `헤더-본문 중복: "${prevHeading.title.slice(0, 40)}"`);
            }
            prevHeading = null;
        } else if (prevHeading && (t.startsWith('|') || t.startsWith('>') || t.startsWith('<!--'))) {
            // 테이블·인용·주석이 바로 오면 중복 검사 스킵
            if (!t.startsWith('<!--')) prevHeading = null;
            continue;
        }

        // --- 본문 잔재 (테이블 행·주석 제외) ---
        if (t.startsWith('|') || t.startsWith('<!--')) continue;
        if (/^>\s*[가-하]\.\s/.test(t) || /^[가-하]\.\s/.test(t)) add(file, i + 1, '본문', `본문 가. 불릿: ${t.slice(0, 50)}`);
        if (/^>\s*[a-z]\.\s/.test(t) || /^[a-z]\.\s/.test(t)) add(file, i + 1, '본문', `본문 알파벳 불릿: ${t.slice(0, 50)}`);
        if (/^>?\s*\*\*[가-하A-Za-z]\.\s/.test(t)) add(file, i + 1, '본문', `본문 **가./A. 라벨: ${t.slice(0, 50)}`);
    }
    headingSeqByFile[rel] = numbered;
}

// --- 표준형↔이야기형 번호 시퀀스 동기화 (§5.3) — 경고 전용 ---
const pairs = [];
for (const rel of Object.keys(headingSeqByFile)) {
    if (rel.includes('_표준형')) {
        const story = rel.replace('_표준형', '_이야기형');
        if (headingSeqByFile[story]) pairs.push([rel, story]);
    }
}
const syncDiffs = [];
for (const [a, b] of pairs) {
    const sa = headingSeqByFile[a].filter((x) => !x.startsWith('#####')); // #####는 서사형만 있을 수 있음
    const sb = headingSeqByFile[b].filter((x) => !x.startsWith('#####'));
    if (JSON.stringify(sa) !== JSON.stringify(sb)) {
        const setB = new Set(sb);
        const missing = sa.filter((x) => !setB.has(x));
        const extra = sb.filter((x) => !new Set(sa).has(x));
        syncDiffs.push({ a, b, missing, extra });
    }
}

// --- 출력 ---
const byKind = {};
for (const f of findings) (byKind[f.kind] = byKind[f.kind] || []).push(f);
for (const kind of Object.keys(byKind)) {
    console.log(`\n=== [${kind}] ${byKind[kind].length}건 ===`);
    for (const f of byKind[kind]) console.log(`  ${f.file}:${f.line} — ${f.msg}`);
}
if (syncDiffs.length) {
    console.log(`\n=== [경고] 표준형↔이야기형 번호 불일치 ${syncDiffs.length}쌍 (의도된 이야기형 고유 섹션이면 무시) ===`);
    for (const d of syncDiffs) {
        console.log(`  ${d.a} vs ${d.b}`);
        if (d.missing.length) console.log(`    이야기형 누락: ${d.missing.join(', ')}`);
        if (d.extra.length) console.log(`    이야기형 추가: ${d.extra.join(', ')}`);
    }
}

if (findings.length) {
    console.log(`\n❌ 교재 번호체계 위반 ${findings.length}건 (파일 ${files.length}개 검사, 경고 ${syncDiffs.length}쌍 제외)`);
    process.exit(1);
}
console.log(`✅ 교재 번호체계 정합성 통과 — ${files.length}개 파일, 위반 0건` + (syncDiffs.length ? ` (경고 ${syncDiffs.length}쌍)` : ''));
process.exit(0);
