// src/views/analysis-view.js — 맞춤학습(개인화 분석) 뷰 컨트롤러
// @spec AN-01~09,SC-11,SC-12
//
// dashboard.js에서 분리 (모듈 경계 정리) — 맞춤학습 뷰의 진단 카드 7종,
// 과목별 학습 진입(startSubject*), 주간 리포트보내기를 전담한다.
// 과목 카드·히트맵·모의고사 차트의 DOM 요소는 대시보드 뷰와 공유한다
// (renderDashboard가 ID 기준으로 채우므로 그대로 재사용).

import { state } from '../state.js';
import { esc } from '../sanitize.js';
import { DataLoader } from '../data-loader.js';
import { switchView } from './navigation.js';
import { getDueCount, getDueCards } from '../spaced-repetition.js';
import { computeWrongCauseSummary, getWrongCauseLabels, getSimHistory } from '../recommendations.js';
import {
    getDDay, getStudyGoals, getTodayGoalProgress, getWeeklyGoalProgress,
    getStudyCalendar, computeStudyPlan, computePlanAdherence,
    computeSubjectAllocation, computeSubjectAllocInputs,
    sumRecentCardsBySubject, sumRecentQuizzesBySubject
} from '../study-tracker.js';
import { getWeakStatements, getDueStatementSids, getAnomalousStatements, getAllStatementStats } from '../statement-tracker.js';
import {
    computeSubjectWeakChapters, computeWeeklyGrowth, computePassGap,
    computeWeakConceptClusters, computePaceProjection, estimateUntaggedCauses,
    computeStudyPattern, buildWeeklyReportText
} from '../analysis-engine.js';
import { resolveWrongQuiz } from '../weak-items.js';
import { showToast, showGlobalLoading, hideGlobalLoading } from '../ui-utils.js';
import { getExamRules, getExamAppName } from '../exam-context.js';
import { trackAction } from '../usage-stats.js';
import { renderDashboard, onAnalysisRefresh } from './dashboard.js';
import { getSubjCounts, displayCounts } from './subject-stats.js';
import { compositeEstimate } from './score-estimate.js';

/**
 * 맞춤학습 뷰 렌더링 — renderDashboard()가 과목 카드·히트맵·차트를
 * 채운 뒤, 이 뷰 전용 진단 요약 카드 3종을 추가로 렌더링한다.
 */
export function renderAnalysisView() {
    renderDashboard();
    _renderAnalysisOnboarding();
    _renderSmartPlanInsight();
    _renderWrongCauseInsight();
    _renderWeakStatementInsight();
    _renderStudyRhythmInsight();
    _renderChapterWeakness();
    _renderPassGapInsight();
}

// 백그라운드 통계 갱신 시 분석 뷰도 함께 갱신 — dashboard.js의 onAnalysisRefresh 훅
// (양방향 import 대신 콜백 등록으로 모듈 순환을 피한다)
onAnalysisRefresh(_renderChapterWeakness);

/** 과목별 취약 단원 그룹 공용 계산 — 단원 카드·스마트학습 배분·리포트가 공유 (SC-11·SC-12) */
function _weakChapterGroups(chaptersPerSubject = 2) {
    const qc = (DataLoader._questionChapters) || { questions: {}, ranges: {} };
    const subjectsMeta = (typeof DataLoader !== 'undefined' && DataLoader.registry)
        ? DataLoader.getSubjectList() : [];
    const nameOf = (key) => { const s = subjectsMeta.find(x => x.key === key); return s ? s.name : key; };
    return computeSubjectWeakChapters({
        quizResults: state.quizResults, weakCards: state.weakCards,
        statementStats: getAllStatementStats(),
        questionChapters: qc.questions, chapterRanges: qc.ranges,
        resolveQuiz: resolveWrongQuiz, subjectName: nameOf, chaptersPerSubject
    });
}

/** 스마트학습 배분 입력 공용 집계 — 분석 카드·리포트가 캘린더 칩과 동일 입력 공유 (SC-11·SC-12) */
function _allocInputs() {
    return computeSubjectAllocInputs({
        memorizedCards: state.memorizedCards,
        quizResults: state.quizResults,
        weakCards: state.weakCards,
        exams: (DataLoader.registry && DataLoader.registry.exams) || [],
        wrongCauses: state.wrongCauses,
        dueCardIds: getDueCards(),
        weakChapterGroups: _weakChapterGroups()
    });
}

