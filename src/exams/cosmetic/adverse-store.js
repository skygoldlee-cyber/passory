// src/exams/cosmetic/adverse-store.js — Formula OS 소비자 이상사례(부작용) 기록 (FO-59)
// @spec FO-59
//
// 화장품 사용 후 발생한 이상사례(부작용 의심)를 증적 목적으로 기록한다.
// 화장품법상 위해화장품 회수·보고 상황의 1차 근거 자료 — 발생일·고객·제품·
// 증상·조치·식약처 보고 여부를 남긴다. localStorage `formula_adverse_items`
// (safeGetItem/safeSetItem 경유 → 시험별 네임스페이스 자동 적용).
//
// 스키마:
//   { id:'adv_…', occurredAt:'YYYY-MM-DD', customerId, customerName,
//     product,                                   // 배치번호·제품명 등 자유 표기
//     symptoms, action,                          // 증상·조치 내용
//     reportedAt:'YYYY-MM-DD',                   // 식약처 등 관계기관 보고일 (미보고 '')
//     notes, createdAt, updatedAt }
//
// 기록 원칙: 이상사례는 법적 증적이므로 삭제는 사용자 명시 액션에서만 허용하고,
// 보정(update)은 필드 전체 재정제로 이력 무결성을 유지한다.

import { STORAGE_KEYS } from '../../storage-keys.js';
import {
  loadItems, saveItems, newId, clampStr, clampDate,
} from './store-utils.js';

// Free 플랜 저장 한도
export const ADVERSE_LIMIT_FREE = 30;

const MAX_NAME_LEN = 30;
const MAX_PRODUCT_LEN = 80;
const MAX_TEXT_LEN = 300;
const MAX_NOTE_LEN = 500;

/** 고유 ID 생성: adv_<base36시간><난수> */
function newAdverseId() {
  return newId('adv');
}

function loadAll() {
  return loadItems(STORAGE_KEYS.ADVERSE_ITEMS);
}

function saveAll(items) {
  return saveItems(STORAGE_KEYS.ADVERSE_ITEMS, items);
}

function sanitizeAdverse(data) {
  return {
    occurredAt: clampDate(data.occurredAt),
    customerId: clampStr(data.customerId || '', 40).trim(),
    customerName: clampStr(data.customerName || '', MAX_NAME_LEN).trim(),
    product: clampStr(data.product || '', MAX_PRODUCT_LEN).trim(),
    symptoms: clampStr(data.symptoms || '', MAX_TEXT_LEN).trim(),
    action: clampStr(data.action || '', MAX_TEXT_LEN).trim(),
    reportedAt: clampDate(data.reportedAt),
    notes: clampStr(data.notes || '', MAX_NOTE_LEN).trim(),
  };
}

/** 이상사례 목록 — 발생일 내림차순 */
export function listAdverse() {
  return loadAll().slice().sort((a, b) => String(b.occurredAt || '').localeCompare(String(a.occurredAt || '')));
}

export function getAdverse(id) {
  return loadAll().find(a => a.id === id) || null;
}

/** 저장 한도·현재 개수 */
export function getAdverseUsage() {
  const count = loadAll().length;
  return { count, limit: ADVERSE_LIMIT_FREE, canCreate: count < ADVERSE_LIMIT_FREE };
}

/**
 * 새 이상사례 등록.
 * @returns {{ok:boolean, adverse?:object, error?:string}}
 */
export function createAdverse(data) {
  const usage = getAdverseUsage();
  if (!usage.canCreate) {
    return { ok: false, error: `Free 플랜은 최대 ${usage.limit}건까지 기록할 수 있습니다.` };
  }
  const clean = sanitizeAdverse(data || {});
  if (!clean.occurredAt) return { ok: false, error: '발생일을 입력하세요.' };
  if (!clean.symptoms) return { ok: false, error: '증상을 입력하세요.' };

  const now = Date.now();
  const adverse = { id: newAdverseId(), ...clean, createdAt: now, updatedAt: now };
  const all = loadAll();
  all.push(adverse);
  if (!saveAll(all)) return { ok: false, error: '저장에 실패했습니다.' };
  return { ok: true, adverse };
}

/** 이상사례 보정 — 필드 전체 재정제. @returns {{ok:boolean, adverse?:object, error?:string}} */
export function updateAdverse(id, data) {
  const all = loadAll();
  const idx = all.findIndex(a => a.id === id);
  if (idx < 0) return { ok: false, error: '이상사례 기록을 찾을 수 없습니다.' };
  const clean = sanitizeAdverse(data || {});
  if (!clean.occurredAt) return { ok: false, error: '발생일을 입력하세요.' };
  if (!clean.symptoms) return { ok: false, error: '증상을 입력하세요.' };

  all[idx] = { ...all[idx], ...clean, id, updatedAt: Date.now() };
  if (!saveAll(all)) return { ok: false, error: '저장에 실패했습니다.' };
  return { ok: true, adverse: all[idx] };
}

/** @returns {{ok:boolean, error?:string}} */
export function deleteAdverse(id) {
  const all = loadAll();
  const idx = all.findIndex(a => a.id === id);
  if (idx < 0) return { ok: false, error: '이상사례 기록을 찾을 수 없습니다.' };
  all.splice(idx, 1);
  if (!saveAll(all)) return { ok: false, error: '삭제에 실패했습니다.' };
  return { ok: true };
}
