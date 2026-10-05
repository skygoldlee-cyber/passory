// src/study-tracker.js — 학습 캘린더/목표 추적 헬퍼
// @spec SC-03,SC-05,SC-06,SC-07,SC-08,SC-09,D-17
// 학습 활동을 날짜별로 기록하고, 목표 달성률을 계산합니다.
import { safeGetItem, safeSetItem } from './state.js';
import { STORAGE_KEYS } from './storage-keys.js';
import { localDateKey } from './utils.js';
import { subjectKeyFromItemId } from './weak-items.js';

/* =======================================================
   📅 학습 캘린더 (날짜별 학습 기록)
   ======================================================= */

/**
 * 로컬 날짜 문자열 반환 (YYYY-MM-DD)
 */
function _localDateStr(d) {
    return localDateKey(d);
}

/**
 * 오늘 날짜 문자열 반환 (YYYY-MM-DD, 로컬 기준)
 */
export function getTodayStr() {
    return _localDateStr(new Date());
}

/**
 * 학습 캘린더 전체 데이터 조회
 * @returns {Object} { "2026-09-12": { cards: 5, quizzes: 3, correct: 2, h: {"21": 2} }, ... }
 *   `h`는 시간대 버킷(시 → 활동 횟수) — 학습 패턴 분석용, 레거시 엔트리는 없을 수 있음
 */
export function getStudyCalendar() {
    try {
        return JSON.parse(safeGetItem(STORAGE_KEYS.STUDY_CALENDAR) || '{}');
    } catch (e) {
        return {};
    }
}

/**
 * 오늘 학습 활동 기록 (누적)
 * @param {Object} activity - { cards: 증가할 카드 수, quizzes: 증가할 퀴즈 수, correct: 정답 수,
 *   bySubj: 과목별 카드 증분 {subjKey: n} — SC-09 스마트학습 과목별 주간 실적용 }
 */
export function recordStudyActivity(activity = {}) {
    const today = getTodayStr();
    const cal = getStudyCalendar();
    const entry = cal[today] || { cards: 0, quizzes: 0, correct: 0 };
    if (activity.cards) entry.cards += activity.cards;
    if (activity.quizzes) entry.quizzes += activity.quizzes;
    if (activity.correct) entry.correct += activity.correct;
    if (activity.bySubj && typeof activity.bySubj === 'object') {
        entry.bySubj = entry.bySubj || {};
        Object.entries(activity.bySubj).forEach(([k, n]) => {
            if (n > 0) entry.bySubj[k] = (entry.bySubj[k] || 0) + n;
        });
    }
    if (activity.cards || activity.quizzes) {
        // 시간대 버킷 — 학습 패턴 분석(computeStudyPattern)용, 활동 호출당 1회
        const hr = new Date().getHours();
        entry.h = entry.h || {};
        entry.h[hr] = (entry.h[hr] || 0) + 1;
    }
    cal[today] = entry;
    safeSetItem(STORAGE_KEYS.STUDY_CALENDAR, JSON.stringify(cal));
}

/**
 * 이번 달 학습 일수
 */
export function getMonthlyStudyDays(year, month) {
    const cal = getStudyCalendar();
    let count = 0;
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    Object.keys(cal).forEach(date => {
        if (date.startsWith(prefix)) {
            const e = cal[date];
            if (e.cards > 0 || e.quizzes > 0) count++;
        }
    });
    return count;
}

/* =======================================================
   🎯 학습 목표 (일일/주간)
   ======================================================= */

const DEFAULT_GOALS = {
    dailyCards: 50,
    dailyQuizzes: 10,
    weeklyStudyDays: 5
};

/**
 * 학습 목표 조회
 */
export function getStudyGoals() {
    try {
        const stored = JSON.parse(safeGetItem(STORAGE_KEYS.STUDY_GOALS) || '{}');
        return { ...DEFAULT_GOALS, ...stored };
    } catch (e) {
        return { ...DEFAULT_GOALS };
    }
}

/**
 * 학습 목표 저장
 */
