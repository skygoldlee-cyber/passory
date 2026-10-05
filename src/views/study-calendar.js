// src/views/study-calendar.js — 학습 캘린더/목표 뷰
// @spec SC-01,SC-02,SC-05,SC-06,SC-07,SC-08,SC-09,D-17
import { getStudyCalendar, getStudyGoals, setStudyGoals, getTodayGoalProgress, getWeeklyGoalProgress, getMonthlyStudyDays, getTodayStr, getExamDate, setExamDate, getDDay, getExamLeadStatus, computeStudyPlan, computePlanAdherence, checkStudyMilestones, computeSubjectAllocation, sumRecentCardsBySubject, recentQuizBySubject, MIN_EXAM_LEAD_DAYS } from '../study-tracker.js';
import { proFeatureNotice, refreshProBadges } from '../pro-upgrade.js';
import { trackAction } from '../usage-stats.js';
import { localDateKey } from '../utils.js';
import { showToast } from '../ui-utils.js';
import { STORAGE_KEYS } from '../storage-keys.js';
import { safeGetItem, state } from '../state.js';
import { DataLoader } from '../data-loader.js';
import { switchView } from './navigation.js';
import { esc } from '../sanitize.js';
import { subjectKeyFromItemId } from '../weak-items.js';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const MONTH_NAMES = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

let _currentYear = new Date().getFullYear();
let _currentMonth = new Date().getMonth();

/**
 * 학습 캘린더 뷰 렌더링
 */
export function renderStudyCalendar() {
    const container = document.getElementById('study-calendar-content');
    if (!container) return;

    const todayProgress = getTodayGoalProgress();
    const weeklyProgress = getWeeklyGoalProgress();
    const monthlyDays = getMonthlyStudyDays(_currentYear, _currentMonth);
    const daysInMonth = new Date(_currentYear, _currentMonth + 1, 0).getDate();
    const planHtml = _studyPlanHtml();

    container.innerHTML = `
        <div class="study-calendar-wrapper">
            <!-- 오늘/이번 주 목표 달성률 -->
            <div class="study-goals-summary">
                <div class="goal-card">
                    <div class="goal-card-header">
                        <i class="fa-solid fa-bullseye" aria-hidden="true"></i>
                        <span>오늘 목표</span>
                    </div>
                    <div class="goal-progress-ring" style="--p:${todayProgress.overallPercent}">
                        <span class="goal-percent">${todayProgress.overallPercent}%</span>
                    </div>
                    <div class="goal-detail">
                        <div class="goal-detail-row">
                            <span>카드</span>
                            <strong>${todayProgress.cardsDone} / ${todayProgress.cardsGoal}</strong>
                        </div>
                        <div class="goal-detail-row">
                            <span>퀴즈</span>
                            <strong>${todayProgress.quizzesDone} / ${todayProgress.quizzesGoal}</strong>
                        </div>
                    </div>
                </div>
                <div class="goal-card">
                    <div class="goal-card-header">
                        <i class="fa-solid fa-calendar-week" aria-hidden="true"></i>
                        <span>이번 주 목표</span>
                    </div>
                    <div class="goal-progress-ring" style="--p:${weeklyProgress.percent}">
                        <span class="goal-percent">${weeklyProgress.percent}%</span>
                    </div>
                    <div class="goal-detail">
                        <div class="goal-detail-row">
                            <span>학습 일수</span>
                            <strong>${weeklyProgress.studyDays} / ${weeklyProgress.goalDays}일</strong>
                        </div>
                    </div>
                </div>
                <div class="goal-card">
                    <div class="goal-card-header">
                        <i class="fa-solid fa-calendar-days" aria-hidden="true"></i>
                        <span>이번 달</span>
                    </div>
                    <div class="goal-progress-ring" style="--p:${Math.min(100, Math.round(monthlyDays / daysInMonth * 100))}">
                        <span class="goal-percent">${monthlyDays}일</span>
                    </div>
                    <div class="goal-detail">
                        <div class="goal-detail-row">
                            <span>연속 학습</span>
                            <strong>${safeGetItem(STORAGE_KEYS.STUDY_STREAK) || 0}일</strong>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 목표 설정 버튼 + D-day -->
            <div class="goal-settings-row">
                <button class="btn btn-secondary btn-sm" data-click="openGoalSettings">
                    <i class="fa-solid fa-sliders" aria-hidden="true"></i> 목표 설정
                </button>
                ${_ddayChipHtml()}
            </div>

            <!-- SC-05 학습 계획 패널 (시험일 설정 시) -->
            ${planHtml}

            <!-- 월별 캘린더 -->
            <div class="calendar-nav">
                <button class="btn btn-secondary btn-sm" data-click="prevCalendarMonth" title="이전 달" aria-label="이전 달">
                    <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
                </button>
                <h3 class="calendar-title">${_currentYear}년 ${MONTH_NAMES[_currentMonth]}</h3>
                <button class="btn btn-secondary btn-sm" data-click="nextCalendarMonth" title="다음 달" aria-label="다음 달">
                    <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
                </button>
            </div>

            <div class="calendar-grid">
                ${WEEKDAYS.map(d => `<div class="calendar-weekday">${d}</div>`).join('')}
                ${_renderCalendarDays()}
            </div>

            <!-- 범례 -->
            <div class="calendar-legend">
                <div class="legend-item">
                    <span class="legend-dot legend-studied"></span> 학습함
                </div>
                <div class="legend-item">
                    <span class="legend-dot legend-today"></span> 오늘
                </div>
                <div class="legend-item">
                    <span class="legend-dot legend-empty"></span> 미학습
                </div>
            </div>
        </div>
    `;

    // SC-08 과목별 배분 — Pro 표기 배지·1회 안내 + 매트릭스 사용 계측
    const allocDetail = /** @type {HTMLDetailsElement|null} */ (container.querySelector('.plan-alloc-detail'));
    if (container.querySelector('.plan-alloc')) {
        refreshProBadges(container);
        proFeatureNotice('study_plan_pro', '스마트학습');
    }
    if (allocDetail) {
        allocDetail.addEventListener('toggle', () => {
            if (allocDetail.open) trackAction('study_plan_pro');
        });
    }

    // SC-07 학습 마일스톤 — 새로 도달한 임계점을 1회성 토스트로 안내
    _showStudyMilestones();
}

