// src/study-tracker.js — 학습 캘린더/목표 추적 헬퍼
// @spec SC-03,D-17
// 학습 활동을 날짜별로 기록하고, 목표 달성률을 계산합니다.
import { safeGetItem, safeSetItem } from './state.js';
import { STORAGE_KEYS } from './storage-keys.js';
import { localDateKey } from './utils.js';

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
 * @param {Object} activity - { cards: 증가할 카드 수, quizzes: 증가할 퀴즈 수, correct: 정답 수 }
 */
export function recordStudyActivity(activity = {}) {
    const today = getTodayStr();
    const cal = getStudyCalendar();
    const entry = cal[today] || { cards: 0, quizzes: 0, correct: 0 };
    if (activity.cards) entry.cards += activity.cards;
    if (activity.quizzes) entry.quizzes += activity.quizzes;
    if (activity.correct) entry.correct += activity.correct;
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