/**
 * 이번 주 스마트학습 카드 (SC-11) — 캘린더 계획 패널의 과목별 배분을
 * 맞춤학습 뷰에 요약 표시 (진단 → 실행 연결). 시험일 미설정 시 설정 유도.
 */
function _renderSmartPlanInsight() {
    const el = document.getElementById('analysis-smart-plan');
    if (!el) return;
    const subjectsMeta = (typeof DataLoader !== 'undefined' && DataLoader.registry)
        ? DataLoader.getSubjectList()
        : Object.keys(window.STUDY_DATA || {}).map(key => {
            const d = (window.STUDY_DATA || {})[key];
            return { key, name: d.name, stats: { cards: (d.cards || []).length, quizzes: (d.quizzes || []).length } };
        });
    const totalCards = subjectsMeta.reduce((s, m) => s + displayCounts(m).cards, 0);
    const plan = computeStudyPlan(Math.max(0, totalCards - state.memorizedCards.size));
    const alloc = plan && plan.tier !== 'done' ? computeSubjectAllocation(plan, subjectsMeta, _allocInputs()) : null;
    if (!alloc) {
        el.innerHTML = `<h4>🧠 이번 주 스마트학습 <span class="pro-badge" data-pro-feature="study_plan_pro">PRO</span></h4>
            <p class="analysis-empty">시험일을 설정하면 출제 비중과 약점 가중으로 과목별 주간 목표를 배분해 보여줍니다.</p>
            <button class="btn btn-primary btn-sm analysis-card-btn" data-click="openGoalSettings"><i class="fa-solid fa-gear" aria-hidden="true"></i> 시험일·목표 설정</button>`;
        return;
    }
    const doneBySubj = sumRecentCardsBySubject(getStudyCalendar());
    const quizDoneBySubj = sumRecentQuizzesBySubject(getStudyCalendar());
    const rowsHtml = alloc.thisWeek.alloc.filter(a => a.remaining > 0).map(a => {
        const done = doneBySubj[a.key] || 0;
        const qDone = quizDoneBySubj[a.key] || 0;
        const met = a.cards > 0 && done >= a.cards;
        const quizPart = a.quizzes > 0 ? ` · 퀴즈 ${qDone}/${a.quizzes}문` : '';
        const badgesHtml = (a.weakBadge ? ' <span class="alloc-badge alloc-badge-weak">약점</span>' : '')
            + (alloc.hasWeights && a.weightPct > 0 ? ` <span class="alloc-badge">${a.weightPct}%</span>` : '');
        return `<div class="wc-row"><span>${esc(a.name)}${badgesHtml}</span><strong${met ? ' class="alloc-met"' : ''}>${done}/${a.cards}장${quizPart}</strong></div>`;
    }).join('');
    el.innerHTML = `<h4>🧠 이번 주 스마트학습 <span class="pro-badge" data-pro-feature="study_plan_pro">PRO</span></h4>
        ${rowsHtml}
        <p class="analysis-advice">배정 = 잔여량 × 출제 비중 × 약점 가중(밀린 복습 포함) — 칩의 ⓘ 버튼으로 과목별 근거를 볼 수 있습니다.</p>
        <button class="btn btn-secondary btn-sm analysis-card-btn" data-click="switchView" data-arg="calendar-view"><i class="fa-solid fa-calendar-check" aria-hidden="true"></i> 캘린더 보기</button>`;
}

/**
 * 스마트학습 배정 근거 딥링크 (SC-11) — 맞춤학습 뷰로 전환 후
 * 해당 과목 카드로 스크롤·일시 강조한다.
 */