/** SC-07 마일스톤 안내 표시 — seen 세트로 중복 억제, 한 번에 최대 2건 */
function _showStudyMilestones() {
    const remaining = _remainingCards();
    const total = remaining + (state.memorizedCards ? state.memorizedCards.size : 0);
    checkStudyMilestones({ remaining, total, limit: 2 }).forEach(m => showToast(m.msg, m.tone));
}

function _ddayChipHtml() {
    const dday = getDDay();
    if (dday === null) return '';
    const label = dday === 0 ? 'D-Day' : (dday < 0 ? `D+${-dday}` : `D-${dday}`);
    const cls = dday <= 7 ? 'dday-chip dday-urgent' : 'dday-chip';
    return `<span class="${cls}" title="시험일 ${getExamDate()}"><i class="fa-solid fa-calendar-day"></i> 시험까지 ${label}</span>`;
}

/** 미암기 카드 수 — registry 목표치 상한 적용 (dashboard.js와 동일 산식) */
function _remainingCards() {
    let total = 0;
    if (typeof DataLoader !== 'undefined' && DataLoader.registry) {
        DataLoader.getSubjectList().forEach(subj => {
            const stats = /** @type {any} */ ((subj && subj.stats) || {});
            total += (stats.targetCards > 0) ? Math.min(stats.cards || 0, stats.targetCards) : (stats.cards || 0);
        });
    } else if (typeof window !== 'undefined' && window.STUDY_DATA) {
        const sd = window.STUDY_DATA;
        Object.keys(sd).forEach(k => { total += sd[k].cards.length; });
    }
    const mem = state.memorizedCards ? state.memorizedCards.size : 0;
    return Math.max(0, total - mem);
}

