#!/usr/bin/env node
/**
 * check_textbook_docs.js — 교재 갱신 ↔ `판본: textbook` 문서 신선도
 *
 * 문서의 범위·판본 헤더(check_doc_ids)는 "교재에 종속"을 선언할 뿐 실제
 * 갱신 여부는 보장하지 못한다. 이 체커는 git 이력으로 각 시험의 교재
 * (content/exams/<id>/교재/)가 마지막으로 커밋된 이후 갱신되지 않은
 * `판본: textbook` 선언 문서를 찾아 교재 교체 후 갱신 대상 방치를 게이트한다.
 *
 * 판정: 문서의 마지막 커밋 시각 < 교재 디렉터리의 마지막 커밋 시각 → stale
 *       (동일 커밋 이후 갱신은 검토된 것으로 간주)
 * 대상: docs/exams/<id>/, content/exams/<id>/docs/ 아래 .md 중
 *       `판본: textbook` 선언 문서만. refmat 선언은 참조자료 갱신이
 *       pdf_hashes·고시 감지로 별도 추적되므로 제외.
 * git 이력이 없는 환경·미커밋 파일은 해당 항목 검증을 건너뛴다.
 *
 * 사용: npm run check:textbookdocs  (check:docs 체인·check:content에 포함)
 */

// @spec none (문서 신선도 게이트)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { getExamTargets } = require('../build/exam_targets.js');

const ROOT = path.resolve(__dirname, '..', '..');
const SCOPE_LINE_RE = /^>\s*\*\*범위\*\*:\s*(platform|exam:[a-z0-9-]+)\s*·\s*판본:\s*(none|textbook|refmat)\s*$/m;

/** 경로의 마지막 커밋 유닉스 시각. 이력 없음/git 실패 시 0 */
function lastCommitTs(rel) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ct', '--', rel], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    return Number(out) || 0;
  } catch {
    return 0;
  }
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.md')) yield p;
  }
}

function textbookDocs(examId) {
  const dirs = [
    path.join(ROOT, 'docs', 'exams', examId),
    path.join(ROOT, 'content', 'exams', examId, 'docs'),
  ];
  const out = [];
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const f of walk(d)) {
      const text = fs.readFileSync(f, 'utf8');
      const m = text.match(SCOPE_LINE_RE);
      if (m && m[2] === 'textbook') out.push(path.relative(ROOT, f).replace(/\\/g, '/'));
    }
  }
  return out;
}

const fmt = ts => new Date(ts * 1000).toISOString().slice(0, 10);
const targets = getExamTargets(ROOT);
const stale = [];
let scanned = 0;

for (const t of targets) {
  const eduDir = path.join(t.contentRoot, '교재').replace(/\\/g, '/');
  if (!fs.existsSync(path.join(ROOT, eduDir))) continue;
  const eduTs = lastCommitTs(eduDir);
  const docs = textbookDocs(t.id);
  scanned += docs.length;
  if (!eduTs) continue;
  for (const rel of docs) {
    const docTs = lastCommitTs(rel);
    if (docTs && docTs < eduTs) {
      stale.push({ rel, docTs, eduTs, exam: t.id });
    }
  }
}

console.log(`교재 ↔ 판본:textbook 문서 신선도 — 시험 ${targets.length}개, 검사 문서 ${scanned}개\n`);
if (!stale.length) {
  console.log('✅ 모든 교재 종속 문서가 최신 교재 이후 갱신됨');
  process.exit(0);
}
console.log(`❌ 교재 변경 이후 미갱신 문서 ${stale.length}건:\n`);
for (const s of stale) {
  console.log(`  ${s.rel}\n    문서 갱신 ${fmt(s.docTs)} < 교재 변경 ${fmt(s.eduTs)} (${s.exam})`);
}
console.log('\n조치: 교재 교체 런북(docs/dev/runbooks/TEXTBOOK_REPLACEMENT_RUNBOOK.md) 0c 목록을');
console.log('검토해 문서를 갱신하거나, 검토 완료 시 문서의 갱신일/내용을 갱신해 커밋하세요.');
process.exit(1);
