// tests/dom/app-shell.dom.test.js — 앱 셸 뷰포트 높이 동기화
// @spec UX-PWA-05
// 목적: initViewportHeight()가 핀치 줌(visualViewport.scale !== 1) 중
//       --app-height를 축소 보고값으로 덮어쓰지 않는지 회귀 검증.
//       줌 중 height는 배율만큼 축소 보고되므로 그대로 쓰면 .app-container가
//       위쪽으로 찌그러져 앱 셸 하단(교재리더 본문 하단 포함)이 잘려 보인다.

import { describe, it, beforeEach, expect } from 'vitest';

import { initViewportHeight } from '../../src/app-shell.js';

const appHeight = () => document.documentElement.style.getPropertyValue('--app-height');

describe('initViewportHeight — 핀치 줌 가드', () => {
    let vv;

    beforeEach(() => {
        document.documentElement.style.removeProperty('--app-height');
        // jsdom에는 visualViewport가 없으므로 EventTarget 스텁으로 주입
        vv = new EventTarget();
        vv.height = 800;
        vv.scale = 1;
        Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true, writable: true });
    });

    it('scale=1이면 visualViewport.height로 --app-height를 동기화한다', () => {
        initViewportHeight();
        expect(appHeight()).toBe('800px');

        vv.height = 600; // 키보드 개폐 등 실측 높이 변동
        vv.dispatchEvent(new Event('resize'));
        expect(appHeight()).toBe('600px');
    });

    it('핀치 줌(scale>1) 중 resize는 --app-height를 갱신하지 않는다', () => {
        initViewportHeight();
        expect(appHeight()).toBe('800px');

        vv.scale = 2;
        vv.height = 400; // 줌으로 축소 보고된 시각 뷰포트
        vv.dispatchEvent(new Event('resize'));
        expect(appHeight()).toBe('800px');

        // 줌 아웃으로 복귀하면 정상 동기화 재개
        vv.scale = 1;
        vv.height = 800;
        vv.dispatchEvent(new Event('resize'));
        expect(appHeight()).toBe('800px');
    });
});
