// tests/dom/exams/cosmetic/formula-audit.dom.test.js — 종합 규정 점검 보고서 시나리오
// @spec FO-56
// 설계: docs/dev/design/AUDIT_REPORT_DESIGN.md (DOC-DSN-14)
// 검증: 보고서 버튼 존재, auditPrintReport→print-area 렌더·print 호출,
//       체크 상태 반영, 유형별 섹션 게이트, 광고 점검 영속 왕복

import { describe, it, beforeEach, expect, vi } from 'vitest';

vi.mock('../../../../src/ui-utils.js', () => ({
    showToast: vi.fn(),
    showConfirm: vi.fn(() => Promise.resolve(true)),
}));

import { loadIndexHtml, el } from '../../helpers.js';
import { getJSON } from '../../../../src/storage.js';
import { STORAGE_KEYS } from '../../../../src/storage-keys.js';
import { openCompliancePanel, compToggle, COMPLIANCE_SECTIONS } from '../../../../src/exams/cosmetic/views/formula-compliance.js';
import { auditPrintReport } from '../../../../src/exams/cosmetic/views/formula-audit.js';
import { adlintRun, adlintClear } from '../../../../src/exams/cosmetic/views/formula-sales.js';
import { setBizType } from '../../../../src/exams/cosmetic/biz-profile.js';
import { invalidateIngredientIndex } from '../../../../src/exams/cosmetic/views/formula.js';
import { createCustomer } from '../../../../src/exams/cosmetic/customer-store.js';

const FIRST_ID = COMPLIANCE_SECTIONS[0].items[0].id;
const printArea = () => el('formula-print-area');

const INGREDIENTS_STUB = [
    { name: '정제수', engName: 'Water', type: 'approved', category: '용제', description: '', limit: '' },
];

describe('종합 규정 점검 보고서 — 출력·영속 시나리오', () => {
    beforeEach(() => {
        localStorage.clear();
        loadIndexHtml();
        window.INGREDIENTS_DATA = INGREDIENTS_STUB;
        window.print = vi.fn();
        invalidateIngredientIndex();
        // FO-64 — auditPrintReport가 ensureNoticeStatus를 await하므로 네트워크 차단
        // (실패 → 고시 스탬프 null → '확인 불가' 폴백 경로 검증)
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    });

    it('패널 헤더에 종합 보고서 버튼 존재', () => {
        openCompliancePanel();
        const btn = el('formula-compliance-panel').querySelector('[data-click="auditPrintReport"]');
        expect(btn).toBeTruthy();
    });

    it('허브 — 분석·법규 도구에 종합 보고서 카드 존재 (발견성)', () => {
        const card = el('formula-menu-panel').querySelector('.trainer-menu-card[data-click="auditPrintReport"]');
        expect(card).toBeTruthy();
        expect(card.textContent).toContain('종합 보고서');
        expect(card.textContent).toContain('보고서 인쇄');
    });

    it('auditPrintReport — print-area 렌더 + window.print 호출', async () => {
        openCompliancePanel();
        compToggle(FIRST_ID);
        await auditPrintReport();

        const html = printArea().innerHTML;
        expect(html).toContain('종합 점검 보고서');
        expect(html).toContain('맞춤형화장품 판매업');
        expect(html).toContain('☑'); // 체크 항목
        expect(html).toContain('법규 준수 체크리스트');
        expect(html).toContain('점검자');
        expect(html).toContain('법률 자문이 아닙니다');
        expect(document.body.classList.contains('formula-printing')).toBe(true);
        expect(window.print).toHaveBeenCalledTimes(1);
    });

    it('광고 점검 — 실행 영속 → 보고서 반영 → 비우기 삭제 (mfg)', async () => {
        setBizType('mfg');
        el('adlint-input').value = '피부 염증을 치료하는 기적의 크림';
        adlintRun();

        const st = getJSON(STORAGE_KEYS.FORMULA_ADLINT_STATE);
        expect(st).toBeTruthy();
        expect(st.hits.length).toBeGreaterThan(0);

        await auditPrintReport();
        const html = printArea().innerHTML;
        expect(html).toContain('광고 문구 점검');
        expect(html).toContain('치료');
        expect(html).toContain('점검 대상 원문');

        adlintClear();
        expect(getJSON(STORAGE_KEYS.FORMULA_ADLINT_STATE)).toBeNull();
    });

    it('sales 유형 — 고객 상담 섹션 포함·포뮬러 섹션 제외', async () => {
        setBizType('sales');
        createCustomer({
            name: '홍길동', skinType: '건성', allergies: ['파라벤'],
            consultLog: [{ date: '2026-10-01', text: '알레르기 상담' }],
        });
        await auditPrintReport();

        const html = printArea().innerHTML;
        expect(html).toContain('고객 상담 기록');
        expect(html).toContain('홍길동');
        expect(html).toContain('알레르기 상담');
        expect(html).toContain('개인정보');
        expect(html).not.toContain('포뮬러 규정 검증'); // sales는 제조 안 함
    });

    it('빈 데이터 — 기록 없음 섹션 표기 + 출력 가능', async () => {
        await auditPrintReport();
        const html = printArea().innerHTML;
        expect(html).toContain('기록 없음');
        expect(html).toContain('0/'); // 체크리스트 0/N
        expect(window.print).toHaveBeenCalledTimes(1);
    });
});