export function setStudyGoals(goals) {
    const current = getStudyGoals();
    const merged = { ...current, ...goals };
    safeSetItem(STORAGE_KEYS.STUDY_GOALS, JSON.stringify(merged));
    return merged;
}

/**
 * 오늘 목표 달성률 계산
 * @returns {Object} { cardsDone, cardsGoal, quizzesDone, quizzesGoal, overallPercent }
 */
export function getTodayGoalProgress() {
    const goals = getStudyGoals();
    const today = getTodayStr();
    const cal = getStudyCalendar();
    const entry = cal[today] || { cards: 0, quizzes: 0, correct: 0 };
    const cardsDone = entry.cards || 0;
    const quizzesDone = entry.quizzes || 0;
    const cardsPercent = goals.dailyCards > 0 ? Math.min(100, Math.round((cardsDone / goals.dailyCards) * 100)) : 0;
    const quizzesPercent = goals.dailyQuizzes > 0 ? Math.min(100, Math.round((quizzesDone / goals.dailyQuizzes) * 100)) : 0;
    const overallPercent = Math.round((cardsPercent + quizzesPercent) / 2);
    return {
        cardsDone,
        cardsGoal: goals.dailyCards,
        quizzesDone,
        quizzesGoal: goals.dailyQuizzes,
        cardsPercent,
        quizzesPercent,
        overallPercent
    };
}

/**
 * 이번 주 목표 달성률 계산 (학습 일수)
 */
export function getWeeklyGoalProgress() {
    const goals = getStudyGoals();
    const cal = getStudyCalendar();
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=일, 1=월, ...
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    let studyDays = 0;
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        if (d > today) break;
        const entry = cal[_localDateStr(d)];
        if (entry && (entry.cards > 0 || entry.quizzes > 0)) studyDays++;
    }
    const percent = goals.weeklyStudyDays > 0 ? Math.min(100, Math.round((studyDays / goals.weeklyStudyDays) * 100)) : 0;
    return {
        studyDays,
        goalDays: goals.weeklyStudyDays,
        percent
    };
}

/* =======================================================
   🗓️ 시험일 / D-day (역산 학습 계획)
   ======================================================= */

