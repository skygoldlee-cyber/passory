// tests/dom/formula-products.dom.test.js — 기성품 전성분 DB 시나리오
// @spec FO-37,FO-38,FO-39,FO-40,FO-41,FO-42,FO-43
// 설계: docs/dev/design/DOM_TEST_DESIGN.md §4 · docs/dev/design/PRODUCT_DB_DESIGN.md
//       · docs/dev/design/PRODUCT_VISION_DESIGN.md
// 검증: 허브 카드·목록, 붙여넣기→칩 미리보기(자릿수 쉼표·미등록 칩), 저장→상세 분석,
//       미등록 칩 '사전 등록' 단축(FO-32 재사용), 성분 필터 역조회,
//       고객 알레르기 교차, 포뮬러 전성분 비교, JSON 임포트·익스포트,
//       사진 인식 인입(키 관리·슬롯·프리필·오류 경로 — vision 모듈은 부분 모킹)

import { describe, it, beforeEach, expect, vi } from 'vitest';

vi.mock('../../../../src/ui-utils.js', () => ({
    showToast: vi.fn(),
    showConfirm: vi.fn(() => Promise.resolve(true)),
}));

// vision 모듈 — 키·마스킹 등 실구현 유지, I/O 경계 2개만 모킹 (jsdom은 canvas 없음)
vi.mock('../../../../src/exams/cosmetic/product-vision.js', async (importActual) => {
    const actual = await importActual();
    return {
        ...actual,
        fileToBase64Jpeg: vi.fn(async () => ({ ok: true, data: 'aGVsbG8=', mimeType: 'image/jpeg', width: 100, height: 100 })),
        extractProductFromImages: vi.fn(async () => ({
            ok: true, name: '인식크림', brand: 'AI랩',
            ingredients: ['정제수', '1,2-헥산디올', '미등록원료'],
        })),
    };
});

import { showToast, showConfirm } from '../../../../src/ui-utils.js';
import {
    loadIndexHtml, el, isVisible, selectFile, flushAsync, lastToast, spyAnchorDownload,
} from '../../helpers.js';
import { invalidateIngredientIndex } from '../../../../src/exams/cosmetic/views/formula.js';
import {
    openProductPanel, productNew, productEdit, productSave,
    productDelete, productClearFilter, productOpenByIngredient,
    productCardExport, productImportJson,
    productVisionToggle, productPhotoPick, productPhotoRemove,
    productVisionRead, productVisionKeySave, productVisionKeyClear,
} from '../../../../src/exams/cosmetic/views/formula-products.js';
import { listProducts } from '../../../../src/exams/cosmetic/product-store.js';
import {
    getVisionKey, extractProductFromImages,
} from '../../../../src/exams/cosmetic/product-vision.js';
import { createFormula } from '../../../../src/exams/cosmetic/formula-store.js';
import { createCustomer } from '../../../../src/exams/cosmetic/customer-store.js';
import { custOpen } from '../../../../src/exams/cosmetic/views/formula-customer.js';

// 원료 DB 스텁 — getIndex()가 모듈 싱글턴으로 1회 구축되므로 컨트롤러 호출 전 주입
const INGREDIENTS_STUB = [
    { name: '정제수', engName: 'Water', type: 'approved', category: '베이스', description: '', limit: '' },
    { name: '살리실산', engName: 'Salicylic Acid', type: 'restricted', category: '각질', description: '', limit: '2.0%' },
    { name: '사용금지원료', engName: 'Banned X', type: 'banned', category: '기타', description: '', limit: '사용 금지' },
];

