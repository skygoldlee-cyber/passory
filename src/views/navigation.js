// src/views/navigation.js - 뷰 전환 유틸리티 (순환 import 해결용)
// @spec UX-NAV-07,R-04
// app.js ↔ quiz.js/dashboard.js 순환 의존성을 끊기 위해 별도 모듈로 추출.
import { state } from '../state.js';
import { trackView } from '../usage-stats.js';

const scrollPositions = {};
// 맨 위로 열어야 할 뷰 — restoreScrollPosition이 1회 소비한다
// (navigateToView의 saveScrollPosition이 scrollPositions를 덮어써도 유지되도록 별도 플래그)
const pendingTop = new Set();

// router.js가 initViewHashRouting에서 navigateToView(ctx 바인딩)를 주입한다 —
// nav-item이 없는 뷰(exam-select-view 등)도 제목·해시·렌더 디스패치를
// 동일하게 받을 수 있도록 switchView 폴백을 정식 라우터 경로로 보낸다.
// 순환 import를 피하기 위해 router → navigation 방향의 등록 패턴을 사용.
let _navigateToView = null;
/** @param {function(string): void} fn - navigateToView를 ctx와 바인딩한 함수 */
export function registerViewNavigator(fn) {
    _navigateToView = fn;
}

export function saveScrollPosition(viewId) {
    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
        scrollPositions[viewId] = mainContent.scrollTop;
    }
}

// @spec UX-NAV-07
/**
 * 인트라뷰 패널/문항 전환 시 공유 스크롤 컨테이너를 맨 위로 리셋한다.
 * .main-content는 전 뷰 공유 스크롤 컨테이너라 is-hidden 토글만으로는
 * 이전 화면의 scrollTop이 잔류해 새 화면 상단이 뷰포트 위로 밀린다.
 * 뷰 전환(내비 복귀)은 restoreScrollPosition의 저장/복원 계약이 담당하고,
 * 뷰 안에서 다른 화면을 여는 전환(메뉴→서브패널, 문항 진행 등)은 이 헬퍼로 리셋한다.
 */
export function resetMainScroll() {
    const mainContent = document.querySelector('.main-content');
    if (mainContent) mainContent.scrollTop = 0;
}

// @spec UX-NAV-07
// pendingTop은 saveScrollPosition 덮어쓰기를 무시하는 1회 플래그
export function restoreScrollPosition(viewId) {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;
    if (pendingTop.delete(viewId)) {
        scrollPositions[viewId] = 0;
        requestAnimationFrame(() => { mainContent.scrollTop = 0; });
        return;
    }
    if (scrollPositions[viewId] !== undefined) {
        requestAnimationFrame(() => {
            mainContent.scrollTop = scrollPositions[viewId];
        });
    }
}

// ROAD-Q3 — 뷰 렌더 세대 토큰 (ROAD-Q*는 spec 태그 규격상 태그 불가 — 주석 표기).
// navigateToView가 전환마다 세대를 증가시키고 렌더러에
// gen을 전달한다. 비동기 렌더(데이터 로드 .then/await 재개 지점)는
// isStaleViewGen(gen)으로 자기 세대가 살아있는지 판정해, 이전 뷰의 늦은
// 완료가 새 뷰의 DOM·로딩 오버레이·토스트를 덮는 경합을 차단한다.
let _viewRenderGen = 0;

/** 뷰 렌더 세대를 1 증가시키고 새 세대 토큰을 반환한다 (router 전용). */
export function bumpViewGen() {
    return ++_viewRenderGen;
}

/**
 * 전달된 세대 토큰이 현재 유효한 세대보다 오래됐는가.
 * 비동기 렌더 재개 지점에서 `if (isStaleViewGen(gen)) return;`로 사용한다.
 * @param {number} gen - 렌더 발화 시점에 bumpViewGen()이 반환한 세대
 * @returns {boolean} 이후 뷰 전환이 발생해 무효화됐으면 true
 */
export function isStaleViewGen(gen) {
    return gen !== _viewRenderGen;
}

/**
 * 뷰 전환. opts.scrollTop=true이면 타겟 뷰를 저장된 스크롤이 아닌 맨 위에서 연다
 * (예: 대시보드 "맞춤학습 보기"처럼 문서형 화면으로의 딥링크).
 */
// @spec UX-NAV-07
// opts.scrollTop 딥링크 시 저장된 위치 대신 맨 위 오픈
export function switchView(targetView, opts = {}) {
    // 리더 화면을 벗어나면 재생 중인 오디오 정지
    if (targetView !== 'textbook-reader-view' && typeof window.stopReaderAudio === 'function') {
        window.stopReaderAudio();
    }

    if (opts.scrollTop) pendingTop.add(targetView);

    const navItem = document.querySelector(`.nav-item[data-target="${targetView}"]`);
    if (navItem) {
        // click() 핸들러가 saveScrollPosition/restoreScrollPosition을 포함하므로
        // 여기서는 중복 호출하지 않고 click만 트리거
        /** @type {HTMLElement} */ (navItem).click();
    } else if (_navigateToView) {
        // nav-item이 없는 뷰(exam-select-view) — 라우터 경로로 위임해
        // 제목·해시·렌더 디스패치·aria 동기화를 navigateToView와 동일하게 적용
        _navigateToView(targetView);
    } else {
        // 라우터 미초기화 환경(단위 테스트 등) — 최소 토글만 수행
        saveScrollPosition(state.currentView);
        const target = document.getElementById(targetView);
        if (target) {
            document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
            target.classList.add('active');
        }
        state.currentView = targetView;
        restoreScrollPosition(targetView);
    }
    trackView(targetView);
}
