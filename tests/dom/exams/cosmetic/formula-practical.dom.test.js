// tests/dom/exams/cosmetic/formula-practical.dom.test.js — 실무 도구 확장 시나리오
// @spec FO-57,FO-58,FO-59,FO-60,FO-62,FO-63
// 설계: docs/dev/design/PRACTICAL_TOOLS_DESIGN.md (DOC-DSN-15)
// 검증: LOT 추적·판매내역서·동의서 인쇄, 이상사례 패널 CRUD,
//       점검 리마인더 배지, 보고서 출력 이력 표시

import { describe, it, beforeEach, expect, vi } from 'vitest';

vi.mock('../../../../src/ui-utils.js', () => ({
    showToast: vi.fn(),
    showConfirm: vi.fn(() => Promise.resolve(true)),
}));

import { loadIndexHtml, el } from '../../helpers.js';
import { setJSON, getJSON } from '../../../../src/storage.js';
import { STORAGE_KEYS } from '../../../../src/storage-keys.js';
import { openMaterialPanel, matTrace, matTracePrint } from '../../../../src/exams/cosmetic/views/formula-material.js';
import { batchPrintSales } from '../../../../src/exams/cosmetic/views/formula-batch.js';
import { openCustomerPanel, custOpen, custPrintConsent } from '../../../../src/exams/cosmetic/views/formula-customer.js';
import { openAdversePanel, advSave, advDelete } from '../../../../src/exams/cosmetic/views/formula-adverse.js';
import { openCompliancePanel } from '../../../../src/exams/cosmetic/views/formula-compliance.js';
import { auditPrintReport } from '../../../../src/exams/cosmetic/views/formula-audit.js';
import { initFormulaView } from '../../../../src/exams/cosmetic/views/formula.js';
import { createMaterial } from '../../../../src/exams/cosmetic/material-ledger.js';
import { createBatch } from '../../../../src/exams/cosmetic/batch-store.js';
import { createCustomer } from '../../../../src/exams/cosmetic/customer-store.js';

const printArea = () => el('formula-print-area');

const INGREDIENTS_STUB = [
    { name: '정제수', engName: 'Water', type: 'approved', category: '용제', description: '', limit: '' },
];

