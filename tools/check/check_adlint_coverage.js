// tools/check/check_adlint_coverage.js — 광고 점검 사전 커버리지 감사 (FO-68)
// @spec FO-68
//
// 실행: node tools/check/check_adlint_coverage.js
//
// 화장품법 시행규칙 [별표 5] '표시·광고의 범위 및 준수사항' 2항 각 호를
// ad-lint.js의 사전 카테고리가 커버하는지 정량 감사한다.
//
// 점검 항목:
//  1. 법정 준수사항 카테고리별 대표 표현이 사전에 존재하는가 (커버리지)
//  2. 사전 항목 품질 — term/category/suggestion 누락, 중복 term, 미사용 카테고리
//  3. lintAdCopy가 사전의 모든 term을 실제로 검출하는가 (자기 검출 회귀)
//
// 커버리지 실패 시 exit 1 — check:ci 체인에 포함 가능.

import { AD_BANNED_TERMS, AD_CATEGORIES, lintAdCopy }
  from '../../src/exams/cosmetic/ad-lint.js';

/* 별표5 2항 각 호 → 사전이 커버해야 할 대표 표현 (테스트 문장에 삽입해 검출 확인).
 * keyword 매칭으로는 잡을 수 없는 호(외국제품 오인 라, 기술제휴 마, 저속·혐오 자,
 * 멸종위기종 차, 비방 카, 소비자 오인 사)는 expected: [] 로 선언해 '검토 필요'로 보고한다
 * — 감사의 목적은 '사전이 커버하지 않는다'는 사실 자체의 가시화다. */
const LEGAL_CLAUSES = [
  { clause: '가', name: '의약품 오인 금지', category: 'medicine',
    expected: ['치료', '완치', '아토피'] },
  { clause: '나', name: '기능성화장품 오인 금지', category: 'functional',
    expected: ['미백', '주름 개선', '자외선 차단'] },
  { clause: '다', name: '의료 전문가 추천·공인 표현 금지', category: 'endorsement',
    expected: ['의사 추천', '피부과 추천', '약사 추천'] },
  { clause: '라', name: '국내외 제품 오인 금지', category: null, expected: [] },
  { clause: '마', name: '외국 기술제휴 허위 표현 금지', category: null, expected: [] },
  { clause: '바', name: '비교·절대적 표현 금지', category: 'overclaim',
    expected: ['최고', '최상'] },
  { clause: '사', name: '소비자 오인·기만 표현 금지', category: 'overclaim',
    expected: ['무자극', '100% 안전'] },
  { clause: '아', name: '객관 확인 불가 효능 표현 금지', category: 'overclaim',
    expected: ['기적', '즉효'] },
  { clause: '자', name: '저속·혐오 표현 금지', category: null, expected: [] },
  { clause: '차', name: '멸종위기종 함유 표현 금지', category: null, expected: [] },
  { clause: '카', name: '타 제품 비방 금지', category: null, expected: [] },
];

const issues = [];
const warns = [];

// ── 1. 법정 호별 커버리지 ──
const byTerm = new Map(AD_BANNED_TERMS.map(t => [t.term, t]));
let coveredClauses = 0;
for (const c of LEGAL_CLAUSES) {
  const missing = c.expected.filter(term => !byTerm.has(term));
  if (missing.length) {
    issues.push(`별표5 2.${c.clause}(${c.name}) — 대표 표현 미탑재: ${missing.join(', ')}`);
    continue;
  }
  if (!c.expected.length) {
    warns.push(`별표5 2.${c.clause}(${c.name}) — 키워드 검출 불가 영역, 수동 검토 필요`);
    continue;
  }
  coveredClauses++;
}

// ── 2. 사전 품질 ──
const seen = new Set();
const catCounts = {};
for (const t of AD_BANNED_TERMS) {
  if (!t.term || !String(t.term).trim()) issues.push('빈 term 항목 존재');
  if (!t.category || !AD_CATEGORIES[t.category]) {
    issues.push(`term '${t.term}' — 미정의 category '${t.category}'`);
  }
  if (!t.suggestion || !String(t.suggestion).trim()) {
    warns.push(`term '${t.term}' — suggestion 없음`);
  }
  if (seen.has(t.term)) issues.push(`중복 term: '${t.term}'`);
  seen.add(t.term);
  catCounts[t.category] = (catCounts[t.category] || 0) + 1;
}
for (const [id, cat] of Object.entries(AD_CATEGORIES)) {
  if (!catCounts[id]) warns.push(`카테고리 '${id}'(${cat.label}) — 사전에 term이 0건`);
}

// ── 3. 자기 검출 회귀 — 모든 term이 실제 lintAdCopy에 검출되는가 ──
let detected = 0;
for (const t of AD_BANNED_TERMS) {
  const hits = lintAdCopy(`이 제품은 ${t.term} 효과가 있습니다`);
  if (hits.some(h => h.term === t.term)) detected++;
  else warns.push(`term '${t.term}' — lintAdCopy가 자기 term을 검출하지 못함 (중첩 우선순위 확인)`);
}

// ── 리포트 ──
console.log('광고 점검 사전 커버리지 감사 (FO-68)');
console.log(`  사전 규모: ${AD_BANNED_TERMS.length} terms / ${Object.keys(AD_CATEGORIES).length} categories`);
for (const [id, n] of Object.entries(catCounts)) {
  console.log(`    ${id} (${AD_CATEGORIES[id]?.label || '?'}): ${n}건`);
}
console.log(`  별표5 2항 커버리지: ${coveredClauses}/${LEGAL_CLAUSES.length} 호 직접 커버`);
console.log(`  자기 검출: ${detected}/${AD_BANNED_TERMS.length} terms`);
if (warns.length) {
  console.log('  경고:');
  for (const w of warns) console.log(`    ⚠ ${w}`);
}
if (issues.length) {
  console.log('  오류:');
  for (const i of issues) console.log(`    ✗ ${i}`);
  process.exit(1);
}
console.log('  결과: 통과');
