// tests/dom/study-calendar.dom.test.js — 학습 캘린더·목표 시나리오
// @spec SC-01,SC-02,SC-05,SC-06,SC-07,SC-08,D-17
// 설계: docs/dev/design/DOM_TEST_DESIGN.md §5.2 (Phase 4)
// 검증: 캘린더 렌더(H) · 활동 기록→학습일 반영·목표 달성률(H/P) · 월 이동(H)
//       · 목표 설정 저장→달성률 재계산(B/P) · 빈 달력(E)

import { describe, it, beforeEach, expect, vi } from 'vitest';

vi.mock('../../src/ui-utils.js', () => ({
    showToast: vi.fn(),
    showConfirm: vi.fn(() => Promise.resolve(true)),
    showGlobalLoading: vi.fn(),
    hideGlobalLoading: vi.fn(),
    vibrate: vi.fn(),
    HAPTIC: { correct: 30, wrong: [40, 30, 40], tap: 10 },
}));

vi.mock('../../src/views/navigation.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, switchView: vi.fn() };
});

vi.mock('../../src/pro-upgrade.js', () => ({
    proFeatureNotice: vi.fn(),
    refreshProBadges: vi.fn(),
}));

import { showToast } from '../../src/ui-utils.js';
import { switchView } from '../../src/views/navigation.js';
import {
    loadIndexHtml, el, resetStudyState, storedJson, seedStudyData, stubRegistry,
} from './helpers.js';
import {
    renderStudyCalendar, prevCalendarMonth, nextCalendarMonth,
    openGoalSettings, saveGoalSettings, closeGoalSettings,
} from '../../src/views/study-calendar.js';
import { recordStudyActivity, getTodayStr, setExamDate, setStudyGoals } from '../../src/study-tracker.js';
import { DataLoader } from '../../src/data-loader.js';
import { safeSetItem } from '../../src/state.js';
import { STORAGE_KEYS } from '../../src/storage-keys.js';