/** SC-05 학습 계획 패널 — 시험일 설정 시 목표·잔여·주차별 마일스톤 표시 */
function _studyPlanHtml() {
    const examDate = getExamDate();
    if (!examDate) return '';
    const plan = computeStudyPlan(_remainingCards());
    const dday = getDDay();
    const ddayLabel = dday === null || dday === 0 ? 'D-Day' : (dday < 0 ? `D+${-dday}` : `D-${dday}`);
    const header = (badge) => `
        <div class="plan-header">
            <h4><i class="fa-solid fa-clipboard-list" aria-hidden="true"></i> 학습 계획 ${badge || ''}</h4>
            <span class="plan-dday">시험일 ${examDate} · ${ddayLabel}</span>
        </div>`;
    if (!plan) {
        return `<div class="study-plan-card">${header('')}
            <p class="plan-note">시험일이 지났습니다 — 대시보드에서 실제 결과를 자가 보고할 수 있습니다.</p>
        </div>`;
    }
    const tierLabel = { done: '완료', normal: '여유', tight: '압축', triage: '긴급' }[plan.tier];
    const advice = {
        tight: '설정 목표를 초과하는 페이스입니다 — 카드·퀴즈 병행 학습을 권장합니다.',
        triage: '현재 페이스로는 전량 커버가 어렵습니다 — 출제 비중이 큰 과목부터 우선하거나 목표를 조정하세요.'
    }[plan.tier] || '';
    // SC-06 계획 대비 주간 진행률 — 이번 주 배정량 대 최근 7일 실적
    const adh = computePlanAdherence(plan);
    const adhMsg = adh && {
        met: '계획 페이스 달성 중입니다 — 이 속도를 유지하세요.',
        ontrack: '주간 필요량의 절반 이상 진행 — 조금만 더 하면 목표에 도달합니다.',
        behind: '계획 대비 부족합니다 — 남은 요일에 보충하거나 목표를 조정하세요.'
    }[adh.status];
    const adhHtml = adh && adh.status !== 'done' ? `
        <div class="plan-adherence plan-adh-${adh.status}">
            <div class="plan-adh-label">이번 주 진행 — 카드 ${adh.weekActual} / ${adh.weekTarget}장 (${adh.percent}%)</div>
            <div class="plan-adh-bar"><span style="width:${Math.min(100, adh.percent)}%"></span></div>
            <div class="plan-adh-msg">${adhMsg}</div>
        </div>` : '';
    const allocHtml = _subjectAllocHtml(plan);
    const rows = plan.weeks.slice(0, 12).map(w => `
                <tr><td>${w.week}주차</td><td>${w.range}</td><td>${w.cards}장</td><td>${w.cumulative}장 (${w.percent}%)</td></tr>`).join('');
    const more = plan.weeks.length > 12
        ? `<tr><td colspan="4" class="plan-more">… 이후 ${plan.weeks.length - 12}주 동일 페이스 지속</td></tr>` : '';
    return `<div class="study-plan-card">
        ${header(`<span class="plan-tier-badge plan-tier-${plan.tier}">${tierLabel}</span>`)}
        <div class="plan-summary">
            <div class="plan-summary-row"><span>남은 카드</span><strong>${plan.remaining}장</strong></div>
            <div class="plan-summary-row"><span>학습 가능일</span><strong>${plan.studyDays}일 (주 ${plan.goals.weeklyStudyDays}일)</strong></div>
            <div class="plan-summary-row"><span>학습일당 필요</span><strong>카드 ${plan.perStudyDay}장</strong></div>
            <div class="plan-summary-row"><span>설정 목표</span><strong>카드 ${plan.goals.dailyCards}장 · 퀴즈 ${plan.goals.dailyQuizzes}문/일</strong></div>
        </div>
        ${adhHtml}
        ${allocHtml}
        ${advice ? `<p class="plan-note plan-warn">${advice}</p>` : ''}
        ${plan.tier === 'done' ? '<p class="plan-note">남은 카드가 없습니다 — 복습과 모의고사로 실력을 유지하세요.</p>' : `
        <table class="plan-table">
            <thead><tr><th>주차</th><th>기간</th><th>배정</th><th>누적</th></tr></thead>
            <tbody>${rows}${more}</tbody>
        </table>`}
    </div>`;
}

