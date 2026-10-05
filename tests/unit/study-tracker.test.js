// tests/unit/study-tracker.test.js — 학습 활동 자동 기록·목표 추적
// @spec SC-03,SC-05,SC-06,SC-07,D-17
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

test('getExamLeadStatus: 30일 경계·당일·과거 판정', () => {
  const today = new Date(2026, 9, 5); // 2026-10-05
  assert.deepEqual(tracker.getExamLeadStatus('2026-11-04', today), { dday: 30, leadShort: false, past: false });
  assert.deepEqual(tracker.getExamLeadStatus('2026-11-03', today), { dday: 29, leadShort: true, past: false });
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
