#!/usr/bin/env node
/**
 * check_doc_ids.js — 문서 ID 부여·유일성 검증
 *
 * docs/, ref-pipeline/, content/exams/*\/docs/(앱 내 문서), 루트 문서
 * (AGENTS.md·README.md)의 모든 마크다운에 `> **문서 ID**: DOC-XX-NN` 헤더가
 * 존재하고, ID가 전체 문서에서 유일한지 검사한다. 새 문서 추가 시 ID 누락·중복을
 * 자동 탐지한다.
 *
 * 또한 `> **범위**: platform|exam:<id> · 판본: none|textbook|refmat` 헤더의 존재와
 * 위치↔선언 일치({docs,content}/exams/<id>/ 아래는 exam:<id>, 그 외는 platform)를
 * 검증한다. 판본 선언은 교재(textbook)·참조자료(refmat) 교체 시 갱신 대상 문서를
 * 기계 조회하는 근거다 — 교재 종속 문서의 실제 신선도는 check_textbook_docs.js가
 * git 이력으로 별도 게이트한다.
 *
 * 제외: content/exams/*\/ref_md/·교재/*.md — 판본이 파일명(제N호·시행일)과
 * 빌드 파이프라인에 내재화된 자동 변환물이라 헤더 대상이 아니다.
 *
 * 사용법:
 *   npm.cmd run check:docs          # 경로 검증 + 문서 ID 검증 (연쇄 실행)
 *   node tools/check/check_doc_ids.js     # 문서 ID만 검증
 */

// @spec none (문서 ID 검증)
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

const DOC_DIRS = ['docs', 'ref-pipeline'];
const DOC_FILES = ['AGENTS.md', 'README.md'];

const ID_RE = /^\s*>\s*\*\*문서 ID\*\*:\s*(DOC-[A-Z]+-\d+)\s*$/m;
const ID_FIND_RE = /\*\*문서 ID\*\*:\s*(DOC-[A-Z]+-\d+)/g;
const SCOPE_RE = /\*\*범위\*\*:\s*(\S+)\s*·\s*판본:\s*(\S+)/;
const SCOPE_LINE_RE = /^>\s*\*\*범위\*\*:\s*(platform|exam:[a-z0-9-]+)\s*·\s*판본:\s*(none|textbook|refmat)\s*$/m;

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue; // .pytest_cache·node_modules 등 제외
      yield* walk(p);
    } else if (e.name.endsWith('.md')) yield p;
  }
}

function docFiles() {
  const files = DOC_FILES
    .filter(f => fs.existsSync(path.join(ROOT, f)))
    .map(f => path.join(ROOT, f));
  for (const d of DOC_DIRS) {
    const abs = path.join(ROOT, d);
    if (fs.existsSync(abs)) files.push(...walk(abs));
  }
  // content/exams/<id>/docs/ — 앱 내 문서도 ID·범위 헤더 대상
  const examsDir = path.join(ROOT, 'content', 'exams');
  if (fs.existsSync(examsDir)) {
    for (const e of fs.readdirSync(examsDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const docsSub = path.join(examsDir, e.name, 'docs');
      if (fs.existsSync(docsSub)) files.push(...walk(docsSub));
    }
  }
  return files;
}

const files = docFiles();
const seen = new Map(); // id → file
const issues = [];

for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const text = fs.readFileSync(file, 'utf8');
  const ids = [...text.matchAll(ID_FIND_RE)].map(m => m[1]);
  if (ids.length === 0) {
    issues.push({ file: rel, msg: '문서 ID 헤더 없음 — 상단에 `> **문서 ID**: DOC-XX-NN` 추가 필요' });
    continue;
  }
  if (ids.length > 1) {
    issues.push({ file: rel, msg: `문서 ID 다수 선언 (${ids.join(', ')}) — 1개만 허용` });
  }
  if (!ID_RE.test(text)) {
    issues.push({ file: rel, msg: '문서 ID 형식 오류 — `> **문서 ID**: DOC-XX-NN` 블록 인용 형태여야 함' });
  }
  for (const id of ids) {
    if (seen.has(id)) {
      issues.push({ file: rel, msg: `문서 ID 중복: ${id} (이미 ${seen.get(id)}에서 사용)` });
    } else {
      seen.set(id, rel);
    }
  }

  // 범위 헤더 — 존재·형식·위치↔선언 일치
  const scopeM = text.match(SCOPE_RE);
  if (!scopeM) {
    issues.push({ file: rel, msg: '범위 헤더 없음 — `> **범위**: platform|exam:<id> · 판본: none|textbook|refmat` 추가 필요' });
  } else if (!SCOPE_LINE_RE.test(text)) {
    issues.push({ file: rel, msg: `범위 헤더 형식 오류 — 선언값: ${scopeM[1]} · 판본: ${scopeM[2]}` });
  } else {
    const em = rel.match(/^(?:docs|content)\/exams\/([a-z0-9-]+)\//);
    const expected = em ? `exam:${em[1]}` : 'platform';
    if (scopeM[1] !== expected) {
      issues.push({ file: rel, msg: `범위 불일치 — 위치상 ${expected}여야 함 (선언: ${scopeM[1]})` });
    }
  }
}

if (!issues.length) {
  console.log(`✅ 문서 ID 검증 통과 — ${files.length}개 문서, ${seen.size}개 고유 ID`);
  process.exit(0);
}

console.log(`⚠ 문서 ID 문제 ${issues.length}건 발견:\n`);
for (const i of issues) console.log(` ${i.file}\n   ✗ ${i.msg}`);
console.log(`\nID 규약: DOC-{영역}-{NN} — 영역 접두사는 docs/README.md "문서 ID 레지스트리" 참조`);
console.log(`범위 규약: platform(플랫폼 공통) | exam:<id>(docs/exams/<id>/ 소속) + 판본 none|textbook|refmat`);
process.exit(1);