/** SC-08·SC-09 스마트학습 — 이번 주 과목별 목표: 잔여×출제 비중×약점 가중 배분 (study_plan_pro 표기).
 *  칩은 주간 실적(N/배정장) + 약점·비중 근거 배지 + 과목 카드 학습 바로가기 버튼. */
function _subjectAllocHtml(plan) {
    if (!plan || plan.tier === 'done') return '';
    let subjects = [];
    if (typeof DataLoader !== 'undefined' && DataLoader.registry) {
        subjects = DataLoader.getSubjectList();
    } else if (typeof window !== 'undefined' && window.STUDY_DATA) {
        const sd = window.STUDY_DATA;
        subjects = Object.keys(sd).map(k => ({
            key: k,
            name: (sd[k] && sd[k].name) || k,
            stats: { cards: (sd[k].cards || []).length }
        }));
    }
    // 과목 키 해석은 subjectKeyFromItemId — 숫자·밑줄 포함 키도 안전 (SC-09)
    const mem = {};
    const quiz = {};
    const weak = {};
    const weights = {};
    (state.memorizedCards || []).forEach(id => {
        const k = subjectKeyFromItemId(id);
        if (k) mem[k] = (mem[k] || 0) + 1;
    });
    Object.keys(state.quizResults || {}).forEach(id => {
        const k = subjectKeyFromItemId(id);
        if (k) {
            quiz[k] = quiz[k] || { solved: 0, correct: 0 };
            quiz[k].solved++;
            if (state.quizResults[id].correct) quiz[k].correct++;
        }
    });
    (state.weakCards || []).forEach(id => {
        const clean = id.replace(/^weak_(quiz|sim)_/, '');
        if (!clean.includes('_card_')) return; // 카드 외 항목(퀴즈·시뮬)은 카드 잔여 대비 비율 왜곡 방지
        const k = subjectKeyFromItemId(id);
        if (k) weak[k] = (weak[k] || 0) + 1;
    });
    if (typeof DataLoader !== 'undefined' && DataLoader.registry) {
        (DataLoader.registry.exams || []).forEach(ex => {
            if (ex && ex.subject) weights[ex.subject] = (weights[ex.subject] || 0) + ((ex.stats && ex.stats.questions) || 0);
        });
    }
    const alloc = computeSubjectAllocation(plan, subjects, {
        memBySubject: mem,
        quizBySubject: quiz,
        recentQuizBySubject: recentQuizBySubject(state.quizResults || {}),
        weakBySubject: weak,
        weightBySubject: weights
    });
    if (!alloc) return '';
    const doneBySubj = sumRecentCardsBySubject(getStudyCalendar());
    const chips = alloc.thisWeek.alloc.map(a => {
        if (a.remaining === 0) return `<span class="alloc-chip alloc-done">${esc(a.name)} 완료</span>`;
        const done = doneBySubj[a.key] || 0;
        const metCls = a.cards > 0 && done >= a.cards ? ' alloc-chip-met' : '';
        const badges = (a.weakBadge ? '<span class="alloc-badge alloc-badge-weak" title="약점 가중 반영 — 최근 퀴즈 정답률·취약 카드 비율">약점</span>' : '')
            + (alloc.hasWeights && a.weightPct > 0 ? `<span class="alloc-badge" title="출제 비중 ${a.weightPct}%">${a.weightPct}%</span>` : '');
        return `<button type="button" class="alloc-chip${metCls}" data-click="startSubjectStudy" data-arg="${esc(a.key)}" title="${esc(a.name)} 카드 학습으로 이동">${esc(a.name)} ${done}/${a.cards}장${badges}</button>`;
    }).join('');
    const cols = alloc.thisWeek.alloc.map(a => `<th>${esc(a.name)}</th>`).join('');
    const mrows = alloc.weeks.slice(0, 12).map(w =>
        `<tr><td>${w.week}주차</td>${w.alloc.map(a => `<td>${a.cards}</td>`).join('')}</tr>`).join('');
    const more = alloc.weeks.length > 12
        ? `<tr><td colspan="${alloc.thisWeek.alloc.length + 1}" class="plan-more">… 이후 ${alloc.weeks.length - 12}주</td></tr>` : '';
    return `
        <div class="plan-alloc">
            <div class="plan-alloc-head">
                <span>스마트학습 — 이번 주 과목별 목표</span>
                <span class="pro-badge" data-pro-feature="study_plan_pro">PRO</span>
            </div>
            <div class="plan-alloc-chips">${chips}</div>
            <p class="plan-alloc-basis">${alloc.hasWeights ? '배정 근거: 잔여량 × 출제 비중 × 약점 가중(최근 퀴즈 정답률·취약 카드)' : '배정 근거: 잔여량 × 약점 가중 (출제 비중 미선언 — 균등 배분)'} · 칩을 누르면 해당 과목 학습으로 이동</p>
            <details class="plan-alloc-detail">
                <summary>주차별 배분 표 펼치기</summary>
                <table class="plan-table plan-alloc-table">
                    <thead><tr><th>주차</th>${cols}</tr></thead>
                    <tbody>${mrows}${more}</tbody>
                </table>
            </details>
        </div>`;
}