export function gotoSubjectAnalysis(subjKey) {
    switchView('analysis-view', { scrollTop: true });
    setTimeout(() => {
        const card = document.getElementById(`subj-card-${subjKey}`);
        if (!card) return;
        if (card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('subj-card-flash');
        setTimeout(() => card.classList.remove('subj-card-flash'), 1600);
    }, 60);
}

/**
 * 진단 온보딩 — 데이터가 최소 표본에 못 미칠 때 진행률 카드를 최상단에 표시.
 * 의미 있는 진단에는 최소 퀴즈 10문 또는 모의고사 1회가 필요하다.
 * 표본이 충분해지면 카드는 자동으로 사라진다.
 */
const ANALYSIS_MIN_QUIZ = 10;
const ANALYSIS_MIN_SIM = 1;
function _renderAnalysisOnboarding() {
    const grid = document.querySelector('#analysis-view .analysis-insight-grid');
    if (!grid) return;
    let hint = document.getElementById('analysis-onboarding-hint');
    const counts = getSubjCounts();
    const quizSolved = Object.values(counts).reduce((s, c) => s + (c ? c.quizSolved || 0 : 0), 0);
    const simDone = getSimHistory().length;
    const ready = quizSolved >= ANALYSIS_MIN_QUIZ || simDone >= ANALYSIS_MIN_SIM;
    if (ready) {
        if (hint) hint.remove();
        return;
    }
    const quizPct = Math.min(100, Math.round((quizSolved / ANALYSIS_MIN_QUIZ) * 100));
    const simPct = Math.min(100, Math.round((simDone / ANALYSIS_MIN_SIM) * 100));
    const meter = (label, cur, min, pct) =>
        `<div class="wc-subrow"><span>${label}</span><strong>${cur}/${min}</strong></div>
         <div class="analysis-meter"><div class="analysis-meter-fill" style="width:${pct}%"></div></div>`;
    const html = `<h4>🌱 진단 준비 중</h4>
        <p class="analysis-empty">맞춤학습은 푼 문제가 쌓일수록 정확해집니다 — 아래 중 하나만 채우면 진단이 시작됩니다.</p>
        ${meter(`퀴즈 풀이 (최소 ${ANALYSIS_MIN_QUIZ}문)`, quizSolved, ANALYSIS_MIN_QUIZ, quizPct)}
        ${meter(`모의고사 (최소 ${ANALYSIS_MIN_SIM}회)`, simDone, ANALYSIS_MIN_SIM, simPct)}
        <button class="btn btn-primary btn-sm analysis-card-btn" data-click="startSubjectQuiz"><i class="fa-solid fa-play" aria-hidden="true"></i> 지금 퀴즈 풀기</button>
        <button class="btn btn-secondary btn-sm analysis-card-btn" data-click="startIntegratedMockExam"><i class="fa-solid fa-clock" aria-hidden="true"></i> 모의고사 시작</button>`;
    if (!hint) {
        hint = document.createElement('div');
        hint.id = 'analysis-onboarding-hint';
        hint.className = 'analytics-card';
        grid.prepend(hint);
    }
    hint.innerHTML = html;
}

/** 오답 패턴 분석 카드 — 최근 7일 원인 분포 + 권장 학습법 */
function _renderWrongCauseInsight() {
    const el = document.getElementById('analysis-wrong-cause');
    if (!el) return;
    const sum = computeWrongCauseSummary(state.wrongCauses);
    const goBtn = `<button class="btn btn-secondary btn-sm analysis-card-btn" data-click="switchView" data-arg="review-view"><i class="fa-solid fa-star" aria-hidden="true"></i> 오답 복습으로</button>`;
    if (sum.total === 0) {
        el.innerHTML = `<h4>🧩 오답 패턴 분석</h4>
            <p class="analysis-empty">오답 복습에서 "틀린 이유"를 태그하면 최근 7일의 실수 패턴을 분석합니다.</p>${goBtn}`;
        return;
    }
    const rows = Object.entries(getWrongCauseLabels())
        .map(([k, label]) => `<div class="wc-row"><span>${label}</span><strong>${sum.counts[k] || 0}건</strong></div>`).join('');

    // 미태깅 오답 자동 추정 (태깅 데이터가 희소할 때 보완)
    const est = estimateUntaggedCauses({
        quizResults: state.quizResults,
        wrongCauses: state.wrongCauses,
        resolveQuiz: resolveWrongQuiz
    });
    const estRows = est.estimated > 0
        ? `<p class="analysis-advice">추정 (미태깅 오답 ${est.estimated}건): 암기 부족 ${est.counts.memorize} · 개념 오해 ${est.counts.concept} · 계산 ${est.counts.calc}</p>`
        : '';

    el.innerHTML = `<h4>🧩 오답 패턴 분석 <span class="analysis-meta">최근 7일 · ${sum.total}건</span></h4>
        ${rows}
        <p class="analysis-advice">${esc(sum.advice)}</p>${estRows}${goBtn}`;
}

/** 취약 진술 카드 — 반복 오판 진술 수 + 오늘 복습 대기 + 리뷰 딥링크 */
function _renderWeakStatementInsight() {
    const el = document.getElementById('analysis-weak-statements');
    if (!el) return;
    const weak = getWeakStatements(5);
    const dueCount = getDueStatementSids().length;
    const anomalous = getAnomalousStatements();
    if (weak.length === 0) {
        el.innerHTML = `<h4>🎯 취약 진술 추적</h4>
            <p class="analysis-empty">O/X·ㄱㄴㄷ 조합 드릴을 풀면 반복 오판 진술을 추적해 보여줍니다.</p>
            <button class="btn btn-secondary btn-sm analysis-card-btn" data-click="switchView" data-arg="trainer-view"><i class="fa-solid fa-dumbbell" aria-hidden="true"></i> 훈련소로</button>`;
        return;
    }
    const qc = (DataLoader._questionChapters) || { questions: {}, ranges: {} };
    const rows = weak.slice(0, 3).map(w => {
        const label = w.t ? w.t : w.sid;
        const truthTag = w.truth === true ? ' <span class="analysis-truth">참</span>'
            : w.truth === false ? ' <span class="analysis-truth">거짓</span>' : '';
        return `<div class="wc-row"><span class="analysis-sid">${esc(label)}${truthTag}</span><strong>${w.w}회 오판</strong></div>`;
    }).join('');
    const clusters = computeWeakConceptClusters(getAllStatementStats(), qc.ranges);
    const clusterNote = clusters.length > 0
        ? `<p class="analysis-advice">🔗 같은 개념 구간에서 반복 오판: ${esc(clusters[0].chapter || clusters[0].cid)} (${clusters[0].count}개 진술)</p>` : '';
    const anomalousNote = anomalous.length > 0
        ? `<p class="analysis-advice">⚠️ 반복 오판 진술 ${anomalous.length}개 — 표현 검수가 필요할 수 있습니다.</p>` : '';
    el.innerHTML = `<h4>🎯 취약 진술 추적 <span class="analysis-meta">오늘 복습 대기 ${dueCount}개</span></h4>
        ${rows}${clusterNote}${anomalousNote}
        <button class="btn btn-secondary btn-sm analysis-card-btn" data-click="gotoWeakReview"><i class="fa-solid fa-arrow-right" aria-hidden="true"></i> 취약 리뷰 열기</button>`;
}

/** 학습 리듬 카드 — 오늘 목표·주간 학습일·D-day 요약 + 캘린더 링크 */
function _renderStudyRhythmInsight() {
    const el = document.getElementById('analysis-study-rhythm');
    if (!el) return;
    const today = getTodayGoalProgress();
    const week = getWeeklyGoalProgress();
    const dday = getDDay();
    const ddayLabel = dday === null ? '미설정' : (dday < 0 ? `D+${-dday}` : (dday === 0 ? 'D-Day' : `D-${dday}`));

    // 주간 성장 — 최근 7일 vs 이전 7일
    const growth = computeWeeklyGrowth(getStudyCalendar());
    const growthRow = growth.thisWeek.rate !== null
        ? `<div class="wc-row"><span>주간 정답률</span><strong>${growth.thisWeek.rate}%${growth.rateDelta !== null ? ` <span class="growth-delta ${growth.rateDelta >= 0 ? 'growth-up' : 'growth-down'}">${growth.rateDelta >= 0 ? '▲' : '▼'}${Math.abs(growth.rateDelta)}%p</span>` : ''}</strong></div>`
        : '';

    // 학습 패턴 — 최다 활동 시간대·요일 (캘린더 시간대 버킷 집계, 표본 부족 시 미표시)
    const pattern = computeStudyPattern(getStudyCalendar());
    const patternRow = pattern
        ? `<div class="wc-row"><span>집중 패턴</span><strong>${pattern.topBand ? esc(pattern.topBand.label) : ''}${pattern.topBand && pattern.topDow ? ' · ' : ''}${pattern.topDow ? esc(pattern.topDow.label) : ''}</strong></div>
           <div class="wc-row"><span>주말 학습 비중</span><strong>${pattern.weekendShare}%</strong></div>`
        : '';

    // D-day 페이스 판정 — 현재 속도로 커버 가능한지
    const subjectsMeta = (typeof DataLoader !== 'undefined' && DataLoader.registry)
        ? DataLoader.getSubjectList() : [];
    const totalCards = subjectsMeta.reduce((s, m) => s + displayCounts(m).cards, 0);
    const pace = computePaceProjection({
        calendar: getStudyCalendar(), totalCards,
        memorized: state.memorizedCards.size, dday
    });
    const paceNote = pace
        ? `<p class="analysis-advice">${pace.verdict === 'ahead'
            ? `✅ 현재 페이스면 시험일까지 전체 커버 가능합니다.`
            : pace.verdict === 'ontrack'
                ? `📈 현재 페이스(하루 ${pace.pacePerDay}장)로 약 ${pace.projectedCoverage}% 커버 예상 — 하루 ${pace.neededPerDay}장 목표로 조금만 더.`
                : `⚠️ 현재 페이스로는 ${pace.projectedCoverage}% 커버에 그칩니다 — 하루 ${pace.neededPerDay}장 필요합니다.`}</p>`
        : '';

    el.innerHTML = `<h4>📅 학습 리듬</h4>
        <div class="wc-row"><span>오늘 목표 달성</span><strong>${today.overallPercent}%</strong></div>
        <div class="wc-row"><span>이번 주 학습일</span><strong>${week.studyDays}/${week.goalDays}일</strong></div>
        <div class="wc-row"><span>시험일</span><strong>${ddayLabel}</strong></div>
        ${growthRow}${patternRow}${paceNote}
        <button class="btn btn-secondary btn-sm analysis-card-btn" data-click="switchView" data-arg="calendar-view"><i class="fa-solid fa-calendar-check" aria-hidden="true"></i> 캘린더 보기</button>`;
}

/** 단원별 취약 분석 카드 — 과목별 그룹화 (과락이 과목 단위 평가이므로) */
function _renderChapterWeakness() {
    const el = document.getElementById('analysis-chapter-weak');
    if (!el) return;
    const groups = _weakChapterGroups();
    if (groups.length === 0) {
        el.innerHTML = `<h4>📖 단원별 취약 분석</h4>
            <p class="analysis-empty">퀴즈·모의고사·드릴에서 오답이 쌓이면 과목별로 어떤 단원이 약한지 보여줍니다.</p>`;
        return;
    }
    const html = groups.slice(0, 4).map(g => {
        const chRows = g.chapters.map(c =>
            `<div class="wc-subrow" role="button" tabindex="0" style="cursor:pointer" title="교재에서 이 단원 보기" data-click="openSubjectSection" data-args='${esc(JSON.stringify([g.subjectKey, c.chapter]))}'><span class="analysis-sid">${esc(c.chapter)}</span><span>${c.wrongs}건 <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></span></div>`
        ).join('');
        return `<div class="wc-row wc-subj-row"><span>${esc(g.subject)}</span><strong>${g.totalWrongs}건</strong></div>${chRows}`;
    }).join('');
    el.innerHTML = `<h4>📖 단원별 취약 분석 <span class="analysis-meta">과목별 오답 집중 단원 — 클릭 시 해당 교재 단원으로 이동</span></h4>
        ${html}
        <p class="analysis-advice">과락은 과목 단위 평가 — 각 과목의 최약 단원부터 재학습하면 과락 방어에 효과적입니다.</p>`;
}

/** 합격 갭 분석 카드 — 합격선까지 점수 갭 + 최우선 보강 과목 */
function _renderPassGapInsight() {
    const el = document.getElementById('analysis-pass-gap');
    if (!el) return;
    const subjects = (typeof DataLoader !== 'undefined' && DataLoader.registry)
        ? DataLoader.getSubjectList() : [];
    const gap = computePassGap({
        estimate: compositeEstimate(),
        simHistory: getSimHistory(),
        subjects,
        counts: getSubjCounts(),
        rules: getExamRules()
    });
    if (!gap || (!gap.weakest && gap.gap === null)) {
        el.innerHTML = `<h4>🎓 합격 갭 분석</h4>
            <p class="analysis-empty">모의고사나 퀴즈를 풀면 합격선까지의 거리와 보강 우선순위를 진단합니다.</p>
            <button class="btn btn-secondary btn-sm analysis-card-btn" data-click="startIntegratedMockExam"><i class="fa-solid fa-clock" aria-hidden="true"></i> 모의고사 시작</button>`;
        return;
    }
    const gapRow = gap.gap !== null
        ? `<div class="wc-row"><span>합격선(평균 ${gap.passLine}점)까지</span><strong>${gap.gap === 0 ? '도달 ✅' : `+${gap.gap}점`}</strong></div>`
        : '';
    const weakRow = gap.weakest
        ? `<div class="wc-row"><span>최우선 보강</span><strong class="gap-weakest">${esc(gap.weakest.name)} ${gap.weakest.rate}%</strong></div>`
        : '';
    const weakBtn = gap.weakest
        ? `<button class="btn btn-primary btn-sm analysis-card-btn" data-click="startSubjectQuiz" data-arg="${esc(gap.weakest.key)}"><i class="fa-solid fa-play" aria-hidden="true"></i> ${esc(gap.weakest.name)} 퀴즈</button>`
        : '';
    // SC-14 합격 갭→목표 상향 권고 — 진단 갭을 계획 파라미터 조정 동선으로 연결
    let goalAdviceHtml = '';
    if (gap.gap !== null && gap.gap > 0) {
        const planSubjects = (subjects && subjects.length) ? subjects
            : Object.keys(window.STUDY_DATA || {}).map(k => ({
                key: k, stats: { cards: (((window.STUDY_DATA || {})[k] || {}).cards || []).length }
            }));
        const totalCards2 = planSubjects.reduce((s, m) => s + displayCounts(m).cards, 0);
        const plan = totalCards2 > 0 ? computeStudyPlan(Math.max(0, totalCards2 - state.memorizedCards.size)) : null;
        const goals = getStudyGoals();
        const advice = (plan && plan.tier !== 'done' && plan.perStudyDay > goals.dailyCards)
            ? `예상 점수가 합격선에 미달합니다. 계획 속도를 따라잡으려면 일일 카드 목표를 ${goals.dailyCards}→${plan.perStudyDay}장으로 올리는 것을 권장합니다.`
            : '예상 점수가 합격선에 미달합니다. 일일 목표 또는 주간 학습 일수를 올려 커버 속도를 높이는 것을 권장합니다.';
        goalAdviceHtml = `<p class="analysis-advice">${esc(advice)}</p>
            <button class="btn btn-secondary btn-sm analysis-card-btn" data-click="openGoalSettings"><i class="fa-solid fa-gear" aria-hidden="true"></i> 목표 상향</button>`;
    }
    el.innerHTML = `<h4>🎓 합격 갭 분석</h4>
        ${gapRow}${weakRow}
        ${gap.weakest ? `<p class="analysis-advice">${esc(gap.weakest.reason)} — 이 과목이 점수 상승 여력이 가장 큽니다.</p>` : ''}
        ${weakBtn}${goalAdviceHtml}`;
}

/**
 * 오늘 복습 대상(SM-2 due) 카드만 모아 전 과목 합산 플래시카드 세션을 시작합니다.
 * 대시보드 '오늘 복습' 카드의 '지금 복습' 버튼에서 호출.
 */
export function startDueReview() {
    const n = getDueCount();
    if (n === 0) {
        showToast('오늘 복습할 카드가 없습니다.', 'info');
        return;
    }
    showGlobalLoading('복습 대상 카드를 불러오는 중입니다...');
    Promise.all(DataLoader.getSubjectList().map(s => DataLoader.loadSubject(s.key)))
        .catch(() => {})
        .finally(() => {
            hideGlobalLoading();
            state.flashcards.dueOnly = true;
            state.flashcards.currentIndex = 0;
            switchView('flashcard-view', { scrollTop: true });
            showToast(`오늘 복습 대상 ${n}장 — 간격 반복 세션을 시작합니다`, 'success');
        });
}

/**
 * 특정 과목의 카드 학습을 시작합니다.
 * @param {string} [subjId] 생략 시 활성 시험의 첫 과목
 */
export function startSubjectStudy(subjId) {
    if (!subjId) {
        const subs = DataLoader.getSubjectList();
        subjId = (subs[0] && subs[0].key) || '';
    }
    state.flashcards.subject = subjId;
    state.flashcards.currentIndex = 0;
    const select = /** @type {HTMLSelectElement|null} */ (document.getElementById('fc-subject-select'));
    if (select) select.value = subjId;
    switchView('flashcard-view', { scrollTop: true });
}

/**
 * 특정 과목의 퀴즈 풀기를 시작합니다.
 * @param {string} subjId
 */
export function startSubjectQuiz(subjId) {
    if (!subjId) {
        const subs = DataLoader.getSubjectList();
        subjId = (subs[0] && subs[0].key) || '';
    }
    state.quiz.subject = subjId;
    const select = /** @type {HTMLSelectElement|null} */ (document.getElementById('quiz-subject-select'));
    if (select) select.value = subjId;
    switchView('quiz-view', { scrollTop: true });
    const startQuizBtn = /** @type {HTMLElement|null} */ (document.getElementById('start-quiz-btn'));
    if (startQuizBtn) startQuizBtn.click();
}

/**
 * 특정 과목의 교재 읽기를 시작합니다. (약점 → 교재 딥링크)
 * @param {string} subjId
 */
export function startSubjectReader(subjId) {
    const select = /** @type {HTMLSelectElement|null} */ (document.getElementById('reader-subject-select'));
    if (select) select.value = subjId;
    switchView('textbook-reader-view', { scrollTop: true });
}

// SC-06 주간 리포트용 계획 준수 요약 — {weekActual, weekTarget, percent, statusLabel} | null
function _planAdherenceSummary(subjects) {
    let total = 0;
    (subjects || []).forEach(s => { total += displayCounts(s).cards; });
    const plan = computeStudyPlan(Math.max(0, total - state.memorizedCards.size));
    const adh = computePlanAdherence(plan);
    if (!adh || adh.status === 'done') return null;
    const statusLabel = { met: '달성', ontrack: '추적 중', behind: '부족' }[adh.status];
    return { weekActual: adh.weekActual, weekTarget: adh.weekTarget, percent: adh.percent, statusLabel };
}

/**
 * 주간 학습 리포트 공유 — 진단 요약을 평문으로 생성해
 * Web Share API(모바일) 또는 클립보드로보낸다. (data-click)
 */
export function exportAnalysisReport() {
    trackAction('analysis_report');
    const subjects = (typeof DataLoader !== 'undefined' && DataLoader.registry)
        ? DataLoader.getSubjectList() : [];
    const nameOf = (k) => { const s = subjects.find(x => x.key === k); return s ? s.name : k; };
    const dday = getDDay();
    const qc = (DataLoader._questionChapters) || { questions: {}, ranges: {} };
    const est = compositeEstimate();
    // 스마트학습 과목별 준수 (SC-11) — 배분이 없으면(시험일 미설정·완료) null
    const totalCards = subjects.reduce((s, m) => s + displayCounts(m).cards, 0);
    const weekPlan = computeStudyPlan(Math.max(0, totalCards - state.memorizedCards.size));
    const weekAlloc = weekPlan && weekPlan.tier !== 'done'
        ? computeSubjectAllocation(weekPlan, subjects, _allocInputs()) : null;
    const doneBySubj = weekAlloc ? sumRecentCardsBySubject(getStudyCalendar()) : {};
    const quizDoneBySubj = weekAlloc ? sumRecentQuizzesBySubject(getStudyCalendar()) : {};
    const planBySubject = weekAlloc
        ? weekAlloc.thisWeek.alloc
            .filter(a => a.remaining > 0 && a.cards > 0)
            .map(a => ({ name: a.name, done: doneBySubj[a.key] || 0, cards: a.cards, quizDone: quizDoneBySubj[a.key] || 0, quizzes: a.quizzes || 0 }))
        : null;
    const text = buildWeeklyReportText({
        appName: getExamAppName(),
        plan: _planAdherenceSummary(subjects),
        planBySubject,
        growth: computeWeeklyGrowth(getStudyCalendar()),
        estimate: est,
        gap: computePassGap({
            estimate: est, simHistory: getSimHistory(), subjects,
            counts: getSubjCounts(), rules: getExamRules()
        }),
        weakChapters: computeSubjectWeakChapters({
            quizResults: state.quizResults, weakCards: state.weakCards,
            statementStats: getAllStatementStats(),
            questionChapters: qc.questions, chapterRanges: qc.ranges,
            resolveQuiz: resolveWrongQuiz, subjectName: nameOf, chaptersPerSubject: 1
        }),
        pattern: computeStudyPattern(getStudyCalendar()),
        ddayLabel: dday === null ? null : (dday < 0 ? `D+${-dday}` : (dday === 0 ? 'D-Day' : `D-${dday}`))
    });
    if (navigator.share) {
        navigator.share({ title: `${getExamAppName()} 주간 학습 리포트`, text })
            .then(() => {})
            .catch(() => {});
        return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
            .then(() => showToast('주간 리포트를 클립보드에 복사했습니다.', 'success'))
            .catch(() => showToast('리포트 복사에 실패했습니다.', 'error'));
        return;
    }
    showToast('이 환경에서는 리포트보내기를 지원하지 않습니다.', 'warning');
}
