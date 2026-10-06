// src/views/dashboard.js - 대시보드 뷰 로직 및 전역 통계 관리
// @spec D-01~17,PF-07,SC-04,SC-06,SC-07,SC-10
import { state } from '../state.js';
import { esc } from '../sanitize.js';
import { DataLoader } from '../data-loader.js';
import { renderPerformanceChart, renderPassFailDiagnosis, renderRadarChart } from '../charts.js';
import { updateStreakAndDailyUI } from './daily-challenge.js';
import { updatePomodoroUI } from './pomodoro.js';
import { getDueCount } from '../spaced-repetition.js';
import {
    computeRecommendations,
    snapshotRecommendations, evaluateRecommendationEffect
} from '../recommendations.js';
import { getDDay, getExamPlanStatus, checkStudyMilestones } from '../study-tracker.js';
import { getAllStatementStats } from '../statement-tracker.js';
import { computeMasteryLevels } from '../analysis-engine.js';
import { showToast } from '../ui-utils.js';
import { getSubjCounts, displayCounts } from './subject-stats.js';
import { renderExpectedScore } from './score-estimate.js';

/**
 * @type {boolean}
 */
let _dashboardStatsRefreshed = false;

// 분석 뷰 갱신 콜백 — analysis-view.js가 등록 (양방향 import 없이 모듈 순환 회피)
let _analysisRefreshHandler = null;
/** @param {Function} fn */
export function onAnalysisRefresh(fn) { _analysisRefreshHandler = fn; }

/**
 * 전역 학습 통계 데이터를 집계하고 UI 요소를 업데이트합니다.
 */
export function updateGlobalStats() {
    // 1. 전체 카드 통계
    let totalCards = 0;
    if (typeof DataLoader !== 'undefined' && DataLoader.registry) {
        DataLoader.getSubjectList().forEach(subj => {
            totalCards += displayCounts(subj).cards;
        });
    } else if (typeof window.STUDY_DATA !== 'undefined' && window.STUDY_DATA) {
        const sd = window.STUDY_DATA;
        Object.keys(sd).forEach(subj => {
            totalCards += sd[subj].cards.length;
        });
    }

    const totalCardsEl = document.getElementById('total-cards-count');
    const memorizedCardsEl = document.getElementById('memorized-cards-count');
    const weakCardsEl = document.getElementById('weak-cards-count');
    const reviewCardEl = document.getElementById('review-card-count');
    const totalProgressValEl = document.getElementById('total-progress-val');
    const totalProgressBarEl = document.getElementById('total-progress-bar');
    const solvedQuizzesEl = document.getElementById('solved-quizzes-count');
    const successRateEl = document.getElementById('quiz-success-rate');

    if (totalCardsEl) totalCardsEl.textContent = String(totalCards);
    if (memorizedCardsEl) memorizedCardsEl.textContent = String(state.memorizedCards.size);
    if (weakCardsEl) weakCardsEl.textContent = String(state.weakCards.size);
    if (reviewCardEl) reviewCardEl.textContent = String(state.weakCards.size);

    // 2. 간격 반복 — 오늘 복습 대기 카드 수 + 대기 중일 때 '지금 복습' CTA
    const dueCount = getDueCount();
    const dueReviewEl = document.getElementById('due-review-count');
    if (dueReviewEl) dueReviewEl.textContent = String(dueCount);
    document.getElementById('due-review-cta')?.classList.toggle('is-hidden', dueCount === 0);

    // 2-b. 시험일 D-day + 역산 권장량 표시
    const ddayEl = document.getElementById('exam-dday-count');
    if (ddayEl) {
        const dday = getDDay();
        // SC-10 시험일 미설정 — 학습 계획의 시작점이므로 카드 주의 강조
        ddayEl.closest('.stat-card')?.classList.toggle('stat-card-attn', dday === null);
        if (dday === null) {
            ddayEl.textContent = '미설정';
        } else if (dday < 0) {
            ddayEl.textContent = `D+${-dday}`;
        } else {
            ddayEl.textContent = dday === 0 ? 'D-Day' : `D-${dday}`;
        }
        const descEl = ddayEl.closest('.stat-info')?.querySelector('.stat-desc');
        if (descEl) {
            const remaining = Math.max(0, totalCards - state.memorizedCards.size);
            descEl.innerHTML = _examPlanDescHtml(getExamPlanStatus(remaining));
        }
    }

    // SC-07 학습 마일스톤 — 새로 도달한 임계점을 1회성 토스트로 안내
    checkStudyMilestones({
        remaining: Math.max(0, totalCards - state.memorizedCards.size),
        total: totalCards, limit: 2
    }).forEach(m => showToast(m.msg, m.tone));

    // 전체 진척도 퍼센트 계산
    const totalProgress = totalCards > 0 ? Math.round((state.memorizedCards.size / totalCards) * 100) : 0;
    if (totalProgressValEl) totalProgressValEl.textContent = `${totalProgress}%`;
    if (totalProgressBarEl) totalProgressBarEl.style.width = `${totalProgress}%`;

    // 2. 퀴즈 통계
    const quizKeys = Object.keys(state.quizResults);
    const solvedCount = quizKeys.length;
    const correctCount = quizKeys.filter(k => state.quizResults[k].correct).length;
    const successRate = solvedCount > 0 ? Math.round((correctCount / solvedCount) * 100) : 0;

    if (solvedQuizzesEl) solvedQuizzesEl.textContent = String(solvedCount);
    if (successRateEl) successRateEl.textContent = `${successRate}%`;
}

