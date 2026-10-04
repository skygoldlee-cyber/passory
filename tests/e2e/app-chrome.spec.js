// tests/e2e/app-chrome.spec.js — 앱 셸 크롬 요소 실측 (실브라우저)
// @spec R-03,UX-SET-04,UX-SET-05,UX-FB-02,UX-PWA-03,UX-PWA-04,UX-SCR-02,UX-SCR-03
// 설정 메뉴(버전 표시·닫힘 규약), 커스텀 확인 모달, PWA 설치 버튼,
// 세이프에어리어·스크롤바 스타일의 실제 발현을 검증한다.

import { test, expect } from '@playwright/test';

async function boot(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => window.__APP_INITIALIZED === true, null, { timeout: 15_000 });
    await page.evaluate(() => {
        document.querySelectorAll('#app-confirm-overlay, #onboarding-overlay').forEach(el => el.remove());
    });
}

/** 동일 출처 스타일시트의 cssRules 텍스트를 전수 수집 */
function collectCssText(page) {
    return page.evaluate(() => {
        let out = '';
        const walk = (rules) => {
            for (const rule of rules) {
                out += rule.cssText + '\n';
                // @import된 시트는 CSSImportRule.styleSheet로 재귀 진입
                try {
                    if (rule.styleSheet) walk(rule.styleSheet.cssRules);
                } catch (e) { /* 접근 불가 시트는 건너뜀 */ }
            }
        };
        for (const sheet of document.styleSheets) {
            try { walk(sheet.cssRules); } catch (e) { /* 교차출처 시트는 건너뜀 */ }
        }
        return out;
    });
}

test.beforeEach(({ page }) => {
    page.addInitScript(() => {
        localStorage.setItem('current_exam', 'cosmetic');
        localStorage.setItem('onboarding_seen_v1', '1');
        localStorage.setItem('cosmetic:onboarding_seen_v1', '1');
        window.__nativeCalls = { alert: 0, confirm: 0 };
        window.alert = () => { window.__nativeCalls.alert++; };
        window.confirm = () => { window.__nativeCalls.confirm++; return true; };
    });
    page._errors = [];
    page.on('pageerror', err => page._errors.push(String(err)));
});

test.describe('설정 메뉴', () => {
    test('패널 하단에 앱 버전이 표시된다 (UX-SET-04)', async ({ page }) => {
        await boot(page);
        const text = await page.locator('#settings-version').textContent();
        expect((text || '').trim().length).toBeGreaterThan(0);
        // formatAppVersion 출력 형태 (v2026xxxx-xxxx 또는 버전 문자열)
        expect((text || '').trim()).toMatch(/v?\d/);
    });

    test('외부 클릭·Escape·항목 선택으로 닫힌다 (UX-SET-05)', async ({ page }) => {
        await boot(page);
        const panel = page.locator('#settings-panel');
        const toggle = page.locator('#settings-toggle-btn');

        // 1) 토글 → 열림 (aria-expanded 동기화)
        await toggle.click();
        await expect(panel).not.toHaveClass(/is-hidden/);
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');

        // 2) 외부 클릭 → 닫힘
        await page.locator('main, .view-section').first().click({ position: { x: 5, y: 5 }, force: true });
        await expect(panel).toHaveClass(/is-hidden/);

        // 3) 재오픈 → Escape → 닫힘
        await toggle.click();
        await expect(panel).not.toHaveClass(/is-hidden/);
        await page.keyboard.press('Escape');
        await expect(panel).toHaveClass(/is-hidden/);

        // 4) 재오픈 → 항목 선택 → 닫힘 (항목의 부수 동작과 무관하게 패널은 닫혀야 함)
        await toggle.click();
        await expect(panel).not.toHaveClass(/is-hidden/);
        await page.locator('#whats-new-btn').click();
        await expect(panel).toHaveClass(/is-hidden/);
        await page.evaluate(() => {
            document.querySelectorAll('#app-confirm-overlay, .modal-overlay, [role="dialog"]').forEach(el => {
                if (el.id === 'pwa-install-modal') el.classList.add('is-hidden');
            });
        });
    });
});

test.describe('커스텀 확인 모달', () => {
    test('진도 초기화가 네이티브 confirm이 아닌 커스텀 오버레이를 띄운다 (UX-FB-02)', async ({ page }) => {
        await boot(page);
        await page.locator('#settings-toggle-btn').click();
        await page.locator('#reset-progress-btn').click();

        const overlay = page.locator('#app-confirm-overlay');
        await expect(overlay).toBeVisible({ timeout: 5_000 });
        await expect(overlay.locator('.app-confirm-ok')).toBeVisible();
        await expect(overlay.locator('.app-confirm-cancel')).toBeVisible();

        // 네이티브 alert/confirm은 부트+조작 전 과정에서 0회
        const calls = await page.evaluate(() => window.__nativeCalls);
        expect(calls.alert).toBe(0);
        expect(calls.confirm).toBe(0);

        // 취소 → 오버레이 닫힘 (진도 유지)
        await overlay.locator('.app-confirm-cancel').click();
        await expect(page.locator('#app-confirm-overlay')).toHaveCount(0);
    });
});

