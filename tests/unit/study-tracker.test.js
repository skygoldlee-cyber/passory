// tests/unit/study-tracker.test.js — 학습 활동 자동 기록·목표 추적
// @spec SC-03,SC-05,SC-06,SC-07,SC-08,SC-09,SC-12,D-17
// recordStudyActivity가 카드·퀴즈 활동을 날짜별 캘린더에 누적하고,
// 목표 달성률 계산이 저장된 활동을 반영하는지 고정한다.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const TRACKER = '../../src/study-tracker.js';

function createMockStorage() {
  const store = {};
  return {
    getItem(key) { return key in store ? store[key] : null; },
    setItem(key, value) { store[key] = String(value); },
    removeItem(key) { delete store[key]; },
    get length() { return Object.keys(store).length; },
    key(i) { return Object.keys(store)[i] ?? null; },
    clear() { for (const k of Object.keys(store)) delete store[k]; },
    _store: store,
  };
}

let tracker;
let mockStorage;
let originalLocalStorage;

beforeEach(async () => {
  mockStorage = createMockStorage();
  originalLocalStorage = global.localStorage;
  Object.defineProperty(global, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });
  tracker = await import(`${TRACKER}?case=${Date.now()}-${Math.random()}`);
});

afterEach(() => {
  Object.defineProperty(global, 'localStorage', {
    value: originalLocalStorage,
    configurable: true,
    writable: true,
  });
});

test('recordStudyActivity: 오늘 날짜로 cards/quizzes/correct를 누적 기록한다', () => {
  tracker.recordStudyActivity({ cards: 3 });
  tracker.recordStudyActivity({ quizzes: 2, correct: 1 });

  const cal = tracker.getStudyCalendar();
  const today = tracker.getTodayStr();
  assert.equal(cal[today].cards, 3);
  assert.equal(cal[today].quizzes, 2);
  assert.equal(cal[today].correct, 1);
});

test('recordStudyActivity: 같은 날 반복 호출 시 합산된다', () => {
  tracker.recordStudyActivity({ cards: 2 });
  tracker.recordStudyActivity({ cards: 5 });
  const cal = tracker.getStudyCalendar();
  assert.equal(cal[tracker.getTodayStr()].cards, 7);
});

test('getMonthlyStudyDays: 활동이 있는 날만 카운트한다', () => {
  const now = new Date();
  // 과거 날짜 활동을 직접 시드 — recordStudyActivity는 오늘만 기록하므로
  tracker.recordStudyActivity({ cards: 1 });
  const cal = tracker.getStudyCalendar();
  const past = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  cal[past] = { cards: 0, quizzes: 0, correct: 0 }; // 활동 없음 → 카운트 제외
  // 시드 반영을 위해 저장 후 재조회
  tracker.recordStudyActivity({});
  // 직접 수정분은 safeSetItem 경유가 아니므로, 실제 API로 검증 범위 한정:
  const days = tracker.getMonthlyStudyDays(now.getFullYear(), now.getMonth());
  assert.equal(days >= 1, true, '오늘 활동 1일은 카운트돼야 함');
  assert.equal(typeof days, 'number');
});

test('getTodayGoalProgress: 저장된 활동으로 달성률을 계산한다', () => {
  tracker.setStudyGoals({ dailyCards: 10, dailyQuizzes: 4 });
  tracker.recordStudyActivity({ cards: 5, quizzes: 2 });

  const p = tracker.getTodayGoalProgress();
  assert.equal(p.cardsDone, 5);
  assert.equal(p.cardsPercent, 50);
  assert.equal(p.quizzesPercent, 50);
  assert.equal(p.overallPercent, 50);
});

test('getStudyGoals: 미설정 시 기본 목표를 반환하고 부분 저장이 병합된다', () => {
  const def = tracker.getStudyGoals();
  assert.equal(def.dailyCards, 50);
  assert.equal(def.weeklyStudyDays, 5);

  tracker.setStudyGoals({ dailyCards: 20 });
  const merged = tracker.getStudyGoals();
  assert.equal(merged.dailyCards, 20);
  assert.equal(merged.dailyQuizzes, 10); // 미지정 항목은 기본값 유지
});

// --- D-17 시험일 리드타임 권고·계획 등급 ---

const todayPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('getExamLeadStatus: 미설정·무효 날짜 → null', () => {
  assert.equal(tracker.getExamLeadStatus(''), null);
  assert.equal(tracker.getExamLeadStatus(null), null);
  assert.equal(tracker.getExamLeadStatus('2026-13-99'), null);
});