function _isValidDateStr(dateStr) {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/**
 * 시험일 조회 (YYYY-MM-DD 또는 null)
 */
export function getExamDate() {
    const v = safeGetItem(STORAGE_KEYS.EXAM_DATE);
    return _isValidDateStr(v) ? v : null;
}

/**
 * 시험일 저장 (null/빈 문자열/유효하지 않은 날짜면 제거)
 */
export function setExamDate(dateStr) {
    safeSetItem(STORAGE_KEYS.EXAM_DATE, _isValidDateStr(dateStr) ? dateStr : '');
}

/**
 * 시험까지 남은 일수 (오늘=0 기준). 미설정이면 null.
 * 시험일이 지났으면 음수.
 */
export function getDDay() {
    const examStr = getExamDate();
    if (!examStr) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const exam = new Date(examStr + 'T00:00:00');
    return Math.round((exam.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * D-day 역산 일일 권장량.
 * @param {number} remainingItems 남은 학습 항목 수 (예: 미암기 카드 수)
 * @returns {number|null} 일일 권장 개수 (올림). 미설정/D-day 지남이면 null.
 */
export function getSuggestedDailyCount(remainingItems) {
    const dday = getDDay();
    if (dday === null || dday <= 0 || remainingItems <= 0) return null;
    return Math.ceil(remainingItems / dday);
}

/** 시험일 설정 권고 — 최소 권장 준비 기간(일) */
export const MIN_EXAM_LEAD_DAYS = 30;

/**
 * 시험일 리드타임 평가 — 목표 설정 모달의 인라인 권고용.
 * @param {string|null} dateStr YYYY-MM-DD
 * @param {Date} [today] 기준일 (테스트 주입용)
 * @returns {{dday:number, leadShort:boolean, past:boolean}|null} 유효하지 않은 날짜면 null
 */
export function getExamLeadStatus(dateStr, today = new Date()) {
    if (typeof dateStr !== 'string' || !_isValidDateStr(dateStr)) return null;
    const [y, m, d] = dateStr.split('-').map(Number);
    const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const dday = Math.round((new Date(y, m - 1, d).getTime() - base.getTime()) / (1000 * 60 * 60 * 24));
    return { dday, leadShort: dday >= 0 && dday < MIN_EXAM_LEAD_DAYS, past: dday < 0 };
}

/**
 * D-day 계획 등급 — 역산 권장량 ÷ 일일 카드 목표 비율로 판정.
 *   'normal' ≤1.0 여유 — 페이스 안내
 *   'tight'  ≤2.0 압축 — 카드·퀴즈 병행 권장
 *   'triage' >2.0 긴급 — 전량 커버 어려움, 과목 우선순위 필요
 * @param {number} remainingItems 남은 학습 항목 수 (예: 미암기 카드)
 * @param {number} [dailyGoal] 일일 카드 목표 (생략 시 저장된 목표)
 * @returns {{dday:number, suggested:number|null, ratio:number|null, tier:string}|null}
 *   시험일 미설정이면 null, 경과면 tier='past', 남은 항목이 없으면 suggested=null
 */
export function getExamPlanStatus(remainingItems, dailyGoal) {
    const dday = getDDay();
    if (dday === null) return null;
    if (dday <= 0) return { dday, suggested: null, ratio: null, tier: 'past' };
    const suggested = getSuggestedDailyCount(remainingItems);
    if (suggested === null) return { dday, suggested: null, ratio: null, tier: 'normal' };
    const goal = (typeof dailyGoal === 'number' && dailyGoal > 0) ? dailyGoal : getStudyGoals().dailyCards;
    const ratio = goal > 0 ? suggested / goal : Infinity;
    const tier = ratio <= 1 ? 'normal' : ratio <= 2 ? 'tight' : 'triage';
    return { dday, suggested, ratio, tier };
}

/**
 * 시험일 역산 학습 계획 — 설정된 목표(주간 학습일 반영)와 잔여 학습량으로
 * 학습 가능 일수·학습일당 필요량·주차별 마일스톤을 생성한다 (SC-05 계획 패널).
 * 학습 가능 일수 = ⌊dday × 주간 학습일 ÷ 7⌋ — 단순 달력 역산보다 실제 약속 기준.
 * @param {number} remainingItems 남은 학습 항목 수 (예: 미암기 카드)
 * @returns {Object|null} 시험일 미설정·경과면 null.
 *   { dday, studyDays, perStudyDay, weeklyCards, remaining, weeks, goals, tier }
 *   weeks[] = { week, range, studyDays, cards, cumulative, percent }
 *   tier: 'done'(잔여 0) | 'normal' | 'tight' | 'triage' — perStudyDay÷일일 목표 비율
 */
export function computeStudyPlan(remainingItems) {
    const dday = getDDay();
    if (dday === null || dday <= 0) return null;
    const goals = getStudyGoals();
    const remaining = Math.max(0, Math.round(remainingItems));
    const studyDays = Math.max(1, Math.floor(dday * goals.weeklyStudyDays / 7));
    const perStudyDay = remaining > 0 ? Math.ceil(remaining / studyDays) : 0;
    const weekCount = Math.ceil(dday / 7);
    const weeks = [];
    let covered = 0;
    for (let w = 0; w < weekCount; w++) {
        const daysInWeek = Math.min(7, dday - w * 7);
        const studyDaysInWeek = Math.min(goals.weeklyStudyDays, daysInWeek);
        const cards = Math.min(remaining - covered, perStudyDay * studyDaysInWeek);
        covered += cards;
        weeks.push({
            week: w + 1,
            range: `D-${dday - w * 7} ~ D-${Math.max(0, dday - (w + 1) * 7)}`,
            studyDays: studyDaysInWeek,
            cards,
            cumulative: covered,
            percent: remaining > 0 ? Math.min(100, Math.round(covered / remaining * 100)) : 100
        });
    }
    const ratio = goals.dailyCards > 0 ? perStudyDay / goals.dailyCards : Infinity;
    const tier = remaining === 0 ? 'done' : (ratio <= 1 ? 'normal' : ratio <= 2 ? 'tight' : 'triage');
    return {
        dday,
        studyDays,
        perStudyDay,
        weeklyCards: perStudyDay * goals.weeklyStudyDays,
        remaining,
        weeks,
        goals: { dailyCards: goals.dailyCards, dailyQuizzes: goals.dailyQuizzes, weeklyStudyDays: goals.weeklyStudyDays },
        tier
    };
}

/* =======================================================
   📈 계획 준수·마일스톤 (SC-06, SC-07)
   ======================================================= */

/**
 * 최근 N일 카드 실적 합계 (오늘 포함)
 * @param {Object} calendar getStudyCalendar() 결과
 * @param {number} [days] 집계 일수
 * @param {Date} [today] 기준일 (테스트 주입용)
 */
export function sumRecentCards(calendar, days = 7, today = new Date()) {
    let total = 0;
    for (let i = 0; i < days; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const entry = calendar[_localDateStr(d)];
        if (entry && entry.cards > 0) total += entry.cards;
    }
    return total;
}

/**
 * 최근 N일 과목별 카드 실적 (SC-09) — 캘린더 `bySubj` 항목을 과목 키별로 합산.
 * bySubj가 없는 레거시 엔트리는 과목을 알 수 없어 제외된다.
 * @param {Object} calendar getStudyCalendar() 결과
 * @param {number} [days] 집계 일수
 * @param {Date} [today] 기준일 (테스트 주입용)
 * @returns {Object} {subjKey: 카드 수}
 */
export function sumRecentCardsBySubject(calendar, days = 7, today = new Date()) {
    const out = {};
    for (let i = 0; i < days; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const entry = calendar[_localDateStr(d)];
        if (entry && entry.bySubj) {
            Object.entries(entry.bySubj).forEach(([k, n]) => {
                if (n > 0) out[k] = (out[k] || 0) + n;
            });
        }
    }
    return out;
}

/**
 * 계획 대비 주간 진행률 (SC-06) — 이번 주 배정량(weeks[0]) 대비
 * 최근 7일 카드 실적 비율. 마지막 부분 주차는 배정량이 자동 축소된다.
 * @param {Object|null} plan computeStudyPlan() 결과
 * @param {Object} [calendar] getStudyCalendar() 결과
 * @param {Date} [today] 기준일 (테스트 주입용)
 * @returns {{weekTarget:number, weekActual:number, percent:number, status:string}|null}
 *   status: 'met' ≥100% · 'ontrack' ≥50% · 'behind' <50% · 'done' 잔여 0
 */
export function computePlanAdherence(plan, calendar, today = new Date()) {
    if (!plan) return null;
    if (plan.remaining === 0) return { weekTarget: 0, weekActual: 0, percent: 100, status: 'done' };
    const weekTarget = plan.weeks.length ? plan.weeks[0].cards : plan.weeklyCards;
    const weekActual = sumRecentCards(calendar || getStudyCalendar(), 7, today);
    const percent = weekTarget > 0 ? Math.round(weekActual / weekTarget * 100) : 100;
    const status = percent >= 100 ? 'met' : percent >= 50 ? 'ontrack' : 'behind';
    return { weekTarget, weekActual, percent, status };
}

/** 이번 주 월요일 날짜 문자열 — 주간 마일스톤 id용 (주 단위 재발화 허용) */
function _weekStartStr(today = new Date()) {
    const d = new Date(today);
    const dow = d.getDay();
    d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    return _localDateStr(d);
}

/**
 * 학습 마일스톤 평가 (SC-07) — 아직 안내하지 않은 마일스톤 목록 반환.
 * D-day 임계는 긴급한 것부터, 진도 경유는 높은 것부터 정렬된다.
 * @param {Object} p
 * @param {number|null} p.dday getDDay() 결과
 * @param {Object|null} p.adherence computePlanAdherence() 결과
 * @param {number} [p.progressPercent] 전체 카드 암기율 (0~100)
 * @param {string} [p.weekId] 이번 주 식별자 (기본: 이번 주 월요일)
 * @param {Array<string>} [seen] 이미 안내한 마일스톤 id
 * @returns {Array<{id:string, msg:string, tone:string}>}
 */
export function evalStudyMilestones(p, seen = []) {
    const out = [];
    const has = (id) => seen.includes(id);
    const d = p.dday;
    if (typeof d === 'number' && d >= 0) {
        if (d === 0 && !has('d0')) out.push({ id: 'd0', msg: '시험 당일입니다 — 그동안의 학습을 믿고 임하세요.', tone: 'success' });
        if (d <= 1 && !has('d1')) out.push({ id: 'd1', msg: '시험이 내일입니다 — 가볍게 복습하고 컨디션을 챙기세요.', tone: 'info' });
        if (d <= 7 && !has('d7')) out.push({ id: 'd7', msg: '시험까지 1주 — 신규 학습보다 복습·모의고사 비중을 높이세요.', tone: 'warning' });
        if (d <= 14 && !has('d14')) out.push({ id: 'd14', msg: '시험까지 2주 — 카드·퀴즈 병행과 약점 집중이 필요한 시점입니다.', tone: 'warning' });
        if (d <= 30 && !has('d30')) out.push({ id: 'd30', msg: '시험까지 한 달 — 학습 계획표를 확인하고 페이스를 점검하세요.', tone: 'info' });
    }
    const a = p.adherence;
    if (a && a.status === 'met' && p.weekId && !has(`wk-${p.weekId}`)) {
        out.push({ id: `wk-${p.weekId}`, msg: `이번 주 계획 달성 — 주간 카드 ${a.weekActual}장. 이 페이스를 유지하세요.`, tone: 'success' });
    }
    const pg = p.progressPercent;
    if (typeof pg === 'number') {
        if (pg >= 75 && !has('p75')) out.push({ id: 'p75', msg: '전체 카드 75% 돌파 — 마무리 구간입니다.', tone: 'success' });
        else if (pg >= 50 && !has('p50')) out.push({ id: 'p50', msg: '전체 카드 절반 돌파 — 후반부도 같은 페이스로 진행하세요.', tone: 'success' });
    }
    return out;
}

function _getSeenMilestones() {
    try {
        const list = JSON.parse(safeGetItem(STORAGE_KEYS.STUDY_MILESTONES_SEEN) || '[]');
        return Array.isArray(list) ? list : [];
    } catch (e) {
        return [];
    }
}

/**
 * 학습 마일스톤 안내 (SC-07) — 새로 도달한 마일스톤을 최대 limit개 반환하고
 * 반환한 것만 안내 이력에 기록한다 (미표시분은 다음 호출에 재평가).
 * @param {Object} [opts]
 * @param {number} [opts.remaining] 남은 카드 수 (계획 준수 계산용)
 * @param {number} [opts.total] 전체 카드 수 (진도 경유 계산용)
 * @param {number} [opts.limit] 최대 반환 수
 * @returns {Array<{id:string, msg:string, tone:string}>}
 */
export function checkStudyMilestones({ remaining = 0, total = 0, limit = 2 } = {}) {
    const seen = _getSeenMilestones();
    const plan = computeStudyPlan(remaining);
    const progressPercent = total > 0 ? Math.round(Math.max(0, total - remaining) / total * 100) : 0;
    const fresh = evalStudyMilestones({
        dday: getDDay(),
        adherence: computePlanAdherence(plan),
        progressPercent,
        weekId: _weekStartStr()
    }, seen);
    const shown = fresh.slice(0, limit);
    if (shown.length) {
        safeSetItem(STORAGE_KEYS.STUDY_MILESTONES_SEEN,
            JSON.stringify(seen.concat(shown.map(m => m.id)).slice(-100)));
    }
    return shown;
}

/* =======================================================
   📚 과목별 가중 배분 (SC-08 — study_plan_pro)
   ======================================================= */

/** 약점 가중 최소 퀴즈 표본 — 미만이면 중립 가중 1.0 (가짜 정밀도 방지) */
export const MIN_ALLOC_SAMPLE = 20;

/** 약점 가중 상한 — 퀴즈 정답률 + 취약 카드 가산의 합계 상한 (SC-09) */
export const MAX_WEAK_WEIGHT = 2.5;

/** 최근 퀴즈 표본 윈도우 — 과목당 최근 N문만 약점 가중에 반영 (SC-09) */
export const RECENT_QUIZ_WINDOW = 60;

/**
 * 과목별 최근 퀴즈 표본 (SC-09) — quizResults를 뒤(최신)에서 읽어
 * 과목당 최근 RECENT_QUIZ_WINDOW문까지만 집계한다. 전 기간 누적 정답률 대신
 * 현재 약점에 가까운 최근 성적을 약점 가중에 반영하기 위한 윈도우.
 * @param {Object} quizResults state.quizResults — {quizId: {solved, correct}}
 * @param {number} [limit] 과목당 표본 상한
 * @returns {Object} {subjKey: {solved, correct}}
 */
export function recentQuizBySubject(quizResults, limit = RECENT_QUIZ_WINDOW) {
    const out = {};
    const entries = Object.entries(quizResults || {});
    for (let i = entries.length - 1; i >= 0; i--) {
        const k = subjectKeyFromItemId(entries[i][0]);
        if (!k) continue;
        const o = out[k] = out[k] || { solved: 0, correct: 0 };
        if (o.solved >= limit) continue;
        o.solved++;
        if (entries[i][1] && entries[i][1].correct) o.correct++;
    }
    return out;
}

/**
 * 한 주 총량을 과목별 수요 비례로 배분 — 워터필링(잔여 상한 + 초과 재배분).
 * @param {Array} rows {remaining, weakW, weight} 과목 행
 * @param {Array<number>} remNow 주차 누적 기준 현재 잔여 (in-place 감소)
 * @param {number} total 이번 주 배정 총량
 */
function _allocWeek(rows, remNow, total) {
    const alloc = rows.map(() => 0);
    let pool = Math.max(0, total);
    for (let iter = 0; iter < rows.length && pool > 0; iter++) {
        const cand = rows.map((r, i) => {
            const cap = remNow[i] - alloc[i];
            return { i, cap, demand: cap > 0 ? cap * r.weight * r.weakW : 0 };
        }).filter(c => c.cap > 0);
        if (!cand.length) break;
        let dsum = cand.reduce((s, c) => s + c.demand, 0);
        // 수요가 전부 0(비중 미선언·잔여만 존재)이면 잔여 비례로 폴백
        if (dsum === 0) { cand.forEach(c => { c.demand = c.cap; }); dsum = cand.reduce((s, c) => s + c.demand, 0); }
        let consumed = 0;
        cand.forEach(c => {
            const give = Math.min(c.cap, Math.floor(pool * c.demand / dsum));
            alloc[c.i] += give;
            consumed += give;
        });
        pool -= consumed;
        if (consumed === 0) {
            // 모든 몫이 0이면 pool < 후보 수 — 잔량을 순환 배분해 교착 해소
            for (const c of cand) {
                if (pool <= 0) break;
                alloc[c.i] += 1;
                pool -= 1;
            }
        }
    }
    return alloc;
}

/**
 * 과목별 가중 배분 계획 (SC-08·SC-09) — 주차 총량을
 *   수요_i = 잔여_i × 출제비중_i × 약점가중_i   비례로 배분한다.
 * 약점가중 = 퀴즈 표본 ≥ MIN_ALLOC_SAMPLE 이면 (2 − 정답률) [1.0~2.0], 미만이면 1.0.
 *   최근 표본(`recentQuizBySubject`)이 임계 이상이면 누적 대신 우선 적용하고,
 *   취약 카드 비율(헷갈림 표시 ÷ 잔여)을 최대 +0.5 가산한다 — 상한 MAX_WEAK_WEIGHT.
 * 주차를 순차 배정해 과목 조기 완료가 다음 주 배분에 자동 반영된다.
 * @param {Object|null} plan computeStudyPlan() 결과
 * @param {Array} subjects 과목 메타 — [{key, name, stats:{cards, targetCards?}}]
 * @param {Object} [opts]
 * @param {Object} [opts.memBySubject] {key: 암기 카드 수}
 * @param {Object} [opts.quizBySubject] {key: {solved, correct}} — 전 기간 누적
 * @param {Object} [opts.recentQuizBySubject] {key: {solved, correct}} — 최근 윈도우 (SC-09)
 * @param {Object} [opts.weakBySubject] {key: 취약 카드 수} — 약점 가산 (SC-09)
 * @param {Object} [opts.weightBySubject] {key: 출제 문항 수} — 미선언 시 균등
 * @returns {Object|null}
 *   { weeks:[{week, range, total, alloc:[{key, name, cards, remaining, weakW, weightPct, weakBadge}]}],
 *     thisWeek, hasWeights }
 */
export function computeSubjectAllocation(plan, subjects, opts = {}) {
    if (!plan || !plan.weeks || !plan.weeks.length) return null;
    const list = (subjects || []).filter(s => s && s.key);
    if (!list.length) return null;
    const mem = opts.memBySubject || {};
    const quiz = opts.quizBySubject || {};
    const recent = opts.recentQuizBySubject || {};
    const weak = opts.weakBySubject || {};
    const wBySubj = opts.weightBySubject || {};
    const hasWeights = Object.keys(wBySubj).length > 0;
    const weightSum = Object.values(wBySubj).reduce((s, n) => s + (n || 0), 0);
    const rows = list.map(s => {
        const stats = (s && s.stats) || {};
        const total = stats.targetCards > 0 ? Math.min(stats.cards || 0, stats.targetCards) : (stats.cards || 0);
        const remaining = Math.max(0, total - (mem[s.key] || 0));
        // 최근 표본이 임계 이상이면 우선, 아니면 누적 표본 폴백
        const rq = recent[s.key] || { solved: 0, correct: 0 };
        const q = (rq.solved >= MIN_ALLOC_SAMPLE) ? rq : (quiz[s.key] || { solved: 0, correct: 0 });
        const quizW = (q.solved >= MIN_ALLOC_SAMPLE && q.solved > 0)
            ? Math.max(0.1, 2 - q.correct / q.solved) : 1.0;
        // 취약 카드 비율 가산 — 헷갈림 표시 카드가 잔여에서 차지하는 비중, 최대 +0.5
        const weakBoost = remaining > 0 ? Math.min(0.5, (weak[s.key] || 0) / remaining) : 0;
        const weight = hasWeights ? (wBySubj[s.key] || 0) : 1;
        return {
            key: s.key,
            name: s.name || s.key,
            remaining,
            weight,
            weightPct: (hasWeights && weightSum > 0) ? Math.round(weight / weightSum * 100) : 0,
            weakW: Math.min(MAX_WEAK_WEIGHT, quizW + weakBoost),
            weakBadge: quizW > 1.15 || weakBoost >= 0.25
        };
    });
    const remNow = rows.map(r => r.remaining);
    const weeks = plan.weeks.map(w => {
        const counts = _allocWeek(rows, remNow, w.cards);
        counts.forEach((c, i) => { remNow[i] -= c; });
        return {
            week: w.week,
            range: w.range,
            total: w.cards,
            alloc: rows.map((r, i) => ({
                key: r.key, name: r.name, cards: counts[i], remaining: r.remaining,
                weakW: r.weakW, weightPct: r.weightPct, weakBadge: r.weakBadge
            }))
        };
    });
    return { weeks, thisWeek: weeks[0], hasWeights };
}