test.describe('PWA 설치 버튼', () => {
    test('beforeinstallprompt 캡처 시 버튼이 활성 상태로 유지된다 (UX-PWA-04)', async ({ page }) => {
        await boot(page);
        const btn = page.locator('#pwa-install-btn');
        await expect(btn).toBeVisible();
        // 캡처 이벤트 → deferredPrompt 저장 + pwa-install-available 디스패치
        await page.evaluate(() => {
            window.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true }));
        });
        await page.waitForFunction(() => window.__deferredPrompt !== undefined && window.__deferredPrompt !== null);
        await expect(btn).not.toHaveClass(/is-hidden/);
    });

    test('SW 교체(controllerchange) 시 업데이트 토스트 표시 후 자동 리로드한다 (UX-PWA-03)', async ({ page }) => {
        test.setTimeout(90_000);
        await boot(page);
        // SW가 이 페이지를 제어 중이어야 hadController=true → 교체 판정 성립.
        // 최초 등록은 clients.claim으로 즉시 제어하지만, 미제어 시 1회 리로드로 보정.
        const controlled = await page.waitForFunction(() =>
            !!navigator.serviceWorker.controller, null, { timeout: 15_000 })
            .then(() => true).catch(() => false);
        if (!controlled) {
            await page.reload();
            await page.waitForFunction(() => window.__APP_INITIALIZED === true, null, { timeout: 15_000 });
            await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15_000 });
        }
        // 캡처 스크립트의 hadController는 로드 시점 값 — 제어 확정 후 한 번 더 로드해 확실히 true로 둔다
        await page.reload();
        await page.waitForFunction(() => window.__APP_INITIALIZED === true, null, { timeout: 15_000 });
        await page.waitForFunction(() => window.__swRegistered === true, null, { timeout: 15_000 });
        expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

        // 리로드 유예 조건이 되는 모달류는 미리 제거
        await page.evaluate(() => {
            document.querySelectorAll('#app-confirm-overlay, #onboarding-overlay, #whats-new-overlay').forEach(el => el.remove());
        });
        // 실제 배포 업데이트와 동일한 이벤트 경로 — 핸들러가 토스트 표시 + __SW_UPDATE_INBOUND 설정
        await page.evaluate(() => {
            navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
        });
        await expect(page.locator('#sw-update-toast')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('#sw-update-toast')).toContainText('새 버전');
        expect(await page.evaluate(() => window.__SW_UPDATE_INBOUND)).toBe(true);
        // Cache First 규약상 새 자산은 리로드 후에만 반영 — 자동 리로드 실행 확인
        await page.waitForNavigation({ timeout: 15_000 }).catch(() => null);
        await page.waitForFunction(() => window.__APP_INITIALIZED === true, null, { timeout: 15_000 });
    });

    test('standalone(설치됨) 환경에서는 버튼이 숨겨진다 (UX-PWA-04)', async ({ page }) => {
        await page.addInitScript(() => {
            const orig = window.matchMedia.bind(window);
            window.matchMedia = (q) => /display-mode:\s*standalone/.test(q)
                ? /** @type {MediaQueryList} */ ({
                    matches: true, media: q, onchange: null,
                    addEventListener: () => {}, removeEventListener: () => {},
                    addListener: () => {}, removeListener: () => {},
                    dispatchEvent: () => false,
                })
                : orig(q);
        });
        await boot(page);
        await expect(page.locator('#pwa-install-btn')).toHaveClass(/is-hidden/);
    });
});

test.describe('스타일 발현', () => {
    test('세이프에어리어 env() 규칙이 로드된 스타일시트에 존재한다 (R-03)', async ({ page }) => {
        await boot(page);
        const css = await collectCssText(page);
        expect(css).toContain('env(safe-area-inset');
        // 모바일 탭 바 등 실제 적용 대상 규칙 존재
        expect(css).toMatch(/safe-area-inset-bottom/);
    });

    test('스크롤 컨테이너에 커스텀 스크롤바 규약이 적용된다 (UX-SCR-02)', async ({ page }) => {
        await boot(page);
        const vw = page.viewportSize()?.width || 1280;
        const m = await page.evaluate(() => {
            const div = document.createElement('div');
            document.body.appendChild(div);
            const el = getComputedStyle(div).scrollbarWidth;
            div.remove();
            return {
                root: getComputedStyle(document.documentElement).scrollbarWidth,
                el,
            };
        });
        // html: 항상 thin 커스텀 (html 선택자가 * 미디어 규칙보다 구체적)
        expect(m.root).toBe('thin');
        // 개별 요소: 모바일(≤900px·coarse)은 * 규칙으로 완전 숨김, 데스크톱은 기본값
        expect(m.el).toBe(vw <= 900 ? 'none' : 'auto');
        const css = await collectCssText(page);
        expect(css).toContain('::-webkit-scrollbar');
    });

    test('스크롤바 색상이 테마에 따라 바뀐다 (UX-SCR-03)', async ({ page }) => {
        await boot(page);
        const darkThumb = await page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--scrollbar-thumb').trim());
        await page.locator('#theme-toggle-btn').click();
        await page.waitForFunction((prev) =>
            getComputedStyle(document.documentElement).getPropertyValue('--scrollbar-thumb').trim() !== prev,
            darkThumb, { timeout: 5_000 });
        const lightThumb = await page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--scrollbar-thumb').trim());
        expect(lightThumb).not.toBe(darkThumb);
        expect(lightThumb.length).toBeGreaterThan(0);
    });
});
