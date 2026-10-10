// textbook-edition.js — 교재 개정 감지 배너 (대시보드)
// @spec P-14
//
// manifest.textbookEdition이 registry.textbookEdition으로 전파된다. 앱 부팅 시
// 기기 로컬의 마지막 확인 판본(textbook_edition_seen — scopedKey로 시험별 격리)과
// 비교해, 교재가 개정된 뒤 첫 진입에만 대시보드 배너를 띄운다.
// '확인'을 누르면 현재 판본을 기록해 다음 개정까지 억제한다.

import { getItem, setItem } from './storage.js';
import { STORAGE_KEYS } from './storage-keys.js';

/** 판본 라벨이 새로운지 판정 — 미선언·동일 판본·기록 없는 환경은 false (순수 함수 — 테스트용) */
export function isTextbookEditionNew(edition, seenEdition) {
  return !!edition && edition !== seenEdition;
}

/** 대시보드 상단에 교재 개정 배너를 표시한다. 표시 요건이 아니면 아무 동작도 하지 않는다. */
export function checkTextbookEditionBanner() {
  const el = document.getElementById('textbook-edition-banner');
  if (!el || !el.classList.contains('is-hidden')) return;
  const edition = (typeof window !== 'undefined') ? window.DATA_REGISTRY?.textbookEdition : undefined;
  if (!isTextbookEditionNew(edition, getItem(STORAGE_KEYS.TEXTBOOK_EDITION_SEEN))) return;

  const desc = document.getElementById('textbook-edition-desc');
  if (desc) {
    desc.textContent = `교재가 ${edition}판으로 갱신됐습니다. 요약정리·교재 검색·문제은행이 최신 교재 기준입니다.`;
  }
  el.classList.remove('is-hidden');
  document.getElementById('textbook-edition-dismiss')?.addEventListener('click', () => {
    setItem(STORAGE_KEYS.TEXTBOOK_EDITION_SEEN, edition);
    el.classList.add('is-hidden');
  }, { once: true });
}