describe('실무 도구 확장 — FO-57~63 시나리오', () => {
    beforeEach(() => {
        localStorage.clear();
        loadIndexHtml();
        window.INGREDIENTS_DATA = INGREDIENTS_STUB;
        window.print = vi.fn();
        // FO-64 — auditPrintReport가 ensureNoticeStatus를 await하므로 네트워크 차단
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    });

    /* ---------- FO-57 LOT 역추적 ---------- */

    it('원료 추적 — 사용 배치·인도 고객 표시 + 추적 목록 인쇄', () => {
        const m = createMaterial({ name: '글리세린', lot: 'A1' }).material;
        createBatch({
            formulaName: '수분 세럼', customerName: '홍길동',
            madeAt: '2026-10-01T10:00', deliveredAt: '2026-10-02',
            materialLots: [{ name: '글리세린', materialId: m.id, lot: 'A1' }],
        });
        openMaterialPanel();
        matTrace(m.id);

        const box = el('material-trace-result');
        expect(box.classList.contains('is-hidden')).toBe(false);
        expect(box.textContent).toContain('사용 추적');
        expect(box.textContent).toContain('홍길동');
        expect(box.textContent).toContain('수분 세럼');

        matTracePrint();
        const html = printArea().innerHTML;
        expect(html).toContain('원료 LOT 사용 추적');
        expect(html).toContain('글리세린');
        expect(html).toContain('홍길동');
        expect(window.print).toHaveBeenCalledTimes(1);
    });

    /* ---------- FO-58 판매내역서 ---------- */

    it('판매내역서 — 인도 완료 건만 포함, 미인도 제외', () => {
        createBatch({ formulaName: '세럼', customerName: '홍길동', madeAt: '2026-10-01T10:00', deliveredAt: '2026-10-03' });
        createBatch({ formulaName: '토너', customerName: '김영희', madeAt: '2026-10-02T10:00' }); // 미인도
        batchPrintSales();
        const html = printArea().innerHTML;
        expect(html).toContain('판매내역서');
        expect(html).toContain('홍길동');
        expect(html).not.toContain('김영희');
        expect(html).toContain('인도 완료 1건');
    });

    /* ---------- FO-59 이상사례 패널 ---------- */

    it('이상사례 — 패널 기록→목록 표시→삭제 왕복', async () => {
        openAdversePanel();
        expect(el('formula-adverse-panel').classList.contains('is-hidden')).toBe(false);

        el('adv-occurred').value = '2026-10-04';
        el('adv-customer-name').value = '홍길동';
        el('adv-product').value = 'B20261001-01 수분 세럼';
        el('adv-symptoms').value = '얼굴 홍반·가려움';
        el('adv-action').value = '사용 중지 안내';
        advSave();

        const list = el('adverse-list');
        expect(list.textContent).toContain('2026-10-04');
        expect(list.textContent).toContain('홍길동');
        expect(list.textContent).toContain('홍반');
        expect(list.textContent).toContain('미보고');
        expect(el('adverse-usage').textContent).toContain('1/30');

        const id = listAdverseId();
        await advDelete(id);
        expect(el('adverse-list').textContent).toContain('기록된 이상사례가 없습니다');
    });

    it('이상사례 — 보고서에 이상사례 섹션 포함', async () => {
        el('adv-occurred').value = '2026-10-04';
        el('adv-symptoms').value = '홍반';
        openAdversePanel();
        advSave();
        await auditPrintReport();
        expect(printArea().innerHTML).toContain('소비자 이상사례 기록');
    });

    /* ---------- FO-60 고객 동의서 ---------- */

    it('고객 동의서 — 알레르기·서명란 포함 인쇄', () => {
        const c = createCustomer({ name: '홍길동', skinType: '건성', allergies: ['파라벤'] }).customer;
        openCustomerPanel();
        custOpen(c.id);
        custPrintConsent(c.id);
        const html = printArea().innerHTML;
        expect(html).toContain('맞춤형화장품 사용 안내·동의서');
        expect(html).toContain('홍길동');
        expect(html).toContain('파라벤');
        expect(html).toContain('고객 서명');
        expect(html).toContain('조제관리사');
    });

    /* ---------- FO-62 점검 리마인더 ---------- */

    it('리마인더 — 30일 경과 시 법규 준수 카드에 재점검 배지', () => {
        setJSON(STORAGE_KEYS.COMPLIANCE_CHECKS, {
            checked: {}, updatedAt: new Date(Date.now() - 40 * 86400000).toISOString(),
        });
        initFormulaView();
        const card = el('formula-menu-panel').querySelector('[data-click="openCompliancePanel"]');
        const badge = card.querySelector('.comp-reminder-badge');
        expect(badge).toBeTruthy();
        expect(badge.textContent).toContain('재점검 권장');
        expect(badge.textContent).toContain('40일 전');
    });

    it('리마인더 — 미시작·최근 점검은 배지 없음', () => {
        initFormulaView(); // 저장 없음
        const card = el('formula-menu-panel').querySelector('[data-click="openCompliancePanel"]');
        expect(card.querySelector('.comp-reminder-badge')).toBeNull();

        setJSON(STORAGE_KEYS.COMPLIANCE_CHECKS, {
            checked: {}, updatedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
        });
        initFormulaView();
        expect(card.querySelector('.comp-reminder-badge')).toBeNull();
    });

    /* ---------- FO-63 보고서 출력 이력 ---------- */

    it('보고서 이력 — 출력 시 기록 + 법규 준수 패널에 표시', async () => {
        await auditPrintReport();
        const log = getJSON(STORAGE_KEYS.FORMULA_AUDIT_LOG);
        expect(log.length).toBe(1);
        expect(log[0].bizLabel).toContain('맞춤형화장품');

        openCompliancePanel();
        const box = el('comp-audit-log');
        expect(box.textContent).toContain('맞춤형화장품');
        expect(box.textContent).toContain('점검');
        expect(box.textContent).not.toContain('출력 이력이 없습니다');
    });

    /* ---------- 허브 카드·서브내비 ---------- */

    it('허브 — 이상사례 카드 존재 + 전 유형 노출', () => {
        const card = el('formula-menu-panel').querySelector('.trainer-menu-card[data-click="openAdversePanel"]');
        expect(card).toBeTruthy();
        expect(card.textContent).toContain('이상사례 기록');
    });
});

function listAdverseId() {
    const raw = getJSON(STORAGE_KEYS.ADVERSE_ITEMS);
    return raw && raw.length ? raw[0].id : null;
}