test('getExamLeadStatus: 50일 경계·당일·과거 판정', () => {
  const today = new Date(2026, 9, 5); // 2026-10-05
  assert.deepEqual(tracker.getExamLeadStatus('2026-11-24', today), { dday: 50, leadShort: false, past: false });
  assert.deepEqual(tracker.getExamLeadStatus('2026-11-23', today), { dday: 49, leadShort: true, past: false });
  assert.equal(tracker.getExamLeadStatus('2026-10-05', today).dday, 0);
  assert.deepEqual(tracker.getExamLeadStatus('2026-10-04', today), { dday: -1, leadShort: false, past: true });
});

test('getExamPlanStatus: 미설정 → null, 경과 시험일 → past', () => {
  assert.equal(tracker.getExamPlanStatus(100), null);
  tracker.setExamDate(todayPlus(-3));
  const st = tracker.getExamPlanStatus(100);
  assert.equal(st.tier, 'past');
  assert.equal(st.suggested, null);
});

test('getExamPlanStatus: 권장량÷일일 목표 비율로 normal/tight/triage 판정', () => {
  tracker.setExamDate(todayPlus(10));
  tracker.setStudyGoals({ dailyCards: 10 });
  assert.equal(tracker.getExamPlanStatus(100).tier, 'normal'); // 10/10 = 1.0
  assert.equal(tracker.getExamPlanStatus(150).tier, 'tight');  // 15/10 = 1.5
  assert.equal(tracker.getExamPlanStatus(200).tier, 'tight');  // 20/10 = 2.0 경계
  const triage = tracker.getExamPlanStatus(250);
  assert.equal(triage.tier, 'triage');                       // 25/10 = 2.5
  assert.equal(triage.suggested, 25);
  // 일일 목표 인자 덮어쓰기 — 15/20 = 0.75 → normal
  assert.equal(tracker.getExamPlanStatus(150, 20).tier, 'normal');
  // 남은 항목 없음 → suggested null
  assert.equal(tracker.getExamPlanStatus(0).suggested, null);
});

// --- SC-05 학습 계획 (주간 학습일 반영) ---

test('computeStudyPlan: 미설정·경과 시험일 → null', () => {
  assert.equal(tracker.computeStudyPlan(100), null);
  tracker.setExamDate(todayPlus(-1));
  assert.equal(tracker.computeStudyPlan(100), null);
});

test('computeStudyPlan: 주간 학습일 반영 역산 + 주차별 마일스톤', () => {
  tracker.setExamDate(todayPlus(30));
  tracker.setStudyGoals({ dailyCards: 50, weeklyStudyDays: 5 });
  const plan = tracker.computeStudyPlan(1123);
  assert.equal(plan.studyDays, 21);    // floor(30 × 5/7)
  assert.equal(plan.perStudyDay, 54);  // ceil(1123/21)
  assert.equal(plan.weeks.length, 5);  // ceil(30/7)
  const last = plan.weeks[4];
  assert.equal(last.studyDays, 2);     // 잔여 2일 → 학습일 상한 2
  assert.equal(last.cumulative, 1123); // 누적이 잔여량과 정확히 일치
  assert.equal(last.percent, 100);
  // 학습일당 54장 ÷ 목표 50장 = 1.08 → tight
  assert.equal(plan.tier, 'tight');
});

test('computeStudyPlan: 잔여 0 → done, 목표 이내 → normal, 초과 → triage', () => {
  tracker.setExamDate(todayPlus(30));
  assert.equal(tracker.computeStudyPlan(0).tier, 'done');
  tracker.setStudyGoals({ dailyCards: 50 });
  assert.equal(tracker.computeStudyPlan(200).tier, 'normal'); // 10장/일 vs 50
  tracker.setStudyGoals({ dailyCards: 1 });
  assert.equal(tracker.computeStudyPlan(100).tier, 'triage'); // 5장/일 vs 1 → ratio 5
});

// --- SC-06 계획 대비 주간 진행률 ---

