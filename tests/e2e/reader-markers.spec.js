// tests/e2e/reader-markers.spec.js — 리더 마커·다이어그램·링크 파이프라인 실측 (실브라우저)
// @spec TR-05,TR-07,TR-08,TR-09,TR-13,UX-FB-03
// 기출·중요 하이라이트 카드, Mermaid 유형별 클래스 렌더·내부 링크 보호,
// 마크다운 링크 변환, 과목 전환 즉시 저장·진도 초기화, 첫 방문 엣지 힌트 펄스를 검증한다.

import { test, expect } from '@playwright/test';

async function openReader(page, optionIndex = 1) {
    await page.goto('/index.html');
    await page.waitForFunction(() => window.__APP_INITIALIZED === true, null, { timeout: 15_000 });
    await page.evaluate(() => {
        document.querySelectorAll('#app-confirm-overlay, #onboarding-overlay').forEach(el => el.remove());
        location.hash = '/reader';
    });
    await expect(page.locator('#reader-subject-select')).toBeVisible({ timeout: 15_000 });
    await page.locator('#reader-subject-select').selectOption({ index: optionIndex });
    await expect(page.locator('#reader-toc-list .reader-toc-item').first()).toBeVisible({ timeout: 30_000 });
    await page.waitForFunction(() =>
        document.querySelectorAll('#textbook-reader-container .reader-section-card').length > 0,
        null, { timeout: 30_000 });
}

function readPosition(page) {
    return page.evaluate(() =>
        JSON.parse(localStorage.getItem('cosmetic:readerLastPosition') || localStorage.getItem('readerLastPosition') || 'null'));
}

test.beforeEach(({ page }) => {
    page.addInitScript(() => {
        localStorage.setItem('current_exam', 'cosmetic');
        localStorage.setItem('onboarding_seen_v1', '1');
        localStorage.setItem('cosmetic:onboarding_seen_v1', '1');
    });
    page._errors = [];
    page.on('pageerror', err => page._errors.push(String(err)));
});