function _renderCalendarDays() {
    const firstDay = new Date(_currentYear, _currentMonth, 1).getDay();
    const daysInMonth = new Date(_currentYear, _currentMonth + 1, 0).getDate();
    const today = getTodayStr();
    const cal = getStudyCalendar();
    let html = '';

    // 빈 칸
    for (let i = 0; i < firstDay; i++) {
        html += '<div class="calendar-day empty"></div>';
    }

    // 날짜
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = localDateKey(new Date(_currentYear, _currentMonth, d));
        const entry = cal[dateStr] || {};
        const studied = (entry.cards > 0 || entry.quizzes > 0);
        const isToday = dateStr === today;
        const classes = ['calendar-day'];
        if (studied) classes.push('studied');
        if (isToday) classes.push('today');

        const tooltip = studied
            ? `카드 ${entry.cards || 0} · 퀴즈 ${entry.quizzes || 0} · 정답 ${entry.correct || 0}`
            : '';

        html += `
            <div class="${classes.join(' ')}" title="${tooltip}">
                <span class="day-num">${d}</span>
                ${studied ? '<i class="fa-solid fa-check stamp" aria-hidden="true"></i>' : ''}
            </div>
        `;
    }

    return html;
}

/**
 * 이전 달
 */
export function prevCalendarMonth() {
    _currentMonth--;
    if (_currentMonth < 0) { _currentMonth = 11; _currentYear--; }
    renderStudyCalendar();
}

/**
 * 다음 달
 */
export function nextCalendarMonth() {
    _currentMonth++;
    if (_currentMonth > 11) { _currentMonth = 0; _currentYear++; }
    renderStudyCalendar();
}

/**
 * 목표 설정 모달
 */