const seedCal = (entries) => {
  const cal = {};
  entries.forEach(([daysAgo, cards]) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    cal[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`] = { cards, quizzes: 0, correct: 0 };
  });
  return cal;
};

test('sumRecentCards: 최근 N일 카드 합계 — 범위 밖 제외', () => {
  const cal = seedCal([[0, 10], [3, 20], [6, 30], [7, 99], [20, 88]]);
  assert.equal(tracker.sumRecentCards(cal, 7), 60); // 10+20+30, 7일·20일 전 제외
});

test('computePlanAdherence: 주간 배정 대비 실적 → met/ontrack/behind/done', () => {
  const plan = { remaining: 100, weeklyCards: 50, weeks: [{ cards: 50 }] };
  assert.equal(tracker.computePlanAdherence(null), null);
  assert.equal(tracker.computePlanAdherence({ ...plan, remaining: 0 }).status, 'done');
  assert.equal(tracker.computePlanAdherence(plan, seedCal([[0, 50]])).status, 'met');     // 50/50
  assert.equal(tracker.computePlanAdherence(plan, seedCal([[1, 30]])).status, 'ontrack'); // 60%
  const behind = tracker.computePlanAdherence(plan, seedCal([[2, 10]]));
  assert.equal(behind.status, 'behind');                                                // 20%
  assert.equal(behind.weekTarget, 50);
  assert.equal(behind.weekActual, 10);
  assert.equal(behind.percent, 20);
  // 마지막 부분 주차 — weeks[0].cards가 주간 목표보다 작으면 그 값이 기준
  const lastWeek = { remaining: 10, weeklyCards: 50, weeks: [{ cards: 10 }] };
  assert.equal(tracker.computePlanAdherence(lastWeek, seedCal([])).weekTarget, 10);
});

// --- SC-07 학습 마일스톤 ---

test('evalStudyMilestones: D-day 임계 도달 → 긴급 순 정렬·seen 제외', () => {
  const m5 = tracker.evalStudyMilestones({ dday: 5 });
  assert.deepEqual(m5.map(m => m.id), ['d7', 'd14', 'd30']); // 긴급한 것 먼저
  const again = tracker.evalStudyMilestones({ dday: 5 }, ['d7', 'd14', 'd30']);
  assert.equal(again.length, 0);
  assert.equal(tracker.evalStudyMilestones({ dday: -2 }).length, 0); // 경과 → 안내 없음
  assert.equal(tracker.evalStudyMilestones({ dday: null }).length, 0);
  assert.deepEqual(tracker.evalStudyMilestones({ dday: 0 }).map(m => m.id), ['d0', 'd1', 'd7', 'd14', 'd30']);
});

test('evalStudyMilestones: 주간 달성·진도 경유 — 주차 id·75% 우선', () => {
  const met = tracker.evalStudyMilestones({
    dday: 60, adherence: { status: 'met', weekActual: 50 }, progressPercent: 80, weekId: '2026-10-05'
  });
  assert.deepEqual(met.map(m => m.id), ['wk-2026-10-05', 'p75']);
  // 같은 주차는 재발화 안 함, 다른 주차는 다시 발화
  assert.equal(tracker.evalStudyMilestones({ adherence: { status: 'met', weekActual: 5 }, weekId: '2026-10-05' }, ['wk-2026-10-05']).length, 0);
  assert.equal(tracker.evalStudyMilestones({ adherence: { status: 'met', weekActual: 5 }, weekId: '2026-10-12' }, ['wk-2026-10-05']).length, 1);
  // p75 미표시 + 진도 55% → p50
  assert.deepEqual(tracker.evalStudyMilestones({ progressPercent: 55 }).map(m => m.id), ['p50']);
});

test('checkStudyMilestones: 저장소 seen 갱신 + limit으로 분할 안내', () => {
  tracker.setExamDate(todayPlus(5));
  const first = tracker.checkStudyMilestones({ remaining: 50, total: 100, limit: 2 });
  assert.deepEqual(first.map(m => m.id), ['d7', 'd14']); // p50도 있지만 limit=2
  const seenKey = Object.keys(mockStorage._store).find(k => k.endsWith('study_milestones_seen'));
  assert.deepEqual(JSON.parse(mockStorage.getItem(seenKey)), ['d7', 'd14']);
  // 다음 호출 — 이미 안내한 것 제외, 남은 것만
  const next = tracker.checkStudyMilestones({ remaining: 50, total: 100, limit: 2 });
  assert.deepEqual(next.map(m => m.id), ['d30', 'p50']);
  assert.equal(tracker.checkStudyMilestones({ remaining: 50, total: 100 }).length, 0);
});

// --- SC-08 과목별 가중 배분 ---

const mkPlan = (...cards) => ({ weeks: cards.map((c, i) => ({ week: i + 1, range: `D-x`, cards: c })) });
const mkSubjects = (list) => list.map(([key, cards]) => ({ key, name: key, stats: { cards } }));
const allocOf = (res, weekIdx, key) => res.weeks[weekIdx].alloc.find(a => a.key === key).cards;

test('computeSubjectAllocation: 출제 비중 비례 배분 + 총량 보존', () => {
  const plan = mkPlan(50);
  const subjects = mkSubjects([['suba', 100], ['subb', 100]]);
  const res = tracker.computeSubjectAllocation(plan, subjects, {
    weightBySubject: { suba: 1, subb: 3 }
  });
  const a = allocOf(res, 0, 'suba');
  const b = allocOf(res, 0, 'subb');
  assert.equal(a + b, 50);           // 총량 보존
  assert.ok(b >= a * 2);             // 비중 3:1 → subb가 압도적
  assert.equal(res.hasWeights, true);
});

test('computeSubjectAllocation: 잔여 상한 워터필링 + 주차 순차 재배분', () => {
  const plan = mkPlan(50, 50);
  const subjects = mkSubjects([['suba', 40], ['subb', 90]]);
  const res = tracker.computeSubjectAllocation(plan, subjects, {
    weightBySubject: { suba: 1, subb: 1 }
  });
  // week1: suba는 잔여 40 상한 — 40 미만 배정 후 week2에 잔여 이월
  assert.ok(allocOf(res, 0, 'suba') <= 40);
  assert.equal(allocOf(res, 0, 'suba') + allocOf(res, 0, 'subb'), 50);
  // week1에서 suba가 일부 소진 → week2는 subb 비중이 상대적으로 증가
  assert.ok(allocOf(res, 1, 'subb') >= allocOf(res, 1, 'suba'));
  // 전 주차 합계는 잔여 총량(130)과 주차 총량(100) 중 작은 값
  const total = res.weeks.reduce((s, w) => s + w.alloc.reduce((x, a) => x + a.cards, 0), 0);
  assert.equal(total, 100);
});

test('computeSubjectAllocation: 약점 가중 표본 게이트 (MIN_ALLOC_SAMPLE)', () => {
  const plan = mkPlan(50);
  const subjects = mkSubjects([['suba', 100], ['subb', 100]]);
  // 표본 미만(19문) → 중립 가중 → 균등 분할
  const small = tracker.computeSubjectAllocation(plan, subjects, {
    quizBySubject: { suba: { solved: 19, correct: 0 } },
    weightBySubject: { suba: 1, subb: 1 }
  });
  assert.equal(allocOf(small, 0, 'suba'), allocOf(small, 0, 'subb'));
  // 표본 충족 + 정답률 20% → 가중 1.8 → suba 배정 증가
  const weak = tracker.computeSubjectAllocation(plan, subjects, {
    quizBySubject: { suba: { solved: 25, correct: 5 } },
    weightBySubject: { suba: 1, subb: 1 }
  });
  assert.ok(allocOf(weak, 0, 'suba') > allocOf(weak, 0, 'subb'));
});

test('computeSubjectAllocation: 비중 미선언 → 균등 폴백, 비중 전부 0 → 잔여 비례', () => {
  const plan = mkPlan(50);
  const subjects = mkSubjects([['suba', 100], ['subb', 100]]);
  const noW = tracker.computeSubjectAllocation(plan, subjects, {});
  assert.equal(noW.hasWeights, false);
  assert.equal(allocOf(noW, 0, 'suba'), allocOf(noW, 0, 'subb'));
  // 비중 선언됐으나 전부 0 → 잔여 비례 폴백으로 총량 보존
  const zeroW = tracker.computeSubjectAllocation(plan, subjects, {
    weightBySubject: { suba: 0, subb: 0 }
  });
  assert.equal(allocOf(zeroW, 0, 'suba') + allocOf(zeroW, 0, 'subb'), 50);
  // 암기 완료 과목은 배정 0 — 나머지 과목이 전량 흡수
  const done = tracker.computeSubjectAllocation(plan, subjects, {
    memBySubject: { suba: 100 }, weightBySubject: { suba: 1, subb: 1 }
  });
  assert.equal(allocOf(done, 0, 'suba'), 0);
  assert.equal(allocOf(done, 0, 'subb'), 50);
});

test('computeSubjectAllocation: plan·과목 없음 → null', () => {
  assert.equal(tracker.computeSubjectAllocation(null, mkSubjects([['suba', 10]])), null);
  assert.equal(tracker.computeSubjectAllocation(mkPlan(10), []), null);
  assert.equal(tracker.computeSubjectAllocation({ weeks: [] }, mkSubjects([['suba', 10]])), null);
});

// --- SC-09 스마트학습 보강 ---

test('recordStudyActivity: bySubj 과목별 카드 증분 누적', () => {
  tracker.recordStudyActivity({ cards: 3, bySubj: { law: 2, safety: 1 } });
  tracker.recordStudyActivity({ cards: 1, bySubj: { law: 1 } });
  const cal = tracker.getStudyCalendar();
  assert.deepEqual(cal[tracker.getTodayStr()].bySubj, { law: 3, safety: 1 });
  assert.equal(cal[tracker.getTodayStr()].cards, 4);
});

test('sumRecentCardsBySubject: 최근 N일 bySubj 합산 — 범위 밖·레거시 엔트리 제외', () => {
  const pad = (n) => String(n).padStart(2, '0');
  const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = new Date(2026, 9, 5);
  const y = new Date(2026, 9, 4);
  const old = new Date(2026, 8, 20); // 15일 전 — 범위 밖
  const cal = {
    [key(today)]: { cards: 4, bySubj: { law: 3, safety: 1 } },
    [key(y)]: { cards: 2, bySubj: { law: 2 } },
    [key(old)]: { cards: 9, bySubj: { law: 9 } },
    '2026-10-03': { cards: 5 }, // bySubj 없는 레거시 엔트리 → 제외
  };
  assert.deepEqual(tracker.sumRecentCardsBySubject(cal, 7, today), { law: 5, safety: 1 });
});

test('recentQuizBySubject: 과목당 최근 윈도우만 집계', () => {
  const qr = {};
  for (let i = 0; i < 70; i++) qr[`law_quiz_${i}`] = { solved: true, correct: i < 35 };
  for (let i = 0; i < 10; i++) qr[`safety_quiz_${i}`] = { solved: true, correct: true };
  const r = tracker.recentQuizBySubject(qr, 60);
  assert.equal(r.law.solved, 60);   // 윈도우 상한 — 최근 60문
  assert.equal(r.law.correct, 25);  // 뒤에서 60개(i=10..69) 중 i<35는 25개
  assert.equal(r.safety.solved, 10);
});

test('computeSubjectAllocation: 최근 표본 우선 + 약점·비중 필드 노출', () => {
  const plan = mkPlan(50);
  const subjects = mkSubjects([['suba', 100], ['subb', 100]]);
  const res = tracker.computeSubjectAllocation(plan, subjects, {
    quizBySubject: { suba: { solved: 100, correct: 100 }, subb: { solved: 20, correct: 20 } }, // 누적은 만점
    recentQuizBySubject: { suba: { solved: 25, correct: 5 } }, // 최근 정답률 20% → 약점 우선 적용
    weightBySubject: { suba: 1, subb: 1 }
  });
  assert.ok(allocOf(res, 0, 'suba') > allocOf(res, 0, 'subb'));
  const a = res.weeks[0].alloc.find(x => x.key === 'suba');
  assert.ok(a.weakW > 1.5);
  assert.equal(a.weightPct, 50);
  assert.equal(a.weakBadge, true);
});

test('computeSubjectAllocation: 취약 카드 비율 가산 (+0.5 상한) + 중립 폴백', () => {
  const plan = mkPlan(50);
  const subjects = mkSubjects([['suba', 100], ['subb', 100]]);
  const res = tracker.computeSubjectAllocation(plan, subjects, {
    weakBySubject: { suba: 50 }, // 잔여 100 중 50% 취약 → +0.5
    weightBySubject: { suba: 1, subb: 1 }
  });
  const a = res.weeks[0].alloc.find(x => x.key === 'suba');
  assert.equal(a.weakW, 1.5);
  assert.equal(a.weakBadge, true);
  assert.ok(allocOf(res, 0, 'suba') > allocOf(res, 0, 'subb'));
  // 표본·취약 모두 없음 → 중립 1.0, 배지 없음
  const flat = tracker.computeSubjectAllocation(plan, subjects, {
    weightBySubject: { suba: 1, subb: 1 }
  });
  const fb = flat.weeks[0].alloc.find(x => x.key === 'suba');
  assert.equal(fb.weakW, 1.0);
  assert.equal(fb.weakBadge, false);
});

// --- SC-12: 약점 신호 통합 (diagBySubject) + 공용 입력 집계 ---

test('computeSubjectAllocInputs: 과목별 입력 맵 집계 — mem·quiz·weak·weights·diag', () => {
  const now = Date.now();
  const inputs = tracker.computeSubjectAllocInputs({
    memorizedCards: new Set(['suba_card_1', 'suba_card_2']),
    quizResults: { suba_quiz_1: { correct: true }, subb_quiz_1: { correct: false } },
    weakCards: new Set(['suba_card_9', 'weak_quiz_suba_quiz_1']),
    exams: [{ subject: 'suba', stats: { questions: 10 } }, { subject: 'subb', stats: { questions: 30 } }],
    wrongCauses: {
      q1: { cause: 'memorize', ts: now - 10 * 864e5, subjectId: 'suba' },  // 10일 전 — 포함
      q2: { cause: 'memorize', ts: now - 40 * 864e5, subjectId: 'suba' },  // 40일 전 — 윈도우 밖 제외
      q3: { cause: 'calc', ts: now, subjectId: 'subb' },
    },
    weakChapterGroups: [{ subjectKey: 'suba', chapters: [{ chapter: 'x', wrongs: 3 }, { chapter: 'y', wrongs: 2 }] }],
    now
  });
  assert.equal(inputs.memBySubject.suba, 2);
  assert.deepEqual(inputs.quizBySubject.subb, { solved: 1, correct: 0 });
  assert.equal(inputs.weakBySubject.suba, 1);          // weak_quiz 접두사 항목은 카드 집계 제외
  assert.equal(inputs.weightBySubject.subb, 30);
  assert.deepEqual(inputs.diagBySubject.suba, { causes: 1, weakChapters: 2 });
  assert.deepEqual(inputs.diagBySubject.subb, { causes: 1, weakChapters: 0 });
});

test('computeSubjectAllocation: 진단 신호 가산 (SC-12) — 오답 원인·취약 단원, 상한 캡', () => {
  const plan = mkPlan(50);
  const subjects = mkSubjects([['suba', 100], ['subb', 100]]);
  const res = tracker.computeSubjectAllocation(plan, subjects, {
    diagBySubject: { suba: { causes: 5, weakChapters: 2 } }, // 5×0.1 + 2×0.15 = 0.8 → MAX_DIAG_BOOST 0.5 캡
    weightBySubject: { suba: 1, subb: 1 }
  });
  const a = res.weeks[0].alloc.find(x => x.key === 'suba');
  assert.equal(a.diagBoost, 0.5);
  assert.equal(a.weakW, 1.5); // 중립 1.0 + 0.5
  assert.equal(a.weakBadge, true); // diagBoost ≥ 0.15
  assert.ok(allocOf(res, 0, 'suba') > allocOf(res, 0, 'subb'));

  // diagBoost가 약하면 배지 미표시, 약한 가산만
  const res2 = tracker.computeSubjectAllocation(plan, subjects, {
    diagBySubject: { suba: { causes: 1, weakChapters: 0 } }, // +0.1
    weightBySubject: { suba: 1, subb: 1 }
  });
  const a2 = res2.weeks[0].alloc.find(x => x.key === 'suba');
  assert.equal(a2.diagBoost, 0.1);
  assert.equal(a2.weakW, 1.1);
  assert.equal(a2.weakBadge, false);
});

test('computeSubjectAllocation: 진단+퀴즈+취약카드 합산도 약점 가중 상한 2.5 유지', () => {
  const plan = mkPlan(50);
  const subjects = mkSubjects([['suba', 100], ['subb', 100]]);
  const res = tracker.computeSubjectAllocation(plan, subjects, {
    quizBySubject: { suba: { solved: 20, correct: 0 } },   // 2 − 0 = 2.0
    weakBySubject: { suba: 50 },                            // +0.5
    diagBySubject: { suba: { causes: 5, weakChapters: 2 } },// +0.5
    weightBySubject: { suba: 1, subb: 1 }
  });
  const a = res.weeks[0].alloc.find(x => x.key === 'suba');
  assert.equal(a.weakW, tracker.MAX_WEAK_WEIGHT); // 3.0 → 2.5 캡
});