test.describe('리더 마커·다이어그램 파이프라인', () => {
    test('기출·중요 마커가 하이라이트 카드로 추출·강조된다 (TR-05)', async ({ page }) => {
        test.setTimeout(60_000);
        await openReader(page, 1); // 1과목(law) — 🔖기출/📌중요 마커 + number-drills isKey 항목 존재
        // ① 소스 마커 추출 카드 — 🔖기출/📌중요 라인이 '기출 핵심' 카드로 집계
        const hl = page.locator('#exam-highlight-card');
        await expect(hl).toBeVisible({ timeout: 15_000 });
        const hm = await page.evaluate(() => ({
            items: document.querySelectorAll('#exam-highlight-card .exam-highlight-list li').length,
            // 카드 본문에는 마커 자체가 정제되어 있어야 함
            raw: document.querySelector('#exam-highlight-card')?.textContent || '',
        }));
        expect(hm.items).toBeGreaterThan(0);
        expect(hm.raw).not.toContain('🔖기출');
        expect(hm.raw).not.toContain('📌중요');

        // ② 숫자 암기표의 기출·중요 섹션 — isKey 데이터가 별도 강조 영역으로 렌더
        const card = page.locator('#number-drill-card');
        await expect(card).toBeVisible({ timeout: 15_000 });
        const m = await page.evaluate(() => ({
            keySection: document.querySelectorAll('#number-drill-card .number-drill-key-section').length,
            keyItems: document.querySelectorAll('#number-drill-card .number-drill-item.is-key').length,
            title: document.querySelector('#number-drill-card .number-drill-section-title')?.textContent || '',
        }));
        expect(m.keySection).toBeGreaterThan(0);
        expect(m.keyItems).toBeGreaterThan(0);
        expect(m.title).toContain('기출');
    });

    test('Mermaid가 유형별 클래스를 받아 svg로 렌더된다 (TR-07)', async ({ page }) => {
        test.setTimeout(90_000);
        await openReader(page, 2); // 2과목 — 마인드맵 다이어그램 포함
        // vendor/mermaid 지연 로딩 + 순차 렌더 — 첫 svg까지 폴링
        await page.waitForFunction(() =>
            document.querySelector('#textbook-reader-container pre.mermaid svg') !== null,
            null, { timeout: 60_000 });
        const typed = await page.evaluate(() =>
            [...document.querySelectorAll('#textbook-reader-container pre.mermaid')]
                .map(p => [...p.classList].find(c => c.startsWith('mermaid-') && c !== 'mermaid-zoom-content'))
                .filter(Boolean));
        expect(typed.length).toBeGreaterThan(0);
        expect(typed).toContain('mermaid-mindmap');
        expect(page._errors.filter(e => !/favicon|manifest/i.test(e))).toEqual([]);
    });

    test('Mermaid 노드 안에는 링크가 삽입되지 않는다 (TR-08)', async ({ page }) => {
        test.setTimeout(90_000);
        await openReader(page, 2);
        await page.waitForFunction(() =>
            document.querySelector('#textbook-reader-container pre.mermaid svg') !== null,
            null, { timeout: 60_000 });
        // 키워드 링크 파이프라인이 mermaid 블록을 건너뛰어야 — 내부 <a> 0건
        const linksInside = await page.evaluate(() =>
            document.querySelectorAll('#textbook-reader-container pre.mermaid a').length);
        expect(linksInside).toBe(0);
    });

    test('마크다운 링크가 앵커로 변환된다 (TR-09)', async ({ page }) => {
        test.setTimeout(60_000);
        await openReader(page, 1);
        const m = await page.evaluate(() => ({
            sourceLinks: document.querySelectorAll('#textbook-reader-container a.source-link').length,
            crossLinks: document.querySelectorAll('#textbook-reader-container a.cross-subject-link').length,
        }));
        // [t](../참조자료/...) → a.source-link, [t](subj:...) → a.cross-subject-link
        expect(m.sourceLinks + m.crossLinks).toBeGreaterThan(0);
    });

    test('과목 전환 시 위치가 즉시 저장되고 진도 초기화로 제거된다 (TR-13)', async ({ page }) => {
        test.setTimeout(90_000);
        await openReader(page, 1);
        const firstValue = await page.locator('#reader-subject-select').inputValue();
        // 과목 전환 → change 핸들러가 saveReaderPosition() 동기 호출
        await page.locator('#reader-subject-select').selectOption({ index: 2 });
        await page.waitForFunction(() =>
            document.querySelectorAll('#textbook-reader-container .reader-section-card').length > 0,
            null, { timeout: 30_000 });
        const newValue = await page.locator('#reader-subject-select').inputValue();
        expect(newValue).not.toBe(firstValue);
        const pos = await readPosition(page);
        expect(pos).toBeTruthy();
        expect(pos.subject).toBe(newValue);

        // 진도 초기화 → 커스텀 확인 모달 → 확인 → 위치 키 제거
        await page.locator('#settings-toggle-btn').click();
        await page.locator('#reset-progress-btn').click();
        await expect(page.locator('#app-confirm-overlay')).toBeVisible({ timeout: 5_000 });
        await page.locator('.app-confirm-ok').click();
        await page.waitForFunction(() =>
            !localStorage.getItem('cosmetic:readerLastPosition') && !localStorage.getItem('readerLastPosition'),
            null, { timeout: 5_000 });
    });

    test('최초 방문 시 엣지 힌트에 펄스 클래스가 붙고 재방문 시 붙지 않는다 (UX-FB-03)', async ({ page }) => {
        test.setTimeout(90_000);
        await openReader(page, 1);
        const hint = page.locator('#reader-toc-edge-hint');
        await expect(hint).toHaveCount(1);
        // 미열람(ui_toc_hint_seen 없음) → is-attention 부여
        await expect(hint).toHaveClass(/is-attention/, { timeout: 10_000 });

        // 모바일(≤900px)에서 힌트가 표시될 때만 애니메이션이 끝나 seen 플래그가 기록된다
        const vw = page.viewportSize()?.width || 1280;
        if (vw <= 900) {
            await page.waitForFunction(() =>
                localStorage.getItem('ui_toc_hint_seen') === '1', null, { timeout: 15_000 });
            await expect(page.locator('#reader-toc-edge-hint')).not.toHaveClass(/is-attention/);
            // 재방문 → 펄스 없음
            await page.reload();
            await page.waitForFunction(() => window.__APP_INITIALIZED === true, null, { timeout: 15_000 });
            await page.evaluate(() => {
                document.querySelectorAll('#app-confirm-overlay, #onboarding-overlay').forEach(el => el.remove());
                location.hash = '/reader';
            });
            await expect(page.locator('#reader-toc-list .reader-toc-item').first()).toBeVisible({ timeout: 30_000 });
            await page.waitForTimeout(1_000);
            await expect(page.locator('#reader-toc-edge-hint')).not.toHaveClass(/is-attention/);
        }
    });
});