function setInciInput(text) {
    const ta = el('prod-inci-input');
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('기성품 DB — 목록·등록·상세 분석', () => {
    beforeEach(() => {
        localStorage.clear();
        window.INGREDIENTS_DATA = INGREDIENTS_STUB;
        invalidateIngredientIndex();
        loadIndexHtml();
        vi.mocked(showToast).mockClear();
        vi.mocked(showConfirm).mockClear();
        vi.mocked(showConfirm).mockResolvedValue(true);
    });

    it('허브 카드 — 기성품 분석 카드가 전 유형에 노출 (data-biz 미선언)', () => {
        expect(document.querySelector('[data-click="openProductPanel"]')).toBeTruthy();
        const card = [...document.querySelectorAll('#formula-menu-panel .trainer-menu-card')]
            .find(c => c.dataset.click === 'openProductPanel');
        expect(card.dataset.biz).toBeUndefined(); // 미선언 = 전 유형 공용
    });

    it('허브 레이아웃 — 2그룹 분리, 기성품 카드는 분석·법규 그룹 선두', () => {
        const groups = document.querySelectorAll('#formula-menu-panel .formula-hub-group-title');
        expect(groups.length).toBe(2);
        const grids = document.querySelectorAll('#formula-menu-panel .trainer-menu-grid');
        expect(grids.length).toBe(2);
        // 업무 흐름 그룹 = ①~⑤ 5카드
        expect(grids[0].querySelectorAll('.trainer-menu-card').length).toBe(5);
        // 분석·법규 그룹 첫 카드 = 기성품 분석
        const second = grids[1].querySelectorAll('.trainer-menu-card');
        expect(second[0].dataset.click).toBe('openProductPanel');
        expect(second[0].querySelector('h4').textContent).toContain('기성품');
    });

    it('빈 상태 → 등록 폼 → 붙여넣기 칩 → 저장 → 상세 분석', () => {
        openProductPanel();
        expect(el('product-list').innerHTML).toContain('등록된 기성품이 없습니다');

        productNew();
        expect(isVisible('formula-product-form-panel')).toBe(true);
        // 제형 콤보는 소수치용 unit 축소 클래스가 아닌 일반 폭이어야 텍스트가 안 잘림
        expect(el('prod-category').closest('.formula-field').classList.contains('formula-field-unit')).toBe(false);
        el('prod-name').value = '수분 크림';
        el('prod-brand').value = 'OO랩';
        setInciInput('정제수, 살리실산, 1,2-헥산디올·우리집비법원료');

        const chips = el('prod-inci-chips');
        expect(chips.textContent).toContain('정제수');
        expect(chips.textContent).toContain('1,2-헥산디올'); // 자릿수 쉼표 보호
        expect(chips.textContent).toContain('우리집비법원료');
        expect(el('prod-inci-count').textContent).toContain('성분 4종');
        expect(el('prod-inci-count').textContent).toContain('미등록 2종');

        productSave();
        expect(isVisible('formula-product-detail-panel')).toBe(true);
        expect(listProducts().length).toBe(1);
        const detail = el('product-detail').innerHTML;
        expect(detail).toContain('수분 크림');
        expect(detail).toContain('공식 등록 1');
        expect(detail).toContain('사용 제한 1');
        expect(detail).toContain('DB 미등록 2');
        expect(detail).toContain('조회 시점 원료 DB 기준');
    });

    it('미등록 칩 — 사전 등록 단축 버튼 노출 (FO-32 재사용)', () => {
        productNew();
        setInciInput('정제수, 미등록원료A');
        const regBtn = el('prod-inci-chips').querySelector('[data-click="productIngRegister"]');
        expect(regBtn).toBeTruthy();
        expect(regBtn.dataset.arg).toBe('미등록원료A');
    });

    it('목록 카드 — 요약 배지 + 검색 필터', () => {
        productNew();
        el('prod-name').value = 'A크림';
        setInciInput('정제수, 사용금지원료, 미등록원료');
        productSave();

        openProductPanel();
        const list = el('product-list').innerHTML;
        expect(list).toContain('A크림');
        expect(list).toContain('금지매칭 1');
        expect(list).toContain('미등록 1');
        expect(el('product-list-usage').textContent).toBe('1/30 등록');

        el('product-search').value = '사용금지원료';
        el('product-search').dispatchEvent(new Event('input', { bubbles: true }));
        expect(el('product-list').innerHTML).toContain('A크림');
        el('product-search').value = '없는검색어';
        el('product-search').dispatchEvent(new Event('input', { bubbles: true }));
        expect(el('product-list').innerHTML).toContain('조건에 맞는 제품이 없습니다');
    });

    it('수정 — 폼에 기존 값 프리필 + 저장 시 상세 갱신', () => {
        productNew();
        el('prod-name').value = 'A크림';
        setInciInput('정제수');
        productSave();
        const id = listProducts()[0].id;

        productEdit(id);
        expect(el('product-form-title').textContent).toBe('기성품 수정');
        expect(el('prod-name').value).toBe('A크림');
        expect(el('prod-inci-input').value).toBe('정제수');
        setInciInput('정제수, 살리실산');
        productSave();
        expect(el('product-detail').innerHTML).toContain('성분 2종');
    });

    it('삭제 — confirm 승인 시 목록에서 제거', async () => {
        productNew();
        el('prod-name').value = 'A크림';
        setInciInput('정제수');
        productSave();
        const id = listProducts()[0].id;

        await productDelete(id);
        await flushAsync();
        expect(listProducts().length).toBe(0);
        expect(isVisible('formula-product-panel')).toBe(true);
    });

    it('사전 역조회 — productOpenByIngredient가 성분 필터로 목록 표시', () => {
        productNew();
        el('prod-name').value = 'A크림';
        setInciInput('정제수, 메칠파라벤');
        productSave();
        productNew();
        el('prod-name').value = 'B로션';
        setInciInput('정제수');
        productSave();

        productOpenByIngredient('메칠파라벤');
        expect(isVisible('formula-product-panel')).toBe(true);
        expect(el('product-filter-chip').innerHTML).toContain('메칠파라벤');
        const listHtml = el('product-list').innerHTML;
        expect(listHtml).toContain('A크림');
        expect(listHtml).not.toContain('B로션');

        productClearFilter();
        expect(el('product-list').innerHTML).toContain('B로션');
    });

    it('고객 알레르기 교차 — 상세에 매칭 경고 + 고객 카드에 주의 제품', () => {
        const r = createCustomer({ name: '김OO', allergies: ['파라벤'] });
        productNew();
        el('prod-name').value = 'A크림';
        setInciInput('정제수, 메칠파라벤');
        productSave();

        const detail = el('product-detail').innerHTML;
        expect(detail).toContain('김OO');
        expect(detail).toContain('메칠파라벤');

        // 고객 상세에도 '알레르기 주의 기성품' 역방향 섹션
        const cid = r.customer.id;
        custOpen(cid);
        const custHtml = el('customer-detail').innerHTML;
        expect(custHtml).toContain('알레르기 주의 기성품');
        expect(custHtml).toContain('A크림');
        expect(custHtml).toContain('메칠파라벤');
    });

    it('포뮬러 비교 — 공통/제품만/포뮬러만 3분할 렌더', () => {
        // fullIngredients는 stability '양호' 시 저장 단계에서 자동 생성된다
        createFormula({
            name: '내 세럼', targetVolume: 100, unit: 'ml',
            ingredients: [{ name: '정제수', concentration: 95 }, { name: '글리세린', concentration: 5 }],
            stability: { result: '양호' },
        });
        productNew();
        el('prod-name').value = 'A크림';
        setInciInput('정제수, 글리세린, 판테놀');
        productSave();

        const sel = el('prod-compare-select');
        expect(sel).toBeTruthy();
        sel.value = sel.options[1].value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        const cmp = el('prod-compare-result').innerHTML;
        expect(cmp).toContain('공통 성분');
        expect(cmp).toContain('정제수');
        expect(cmp).toContain('이 제품에만');
        expect(cmp).toContain('판테놀');
    });

    it('JSON 보내기 — 다운로드 트리거 + 토스트', () => {
        productNew();
        el('prod-name').value = 'A크림';
        setInciInput('정제수');
        productSave();
        const id = listProducts()[0].id;

        const dl = spyAnchorDownload();
        productCardExport(id);
        dl.restore();
        expect(dl.clicks.length).toBe(1);
        expect(dl.clicks[0].download).toMatch(/^product_.*\.json$/);
        expect(lastToast()[0]).toContain('다운로드');
    });

    it('JSON 가져오기 — 파일 선택 → 등록 + 목록 갱신', async () => {
        productImportJson(); // change 리스너 바인딩
        const payload = JSON.stringify({
            type: 'formula-os-product', version: 1,
            product: { name: '가져온크림', brand: 'B사', ingredients: ['정제수', '살리실산'] },
        });
        selectFile('product-file-input', new File([payload], 'p.json', { type: 'application/json' }));
        await flushAsync();

        expect(listProducts().length).toBe(1);
        expect(listProducts()[0].name).toBe('가져온크림');
        expect(lastToast()[1]).toBe('success');
    });
});

describe('기성품 사진 인식 — BYOK 키·슬롯·프리필 (FO-41~43)', () => {
    beforeEach(() => {
        localStorage.clear();
        window.INGREDIENTS_DATA = INGREDIENTS_STUB;
        invalidateIngredientIndex();
        loadIndexHtml();
        vi.mocked(showToast).mockClear();
        vi.mocked(extractProductFromImages).mockClear();
    });

    it('사진 패널 토글 — 키 미설정 시 키 블록 자동 펼침, 읽기 버튼 비활성', () => {
        productNew();
        const btn = document.querySelector('[data-click="productVisionToggle"]');
        expect(btn).toBeTruthy();
        productVisionToggle();
        expect(isVisible('prod-photo-panel')).toBe(true);
        expect(btn.getAttribute('aria-expanded')).toBe('true');
        expect(el('prod-key-block').open).toBe(true);       // 키 미설정 → 자동 펼침
        expect(el('prod-vision-read').disabled).toBe(true); // 후면 사진 없음
        expect(el('prod-key-state').textContent).toContain('미설정');
    });

    it('API 키 저장 — 마스킹 상태 표시 + 삭제 복귀', () => {
        productNew();
        productVisionToggle();
        el('prod-gemini-key').value = 'AIza1234567890abcd';
        productVisionKeySave();
        expect(getVisionKey()).toBe('AIza1234567890abcd');
        expect(el('prod-gemini-key').value).toBe('');      // 입력란 비움
        expect(el('prod-key-state').textContent).toContain('설정됨');
        expect(el('prod-key-state').textContent).not.toContain('123456'); // 중간부 비노출
        productVisionKeyClear();
        expect(getVisionKey()).toBe('');
    });

    it('사진 선택 → 후면 슬롯 썸네일·읽기 활성 → 제거 복귀', async () => {
        productNew();
        productVisionToggle();
        productPhotoPick('back');   // change 리스너 바인딩
        selectFile('prod-photo-back', new File(['x'], 'back.jpg', { type: 'image/jpeg' }));
        await flushAsync();

        expect(el('prod-photo-back-thumb').querySelector('img')).toBeTruthy();
        expect(el('prod-vision-read').disabled).toBe(false);

        productPhotoRemove('back');
        expect(el('prod-photo-back-thumb').innerHTML).toBe('');
        expect(el('prod-vision-read').disabled).toBe(true);
    });

    it('AI 읽기 — 추출 결과를 폼 칩으로 프리필 + 참조 썸네일 (직접 저장 아님)', async () => {
        productNew();
        el('prod-gemini-key').value = 'test-key';
        productVisionKeySave();
        productPhotoPick('back');
        selectFile('prod-photo-back', new File(['x'], 'back.jpg', { type: 'image/jpeg' }));
        await flushAsync();

        await productVisionRead();

        expect(vi.mocked(extractProductFromImages)).toHaveBeenCalledTimes(1);
        expect(el('prod-name').value).toBe('인식크림');
        expect(el('prod-brand').value).toBe('AI랩');
        const chips = el('prod-inci-chips');
        expect(chips.textContent).toContain('1,2-헥산디올');
        expect(chips.textContent).toContain('미등록원료');
        expect(chips.querySelector('[data-click="productIngRegister"]')).toBeTruthy(); // 미등록 칩 단축 유지
        expect(el('prod-photo-ref').querySelector('img')).toBeTruthy();               // 원본 대조 썸네일
        expect(el('prod-vision-status').textContent).toContain('대조');
        expect(listProducts().length).toBe(0);                                        // 자동 저장 없음

        // 사용자 검토 후 저장 — 기존 경로 그대로
        productSave();
        expect(listProducts().length).toBe(1);
        expect(listProducts()[0].name).toBe('인식크림');
    });

    it('AI 읽기 실패 — 오류 상태 표시 + 폼 오염 없음', async () => {
        vi.mocked(extractProductFromImages).mockResolvedValueOnce({
            ok: false, code: 'unreadable', error: '전성분을 읽지 못했습니다',
        });
        productNew();
        el('prod-gemini-key').value = 'test-key';
        productVisionKeySave();
        el('prod-name').value = '기존입력';
        productPhotoPick('back');
        selectFile('prod-photo-back', new File(['x'], 'back.jpg', { type: 'image/jpeg' }));
        await flushAsync();

        await productVisionRead();

        expect(el('prod-vision-status').textContent).toContain('읽지 못했습니다');
        expect(el('prod-vision-status').classList.contains('is-error')).toBe(true);
        expect(el('prod-name').value).toBe('기존입력'); // 프리필 덮어쓰기 없음
        expect(listProducts().length).toBe(0);
    });

    it('키 미설정 상태로 읽기 — 키 블록 펼침 안내, 호출 없음', async () => {
        productNew();
        productVisionToggle();
        el('prod-key-block').open = false;
        productPhotoPick('back');
        selectFile('prod-photo-back', new File(['x'], 'back.jpg', { type: 'image/jpeg' }));
        await flushAsync();

        await productVisionRead();

        expect(vi.mocked(extractProductFromImages)).not.toHaveBeenCalled();
        expect(el('prod-key-block').open).toBe(true);
        expect(el('prod-vision-status').textContent).toContain('API 키');
    });
});
