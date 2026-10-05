// tests/dom/onboarding-zoom.dom.test.js — 첫 방문 시작 안내
// @spec UX-FB-05
// UX-FB-05: 학습 데이터 없는 최초 방문 1회만 표시 — 재방문 사용자는 방해 금지

import { describe, it, beforeEach, expect, vi } from 'vitest';

vi.mock('../../src/ui-utils.js', () => ({
    trapFocus: vi.fn(() => () => {}),
}));

vi.mock('../../src/exam-context.js', () => ({
    getExamAppName: () => 'Passmula',
}));

// state.js의 safeGetItem/safeSetItem을 localStorage 위임으로 대체
vi.mock('../../src/state.js', () => ({
    safeGetItem: (k) => localStorage.getItem(k),
    safeSetItem: (k, v) => localStorage.setItem(k, v),
}));

import { showOnboardingModal, maybeShowOnboarding } from '../../src/onboarding.js';

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
});

describe('UX-FB-05 첫 방문 시작 안내', () => {
    it('학습 데이터가 없으면 모달을 1회 표시하고 seen 플래그를 기록한다', () => {
        maybeShowOnboarding();
        expect(document.getElementById('onboarding-overlay')).toBeTruthy();
        expect(localStorage.getItem('onboarding_seen_v1')).toBe('1');
        expect(document.querySelectorAll('.onboarding-step')).toHaveLength(4);
    });

    it('기존 사용자(학습 키 존재)는 플래그만 기록하고 모달을 띄우지 않는다', () => {
        localStorage.setItem('quiz_results', '{}');
        maybeShowOnboarding();
        expect(document.getElementById('onboarding-overlay')).toBeNull();
        expect(localStorage.getItem('onboarding_seen_v1')).toBe('1');
    });

    it('seen 플래그가 있으면 재표시하지 않는다', () => {
        localStorage.setItem('onboarding_seen_v1', '1');
        maybeShowOnboarding();
        expect(document.getElementById('onboarding-overlay')).toBeNull();
    });

    it('설정 메뉴 재열람 경로 — showOnboardingModal은 항상 표시한다', () => {
        localStorage.setItem('quiz_results', '{}');
        showOnboardingModal();
        const dialog = document.querySelector('#onboarding-overlay [role="dialog"]');
        expect(dialog).toBeTruthy();
        expect(dialog.textContent).toContain('시작 안내');
    });
});