// D-17·SC-10 D-day 카드 설명 — 미설정: 최우선 설정 안내 / 계획 등급(tight: 병행 권장 / triage: 비중 큰 과목 우선) 분기
function _examPlanDescHtml(plan) {
    const openBtn = (label) => `<button type="button" class="dday-set-btn" data-click="openGoalSettings"><i class="fa-solid fa-gear"></i> ${label}</button>`;
    if (!plan) {
        return `<span class="dday-guide">학습 계획의 시작점 — 시험일을 설정하면 역산 계획·주간 목표·스마트학습 배분이 생성됩니다.</span> ${openBtn('지금 설정')}`;
    }
    if (plan.suggested === null) return openBtn('시험일·목표 설정');
    const topName = plan.tier === 'triage' ? _topWeightSubjectName() : null;
    const advice = {
        tight: ' — 일일 목표 초과, 카드·퀴즈 병행 권장',
        triage: ` — 전량 커버 어려움, ${topName ? esc(topName) + ' 등 ' : ''}비중 큰 과목 우선 권장`
    }[plan.tier] || '';
    return `역산 권장: 하루 카드 ${plan.suggested}장${advice} · ${openBtn('설정')}`;
}

// 출제 문항 수 합계가 가장 큰 과목명 (registry exams 기준 — 없으면 null)
function _topWeightSubjectName() {
    if (typeof DataLoader === 'undefined' || !DataLoader.registry) return null;
    const weights = {};
    (DataLoader.registry.exams || []).forEach(ex => {
        if (ex && ex.subject) weights[ex.subject] = (weights[ex.subject] || 0) + ((ex.stats && ex.stats.questions) || 0);
    });
    const topKey = Object.keys(weights).sort((a, b) => weights[b] - weights[a])[0];
    const subj = topKey && DataLoader.getSubjectList().find(s => s.key === topKey);
    return subj ? (subj.shortName || subj.name) : null;
}

/**
 * 백그라운드에서 과목 데이터를 로드해 상세 통계를 갱신합니다.
 */
export function refreshDashboardStatsInBackground() {
    if (_dashboardStatsRefreshed) return;
    if (typeof DataLoader === 'undefined' || !DataLoader.registry) return;
    _dashboardStatsRefreshed = true;
    const loads = DataLoader.getSubjectList().map(s => DataLoader.loadSubject(s.key).catch(() => null));
    Promise.all(loads).then(() => {
        updateGlobalStats();
        if (state.currentView === 'dashboard-view') renderDashboard();
        if (state.currentView === 'analysis-view') _analysisRefreshHandler?.();
    });
}

/**
 * 대시보드 화면을 렌더링하고 차트 및 진단을 활성화합니다.
 */
