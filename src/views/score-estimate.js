// src/views/score-estimate.js — 복합 예상 점수 + 실제 시험 결과 자가 보고
// @spec AN-05
//
// dashboard.js에서 분리 (모듈 경계 정리) — 예상 점수 추정·개인 보정·실제 결과
// 기록 UI를 전담. renderDashboard()가 합격 진단 카드 하단을 채울 때 호출한다.
// 점수 "추정치"만 제시한다 — 보정된 합격 확률은 실제 결과 데이터 축적 후 가능.

import { esc } from '../sanitize.js';
import { getDDay } from '../study-tracker.js';
import { showToast } from '../ui-utils.js';
import { getExamRules } from '../exam-context.js';
import {
    estimateCompositeScore, computeCalibrationBias,
    getActualResult, saveActualResult, clearActualResult, getSimHistory
} from '../recommendations.js';
import { computeMasteryLevels } from '../analysis-engine.js';
import { getAllStatementStats } from '../statement-tracker.js';
import { getSubjCounts } from './subject-stats.js';

/**
 * 복합 예상 점수 — 모의고사 이력 + (cold start 시) 마스터리·퀴즈 정답률 병합.
 * @param {number} [biasOverride] 보정치 강제 지정 — 생략 시 실제 결과에서 유도
 *   (0 전달 시 무 보정 — 보고 시점 기준값 산출용)
 */
export function compositeEstimate(biasOverride) {
    const mastery = computeMasteryLevels(getAllStatementStats());
    const mv = Object.values(mastery);
    const counts = getSubjCounts();
    let solved = 0, correct = 0;
    Object.values(counts).forEach(c => { solved += c.quizSolved || 0; correct += c.quizCorrect || 0; });
    const bias = biasOverride !== undefined ? biasOverride : computeCalibrationBias(getActualResult());
    return estimateCompositeScore(getSimHistory(), {
        masteryPercent: mv.length ? Math.round(mv.reduce((s, m) => s + m.percent, 0) / mv.length) : undefined,
        quizRate: solved > 0 ? Math.round((correct / solved) * 100) : undefined,
        quizSolved: solved
    }, bias);
}

const TREND_META = {
    up:   { icon: 'fa-arrow-trend-up',   label: '상승 추세', cls: 'est-up' },
    flat: { icon: 'fa-minus',            label: '보합',     cls: 'est-flat' },
    down: { icon: 'fa-arrow-trend-down', label: '하락 추세', cls: 'est-down' }
};

/** 예상 점수 대·추세·실제 결과 블록을 합격 진단 카드 하단에 렌더링한다 */
export function renderExpectedScore() {
    const area = document.getElementById('prediction-estimate-area');
    if (!area) return;
    const est = compositeEstimate();
    const actual = getActualResult();
    const dday = getDDay();

    let html = '';
    if (est && (est.n >= 2 || est.source !== 'sim')) {
        const t = TREND_META[est.trend];
        const srcNote = est.source === 'sim'
            ? `최근 모의고사 ${est.n}회 기준`
            : est.source === 'blend'
                ? `모의고사 ${est.n}회 + 학습 지표 복합 추정`
                : '마스터리·퀴즈 정답률 기반 추정';
        const biasNote = est.biasApplied
            ? ` · 실제 결과 보정 ${est.biasApplied >= 0 ? '+' : ''}${est.biasApplied}점 적용` : '';
        html += `
            <div class="estimate-row">
                <span class="estimate-label">예상 점수</span>
                <strong class="estimate-score">${est.lo}~${est.hi}점</strong>
                <span class="estimate-trend ${t.cls}">
                    <i class="fa-solid ${t.icon}" aria-hidden="true"></i> ${t.label}
                </span>
            </div>
            <div class="estimate-note">${srcNote} (합격선 평균 ${getExamRules().passAverage}점)${biasNote} — 실제 합격 여부가 아닌 점수 추정치입니다.</div>`;
    }

    // 실제 결과: 기록됨 → 요약 표시 / 시험일 경과 → 입력 폼
    if (actual) {
        const delta = (actual.score !== null && est) ? actual.score - est.expected : null;
        html += `
            <div class="actual-result">
                <span class="actual-badge ${actual.passed ? 'actual-pass' : 'actual-fail'}">
                    ${actual.passed ? '합격' : '불합격'}</span>
                <span>${actual.score !== null ? esc(String(actual.score)) + '점' : '점수 미기입'}
                    ${delta !== null ? ` (예상 대비 ${delta >= 0 ? '+' : ''}${delta}점)` : ''}</span>
                <button type="button" class="btn btn-secondary actual-edit-btn"
                    data-click="editActualExamResult">수정</button>
            </div>`;
    } else if (dday !== null && dday <= 0) {
        html += `
            <div class="actual-form">
                <div class="actual-form-title">실제 시험 결과를 기록하면 예측 정확도가 개선됩니다</div>
                <div class="actual-form-row">
                    <select id="actual-passed-select" class="form-select">
                        <option value="pass">합격</option>
                        <option value="fail">불합격</option>
                    </select>
                    <input id="actual-score-input" type="number" class="form-select"
                        min="0" max="100" placeholder="점수(선택)" aria-label="실제 시험 점수">
                    <button type="button" class="btn btn-primary"
                        data-click="saveActualExamResult">기록</button>
                </div>
            </div>`;
    }
    area.innerHTML = html;
}

/** 실제 시험 결과 저장 (합격/불합격 + 선택 점수) */
export function saveActualExamResult() {
    const sel = /** @type {HTMLSelectElement|null} */ (document.getElementById('actual-passed-select'));
    const inp = /** @type {HTMLInputElement|null} */ (document.getElementById('actual-score-input'));
    if (!sel || !inp) return;
    const raw = inp.value.trim();
    const score = raw === '' ? null : parseInt(raw, 10);
    if (score !== null && (isNaN(score) || score < 0 || score > 100)) {
        showToast('점수는 0~100 사이로 입력해주세요.', 'error');
        return;
    }
    // 무 보정 추정치를 함께 저장 — 다음 추정의 개인 편향(computeCalibrationBias) 산출 기준
    const unbiased = compositeEstimate(0);
    saveActualResult(sel.value === 'pass', score, unbiased ? unbiased.expected : null);
    renderExpectedScore();
}

/** 기록된 실제 결과를 지우고 입력 폼으로 되돌린다 */
export function editActualExamResult() {
    clearActualResult();
    renderExpectedScore();
}
