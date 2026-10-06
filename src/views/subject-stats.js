// src/views/subject-stats.js — 과목별 진행 통계 집계 공용 헬퍼
// @spec D-01~17
//
// 대시보드(dashboard.js)와 맞춤학습(analysis-view.js)·예상 점수(score-estimate.js)가
// 공유하는 과목 단위 카운트 집계. dashboard.js에서 분리 (모듈 경계 정리).

import { state } from '../state.js';

let _subjCountCache = null;
let _subjCountCacheKey = '';

/** 과목별 {mem, weak, quizSolved, quizCorrect} 집계 — state 세트 변경 시만 재계산 (메모 캐시) */
export function getSubjCounts() {
    const memKey = state.memorizedCards.size + ':' + state.weakCards.size + ':' + Object.keys(state.quizResults).length;
    if (_subjCountCache && _subjCountCacheKey === memKey) return _subjCountCache;
    _subjCountCacheKey = memKey;
    const counts = {};
    state.memorizedCards.forEach(id => {
        const m = id.match(/^([a-z]+)_card_/);
        if (m) counts[m[1]] = counts[m[1]] || { mem: 0, weak: 0, quizSolved: 0, quizCorrect: 0 };
    });
    state.weakCards.forEach(id => {
        const m = id.match(/^([a-z]+)_card_/);
        if (m) { counts[m[1]] = counts[m[1]] || { mem: 0, weak: 0, quizSolved: 0, quizCorrect: 0 }; counts[m[1]].weak++; }
    });
    Object.keys(state.quizResults).forEach(id => {
        const m = id.match(/^([a-z]+)_quiz_/);
        if (m) {
            counts[m[1]] = counts[m[1]] || { mem: 0, weak: 0, quizSolved: 0, quizCorrect: 0 };
            counts[m[1]].quizSolved++;
            if (state.quizResults[id].correct) counts[m[1]].quizCorrect++;
        }
    });
    state.memorizedCards.forEach(id => {
        const m = id.match(/^([a-z]+)_card_/);
        if (m) counts[m[1]].mem++;
    });
    _subjCountCache = counts;
    return counts;
}

/** 문제은행 출제 비중 목표치(targetCards/targetQuizzes)가 있으면 표시 수치를 상한 적용 */
export function displayCounts(subjMeta) {
    const stats = (subjMeta && subjMeta.stats) || {};
    const cards = (stats.targetCards > 0) ? Math.min(stats.cards || 0, stats.targetCards) : (stats.cards || 0);
    const quizzes = (stats.targetQuizzes > 0) ? Math.min(stats.quizzes || 0, stats.targetQuizzes) : (stats.quizzes || 0);
    return { cards, quizzes };
}