export function renderDashboard() {
    const container = document.getElementById('subject-cards-container');
    if (!container) return;
    container.innerHTML = '';

    const subjects = (typeof DataLoader !== 'undefined' && DataLoader.registry)
        ? DataLoader.getSubjectList()
        : Object.keys(window.STUDY_DATA || {}).map(key => { const d = (window.STUDY_DATA || {})[key]; return { key, name: d.name, stats: { cards: d.cards.length, quizzes: d.quizzes.length } }; });

    // D-16 과목별 마스터리 — 진술 졸업 비율을 카드 표시 전 한 번만 집계
    const masteryMap = computeMasteryLevels(getAllStatementStats());

    subjects.forEach(subjMeta => {
        const subjId = subjMeta.key;
        const disp = displayCounts(subjMeta);
        const totalSubjCards = disp.cards;
        const totalSubjQuizzes = disp.quizzes;

        // 과목별 완료된 카드 수 (캐시된 카운트 맵 사용, 표시 목표치 상한)
        const subjCounts = getSubjCounts();
        const sc = subjCounts[subjId] || { mem: 0, weak: 0, quizSolved: 0, quizCorrect: 0 };
        const memorizedSubjCards = Math.min(sc.mem, totalSubjCards);
        const progressPercent = totalSubjCards > 0 ? Math.min(100, Math.round((memorizedSubjCards / totalSubjCards) * 100)) : 0;

        // 과목별 퀴즈 정답률 (캐시된 카운트 맵 사용)
        const solvedSubjCount = sc.quizSolved;
        const correctSubjCount = sc.quizCorrect;
        const quizRate = solvedSubjCount > 0 ? Math.round((correctSubjCount / solvedSubjCount) * 100) : 0;

        // 과목별 헷갈린 카드 수
        const weakSubjCards = sc.weak;

        const cardHTML = `
            <div class="subject-card" id="subj-card-${subjId}">
                <div class="subj-header">
                    <h4>${esc(subjMeta.name)}</h4>
                    <span>카드 ${totalSubjCards}개 / 퀴즈 ${totalSubjQuizzes}개</span>
                </div>
                <div class="subj-stats-summary">
                    <div class="subj-stat-item">
                        <span>암기 카드</span>
                        <strong>${memorizedSubjCards} / ${totalSubjCards}</strong>
                    </div>
                    <div class="subj-stat-item">
                        <span>헷갈린 카드</span>
                        <strong style="${weakSubjCards > 0 ? 'color:var(--color-danger);' : ''}">${weakSubjCards}</strong>
                    </div>
                    <div class="subj-stat-item">
                        <span>퀴즈 정답률</span>
                        <strong>${solvedSubjCount > 0 ? quizRate + '%' : '-'}${solvedSubjCount > 0 ? ' <span style=\"font-size:0.75rem; color:var(--color-text-muted);\">(' + solvedSubjCount + '문)</span>' : ''}</strong>
                    </div>
                    ${masteryMap[subjId] ? `
                    <div class="subj-stat-item">
                        <span>마스터리</span>
                        <strong>Lv.${masteryMap[subjId].level} <span style="font-size:0.75rem; color:var(--color-text-muted);">(졸업 ${masteryMap[subjId].graduated}/${masteryMap[subjId].total})</span></strong>
                    </div>` : ''}
                </div>
                <div class="subj-progress-group">
                    <div class="subj-progress-label">
                        <span>학습 진도율</span>
                        <span>${progressPercent}%</span>
                    </div>
                    <div class="progress-bar-container">
                        <div class="progress-bar" style="width: ${progressPercent}%"></div>
                    </div>
                </div>
                <div class="subj-actions">
                    <button class="btn btn-secondary" data-click="startSubjectStudy" data-arg="${subjId}">
                        <i class="fa-solid fa-layer-group"></i> 카드 학습
                     </button>
                    <button class="btn btn-primary" data-click="startSubjectQuiz" data-arg="${subjId}">
                        <i class="fa-solid fa-play"></i> 퀴즈 풀기
                    </button>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', cardHTML);
    });

    renderPerformanceChart();
    renderPassFailDiagnosis();
    renderExpectedScore();
    renderRadarChart();
    updateStreakAndDailyUI();
    updatePomodoroUI();

    // 4. 학습 통계/분석 강화 — 과목별 정답률 히트맵 + 약점 과목 추천
    _renderSubjectHeatmap(subjects);
    _renderWeakSubjectRecommendation(subjects);
}

// 4. 과목별 정답률 히트맵 렌더링
function _renderSubjectHeatmap(subjects) {
    const heatmapEl = document.getElementById('subject-heatmap');
    if (!heatmapEl) return;
    const subjCounts = getSubjCounts();

    // 색상 (CSS 변수에서 읽기)
    const _style = getComputedStyle(document.documentElement);
    const _c = (v) => _style.getPropertyValue(v).trim();
    const colors = {
        none: _c('--color-text-muted'),
        high: _c('--color-success'),
        mid: _c('--color-caution'),
        low: _c('--color-orange'),
        vlow: _c('--color-danger-dark')
    };

    let html = '<div class="heatmap-grid">';
    subjects.forEach(subj => {
        const sc = subjCounts[subj.key] || { mem: 0, weak: 0, quizSolved: 0, quizCorrect: 0 };
        const rate = sc.quizSolved > 0 ? Math.round((sc.quizCorrect / sc.quizSolved) * 100) : -1;
        let color, label;
        if (rate < 0) { color = colors.none; label = '미응시'; }
        else if (rate >= 80) { color = colors.high; label = rate + '%'; }
        else if (rate >= 60) { color = colors.mid; label = rate + '%'; }
        else if (rate >= 40) { color = colors.low; label = rate + '%'; }
        else { color = colors.vlow; label = rate + '%'; }

        html += `
            <div class="heatmap-cell" title="${esc(subj.name)}: ${rate < 0 ? '미응시' : rate + '% 정답률 (' + sc.quizSolved + '문)'}" style="background:${color};">
                <span class="heatmap-label">${esc(subj.name.substring(0, 6))}</span>
                <span class="heatmap-value">${label}</span>
            </div>
        `;
    });
    html += '</div>';
    heatmapEl.innerHTML = html;
}

// 4. 약점 과목 자동 추천 — "오늘의 합격 전략" (recommendations.js 엔진)
function _renderWeakSubjectRecommendation(subjects) {
    const recEl = document.getElementById('weak-subject-recommendation');
    if (!recEl) return;

    const counts = getSubjCounts();
    const recs = computeRecommendations(subjects, counts);

    if (recs.length === 0) {
        recEl.innerHTML = '<p class="rec-empty">아직 충분한 학습 데이터가 없습니다. 퀴즈를 풀어보세요!</p>';
        return;
    }

    // 추천 효과 추적 — 발행 기준선 기록 + 직전 추천의 개선 평가
    const nameOf = (k) => { const s = subjects.find(x => x.key === k); return s ? s.name : k; };
    const effect = evaluateRecommendationEffect(counts, nameOf);
    snapshotRecommendations(recs, counts);

    let html = '';
    if (effect) {
        const parts = effect.items.map(i =>
            `${esc(i.name)} ${i.fromRate}%→${i.toRate}% (${i.delta >= 0 ? '▲' : '▼'}${Math.abs(i.delta)}%p)`);
        html += `<p class="rec-effect"><i class="fa-solid fa-chart-line" aria-hidden="true"></i> 지난 추천 이후 ${parts.join(' · ')}</p>`;
    }
    html += '<div class="rec-list">';
    recs.forEach(rec => {
        const actions = rec.actions.map(a =>
            `<button class="btn btn-sm ${a.cls}" data-click="${a.click}" data-arg="${esc(a.arg)}"><i class="fa-solid ${a.icon}"></i> ${esc(a.label)}</button>`
        ).join('');
        html += `
            <div class="rec-item">
                <i class="fa-solid ${rec.icon}" style="color:${rec.color};"></i>
                <span class="rec-text"><strong>${esc(rec.title)}</strong><span class="rec-reason">${esc(rec.reason)}</span></span>
                <div class="rec-actions">${actions}</div>
            </div>
        `;
    });
    html += '</div>';
    recEl.innerHTML = html;
}