describe('학습 캘린더 — 렌더·기록·목표', () => {
    beforeEach(() => {
        localStorage.clear();
        resetStudyState();
        loadIndexHtml();
        vi.clearAllMocks();
    });

    it('기본 렌더 → 목표 카드 3개 + 이번 달 캘린더 + 오늘 셀', () => {
        renderStudyCalendar();

        const wrap = el('study-calendar-content');
        expect(wrap.querySelectorAll('.goal-card').length).toBe(3);
        expect(wrap.querySelectorAll('.calendar-weekday').length).toBe(7);
        expect(wrap.querySelector('.calendar-title').textContent).toContain('년');
        // 오늘 셀에 today 클래스
        expect(wrap.querySelector('.calendar-day.today')).not.toBeNull();
        // 기본 목표: 카드 0/50, 퀴즈 0/10, 주간 0/5일
        expect(wrap.textContent).toContain('0 / 50');
        expect(wrap.textContent).toContain('0 / 10');
        expect(wrap.textContent).toContain('0 / 5일');
    });

    it('활동 기록 → 오늘 셀 학습 표시 + 목표 달성률 반영 (P)', () => {
        recordStudyActivity({ cards: 10, quizzes: 5, correct: 4 });
        renderStudyCalendar();

        const wrap = el('study-calendar-content');
        const todayCell = wrap.querySelector('.calendar-day.today');
        expect(todayCell.classList.contains('studied')).toBe(true);
        expect(todayCell.getAttribute('title')).toContain('카드 10');
        // 카드 10/50 = 20%, 퀴즈 5/10 = 50% → 평균 35%
        expect(wrap.textContent).toContain('10 / 50');
        expect(wrap.textContent).toContain('5 / 10');
        expect(wrap.querySelector('.goal-percent').textContent).toBe('35%');
        // localStorage 실기록 확인
        expect(storedJson(STORAGE_KEYS.STUDY_CALENDAR)[getTodayStr()].cards).toBe(10);
    });

    it('지난 학습일 시딩 → 해당 일자 studied 마킹, 미학습일 없음 표시', () => {
        const cal = {};
        cal[getTodayStr().slice(0, 8) + '01'] = { cards: 3, quizzes: 0, correct: 0 }; // 이번 달 1일
        safeSetItem(STORAGE_KEYS.STUDY_CALENDAR, JSON.stringify(cal));
        renderStudyCalendar();

        const studied = el('study-calendar-content').querySelectorAll('.calendar-day.studied');
        expect(studied.length).toBe(1);
        expect(studied[0].querySelector('.day-num').textContent).toBe('1');
    });

    it('월 이동 → 이전/다음 달 타이틀 전환 후 복귀', () => {
        renderStudyCalendar();
        const thisTitle = el('study-calendar-content').querySelector('.calendar-title').textContent;

        prevCalendarMonth();
        const prevTitle = el('study-calendar-content').querySelector('.calendar-title').textContent;
        expect(prevTitle).not.toBe(thisTitle);

        nextCalendarMonth();
        expect(el('study-calendar-content').querySelector('.calendar-title').textContent).toBe(thisTitle);
    });

    it('목표 설정 → 모달 열기·기본값·저장 시 영속 + 재렌더', () => {
        renderStudyCalendar();
        openGoalSettings();

        const modal = el('goal-settings-modal');
        expect(modal).not.toBeNull();
        expect(el('goal-daily-cards').value).toBe('50');
        expect(el('goal-daily-quizzes').value).toBe('10');
        expect(el('goal-weekly-days').value).toBe('5');

        el('goal-daily-cards').value = '100';
        saveGoalSettings();

        expect(el('goal-settings-modal')).toBeNull();
        expect(storedJson(STORAGE_KEYS.STUDY_GOALS).dailyCards).toBe(100);
        expect(storedJson(STORAGE_KEYS.STUDY_GOALS).dailyQuizzes).toBe(10);
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('저장'), 'success');
        // 재렌더에 새 목표 반영
        expect(el('study-calendar-content').textContent).toContain('0 / 100');
    });

    it('시험일 저장 → 캘린더 뷰로 전환 요청 (SC-02·SC-05 계획 패널 노출)', () => {
        openGoalSettings();
        const d = new Date();
        d.setDate(d.getDate() + 30);
        el('goal-exam-date').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        saveGoalSettings();

        expect(switchView).toHaveBeenCalledWith('calendar-view', { scrollTop: true });
    });

    it('목표 설정 취소 → 모달만 닫히고 목표 불변', () => {
        openGoalSettings();
        el('goal-daily-cards').value = '999';
        closeGoalSettings();

        expect(el('goal-settings-modal')).toBeNull();
        expect(storedJson(STORAGE_KEYS.STUDY_GOALS)).toBeNull();
    });

    it('시험일 리드타임 인라인 권고 — 30일 미만 경고·30일 이상 안심 (D-17)', () => {
        openGoalSettings();
        const hint = el('exam-date-hint');
        const dateInput = el('goal-exam-date');
        const plus = (n) => {
            const d = new Date();
            d.setDate(d.getDate() + n);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        };

        // 상시 권고 문구 (미설정)
        expect(hint.textContent).toContain('최소 30일 전');

        // 30일 미만 → 권장 준비 기간 미만 경고
        dateInput.value = plus(20);
        dateInput.dispatchEvent(new Event('input'));
        expect(hint.textContent).toContain('D-20');
        expect(hint.textContent).toContain('미만');

        // 30일 이상 → 충분 안내
        dateInput.value = plus(45);
        dateInput.dispatchEvent(new Event('input'));
        expect(hint.textContent).toContain('D-45');
        expect(hint.textContent).toContain('충분');

        // 지난 시험일 → 결과 자가 보고 안내
        dateInput.value = plus(-5);
        dateInput.dispatchEvent(new Event('input'));
        expect(hint.textContent).toContain('지난 시험일');
    });

    it('학습 계획 패널 — 시험일 설정 시 목표·잔여·주차 표 + 등급 배지 (SC-05)', () => {
        seedStudyData('subja', {
            name: '과목1',
            cards: [
                { id: 'subja_card_1', term: 't1', definition: 'd' },
                { id: 'subja_card_2', term: 't2', definition: 'd' },
            ],
        });
        const plus = (n) => {
            const d = new Date();
            d.setDate(d.getDate() + n);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        };

        // D-10, 주 5일 → 학습 가능 7일 → 일당 1장 vs 목표 50 → 여유
        setExamDate(plus(10));
        renderStudyCalendar();
        const card = el('study-calendar-content').querySelector('.study-plan-card');
        expect(card).not.toBeNull();
        expect(card.textContent).toContain('학습 계획');
        expect(card.textContent).toContain('D-10');
        expect(card.textContent).toContain('남은 카드');
        expect(card.textContent).toContain('2장');
        expect(card.querySelector('.plan-tier-normal')).not.toBeNull();
        expect(card.querySelectorAll('.plan-table:not(.plan-alloc-table) tbody tr').length).toBe(2); // 2주차

        // 목표 초과 페이스 → 등급 배지·권고 문구
        setStudyGoals({ dailyCards: 1 });
        setExamDate(plus(2)); // 잔여 2장, 학습 가능 1일 → 일당 2장 > 목표 1 → tight
        renderStudyCalendar();
        const tight = el('study-calendar-content').querySelector('.study-plan-card');
        expect(tight.querySelector('.plan-tier-tight')).not.toBeNull();
        expect(tight.textContent).toContain('병행');

        // 경과 시험일 → 표 없이 결과 보고 안내
        setExamDate(plus(-5));
        renderStudyCalendar();
        const past = el('study-calendar-content').querySelector('.study-plan-card');
        expect(past.textContent).toContain('시험일이 지났습니다');
        expect(past.querySelector('.plan-table')).toBeNull();

        // 미설정 → 패널 없음
        setExamDate('');
        renderStudyCalendar();
        expect(el('study-calendar-content').querySelector('.study-plan-card')).toBeNull();
    });

    it('계획 대비 주간 진행률 — 최근 7일 실적 바·상태 표시 (SC-06)', () => {
        seedStudyData('subja', {
            name: '과목1',
            cards: Array.from({ length: 40 }, (_, i) => ({ id: `subja_card_${i}`, term: `t${i}`, definition: 'd' })),
        });
        const d = new Date();
        d.setDate(d.getDate() + 14);
        setExamDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
        // D-14·주 5일 → 학습 가능 10일 → 일당 4장 → 이번 주 배정 20장, 실적 4장 → behind
        recordStudyActivity({ cards: 4, quizzes: 0, correct: 0 });
        renderStudyCalendar();

        const adh = el('study-calendar-content').querySelector('.plan-adherence');
        expect(adh).not.toBeNull();
        expect(adh.classList.contains('plan-adh-behind')).toBe(true);
        expect(adh.textContent).toContain('이번 주 진행');
        expect(adh.textContent).toContain('4 / 20장');
        expect(adh.querySelector('.plan-adh-bar > span').style.width).toBe('20%');
        expect(adh.textContent).toContain('부족');
    });

    it('마일스톤 안내 — 임계 도달 시 1회성 토스트·재렌더 중복 억제 (SC-07)', () => {
        const d = new Date();
        d.setDate(d.getDate() + 5);
        setExamDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
        renderStudyCalendar();
        // D-5 → 긴급 순으로 최대 2건 (d7·d14)
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('1주'), 'warning');
        const calls = showToast.mock.calls.length;
        expect(calls).toBeLessThanOrEqual(2);

        // 재렌더 — 안내된 마일스톤은 seen 처리되어 재표시 없음
        showToast.mockClear();
        renderStudyCalendar();
        const again = showToast.mock.calls.filter(c => String(c[0]).includes('1주'));
        expect(again.length).toBe(0);
        // 나머지 마일스톤(d30)은 다음 렌더에 표시될 수 있음
        expect(showToast.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it('과목별 가중 배분 — 이번 주 칩 + PRO 배지 + 주차 매트릭스 (SC-08)', () => {
        stubRegistry([
            { key: 'suba', name: '과목A', cards: Array.from({ length: 40 }, (_, i) => ({ id: `suba_card_${i}` })) },
            { key: 'subb', name: '과목B', cards: Array.from({ length: 40 }, (_, i) => ({ id: `subb_card_${i}` })) },
        ]);
        DataLoader.registry.exams = [
            { subject: 'suba', stats: { questions: 100 } },
            { subject: 'subb', stats: { questions: 300 } },
        ];
        const d = new Date();
        d.setDate(d.getDate() + 14);
        setExamDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
        renderStudyCalendar();

        const alloc = el('study-calendar-content').querySelector('.plan-alloc');
        expect(alloc).not.toBeNull();
        expect(alloc.textContent).toContain('이번 주 과목별 목표');
        // 비중 1:3 → 과목B 배정이 과목A보다 큼
        const chips = [...alloc.querySelectorAll('.alloc-chip')].map(c => c.textContent);
        expect(chips.some(t => t.includes('과목A'))).toBe(true);
        expect(chips.some(t => t.includes('과목B'))).toBe(true);
        const num = (t) => parseInt(t.replace(/\D/g, ''), 10);
        expect(num(chips.find(t => t.includes('과목B')))).toBeGreaterThan(num(chips.find(t => t.includes('과목A'))));
        // PRO 배지 + 매트릭스
        expect(alloc.querySelector('[data-pro-feature="study_plan_pro"]')).not.toBeNull();
        expect(alloc.querySelector('.plan-alloc-detail')).not.toBeNull();
        expect(alloc.querySelectorAll('.plan-alloc-table tbody tr').length).toBe(2); // D-14 → 2주차
    });

    it('목표 설정 모달 — 모바일 잘림 계약 (role=dialog + dialog-card + 실측 높이)', () => {
        openGoalSettings();

        const modal = el('goal-settings-modal');
        expect(modal.getAttribute('role')).toBe('dialog');
        expect(modal.getAttribute('aria-modal')).toBe('true');
        expect(modal.style.height).toContain('--app-height');
        // 내용 초과 시 내부 스크롤되는 규약 클래스 (check:mobilesafe)
        expect(modal.querySelector('.dialog-card')).not.toBeNull();
    });
});