export function openGoalSettings() {
    const goals = getStudyGoals();
    const examDate = getExamDate() || '';
    const oldModal = document.getElementById('goal-settings-modal');
    if (oldModal) oldModal.remove();

    const modalHTML = `
        <div id="goal-settings-modal" class="modal-overlay" role="dialog" aria-modal="true" aria-label="학습 목표 설정" style="position:fixed;top:0;left:0;right:0;height:var(--app-height,100dvh);z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(11,15,25,0.85);backdrop-filter:blur(10px);">
            <div class="glass-card dialog-card" style="width:90%;max-width:480px;padding:2rem;background:var(--bg-card);border:1px solid var(--border-color);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
                    <h3 style="font-weight:700;color:var(--color-primary);margin:0;">
                        <i class="fa-solid fa-bullseye" aria-hidden="true"></i> 학습 목표 설정
                    </h3>
                    <button class="btn btn-secondary btn-sm" data-click="closeGoalSettings" title="닫기" aria-label="닫기">
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                </div>
                <div style="display:flex;flex-direction:column;gap:1.25rem;">
                    <div>
                        <label style="display:block;margin-bottom:0.5rem;font-weight:600;">일일 카드 목표 (장)</label>
                        <input type="number" id="goal-daily-cards" class="form-input" value="${goals.dailyCards}" min="1" max="500" style="width:100%;height:48px;">
                    </div>
                    <div>
                        <label style="display:block;margin-bottom:0.5rem;font-weight:600;">일일 퀴즈 목표 (문제)</label>
                        <input type="number" id="goal-daily-quizzes" class="form-input" value="${goals.dailyQuizzes}" min="1" max="200" style="width:100%;height:48px;">
                    </div>
                    <div>
                        <label style="display:block;margin-bottom:0.5rem;font-weight:600;">주간 학습 일수 (일)</label>
                        <input type="number" id="goal-weekly-days" class="form-input" value="${goals.weeklyStudyDays}" min="1" max="7" style="width:100%;height:48px;">
                    </div>
                    <div>
                        <label style="display:block;margin-bottom:0.5rem;font-weight:600;">시험일 (D-day 역산)</label>
                        <input type="date" id="goal-exam-date" class="form-input" value="${examDate}" style="width:100%;height:48px;">
                        <p id="exam-date-hint" style="margin:0.5rem 0 0;font-size:0.85rem;line-height:1.4;"></p>
                    </div>
                </div>
                <div style="display:flex;gap:0.75rem;margin-top:1.5rem;">
                    <button class="btn btn-secondary" style="flex:1;" data-click="closeGoalSettings">취소</button>
                    <button class="btn btn-primary" style="flex:1;" data-click="saveGoalSettings">저장</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // D-17 시험일 리드타임 인라인 권고 — 날짜 변경 시 실시간 갱신
    const dateInput = /** @type {HTMLInputElement} */ (document.getElementById('goal-exam-date'));
    const hintEl = document.getElementById('exam-date-hint');
    const updateHint = () => _renderExamDateHint(hintEl, dateInput ? dateInput.value : '');
    if (dateInput) dateInput.addEventListener('input', updateHint);
    updateHint();
}

/** 시험일 리드타임 권고 문구 — 최소 MIN_EXAM_LEAD_DAYS일 전 설정 권장 */
function _renderExamDateHint(hintEl, dateStr) {
    if (!hintEl) return;
    const st = getExamLeadStatus(dateStr);
    const set = (text, color) => { hintEl.textContent = text; hintEl.style.color = color; };
    if (!st) {
        set(`효율적인 학습을 위해 시험일은 최소 ${MIN_EXAM_LEAD_DAYS}일 전에 설정하는 것을 권장합니다.`, 'var(--color-text-muted)');
    } else if (st.past) {
        set('지난 시험일입니다 — 시험 결과 자가 보고에 사용됩니다.', 'var(--color-text-muted)');
    } else if (st.dday === 0) {
        set('시험 당일입니다.', 'var(--color-warning)');
    } else if (st.leadShort) {
        set(`시험까지 D-${st.dday} — 권장 준비 기간(${MIN_EXAM_LEAD_DAYS}일) 미만입니다. 핵심 과목 우선 전략이 필요합니다.`, 'var(--color-warning)');
    } else {
        set(`시험까지 D-${st.dday} — 준비 기간이 충분합니다.`, 'var(--color-success)');
    }
}

export function closeGoalSettings() {
    const modal = document.getElementById('goal-settings-modal');
    if (modal) modal.remove();
}

export function saveGoalSettings() {
    const cards = parseInt(/** @type {HTMLInputElement} */ (document.getElementById('goal-daily-cards'))?.value) || 50;
    const quizzes = parseInt(/** @type {HTMLInputElement} */ (document.getElementById('goal-daily-quizzes'))?.value) || 10;
    const weeklyDays = parseInt(/** @type {HTMLInputElement} */ (document.getElementById('goal-weekly-days'))?.value) || 5;
    setStudyGoals({ dailyCards: cards, dailyQuizzes: quizzes, weeklyStudyDays: weeklyDays });
    setExamDate(/** @type {HTMLInputElement} */ (document.getElementById('goal-exam-date'))?.value || '');
    closeGoalSettings();
    showToast('학습 목표가 저장되었습니다.', 'success');
    renderStudyCalendar();
    if (typeof updateGlobalStats === 'function') updateGlobalStats();
    // 시험일이 설정됐으면 학습 계획 패널(SC-05)이 보이는 캘린더 뷰로 이동
    if (getExamDate()) switchView('calendar-view', { scrollTop: true });
}
