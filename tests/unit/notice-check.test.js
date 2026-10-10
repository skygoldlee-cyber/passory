// tests/unit/notice-check.test.js — 식약처 고시 감지 배너 판정 로직
// @spec FO-24,RR-19,DI-11
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isNewerNotice, normalizeNotice, findNoticeNumber, statusRows, parseRefDoc,
         filterIngredientDocs, dictNoticeDocs, dictNoticeRow } from '../../src/notice-check.js';

const base = { notice: '제2026-19호', effectiveDate: '2026-03-18' };
const status = (latest, baseline = base) => ({ baseline, latest });

describe('isNewerNotice', () => {
    it('latest 시행일이 baseline보다 크면 true', () => {
        assert.equal(isNewerNotice(status({ notice: '제2026-30호', effectiveDate: '2026-09-01' })), true);
    });
    it('같은 시행일이면 false', () => {
        assert.equal(isNewerNotice(status({ notice: '제2026-19호', effectiveDate: '2026-03-18' })), false);
    });
    it('latest가 더 오래됐으면 false', () => {
        assert.equal(isNewerNotice(status({ notice: '제2025-63호', effectiveDate: '2025-09-02' })), false);
    });
    it('시행일이 비어 있으면 고시번호로 비교', () => {
        const st = { baseline: { notice: '제2026-19호' }, latest: { notice: '제2026-25호' } };
        assert.equal(isNewerNotice(st), true);
        const st2 = { baseline: { notice: '제2026-19호' }, latest: { notice: '제2026-19호' } };
        assert.equal(isNewerNotice(st2), false);
    });
    it('latest/baseline 누락 시 false', () => {
        assert.equal(isNewerNotice({}), false);
        assert.equal(isNewerNotice(status(null)), false);
        assert.equal(isNewerNotice(null), false);
    });
    it('날짜·번호 모두 판정 불가면 false', () => {
        assert.equal(isNewerNotice(status({ notice: '알 수 없음' }, { notice: '없음' })), false);
    });
});

describe('normalizeNotice', () => {
    it('다양한 표기를 제YYYY-N호로 정규화', () => {
        assert.equal(normalizeNotice('제2026-19호'), '제2026-19호');
        assert.equal(normalizeNotice('2026-19'), '제2026-19호');
        assert.equal(normalizeNotice('제 2026 - 19 호'), '제2026-19호');
        assert.equal(normalizeNotice('제2025-1호'), '제2025-1호');
    });
    it('고시번호 형태가 아니면 null', () => {
        assert.equal(normalizeNotice('2100000276068'), null);
        assert.equal(normalizeNotice(''), null);
        assert.equal(normalizeNotice(null), null);
    });
});

describe('findNoticeNumber', () => {
    it('공포번호 필드에서 최신 고시번호 추출', () => {
        const detail = {
            AdmRulService: {
                행정규칙: {
                    기본정보: { 행정규칙명: '화장품 안전기준 등에 관한 규정' },
                    발령고시: { 공포번호: '제2025-63호', 공포일자: '20250902' },
                    개정고시: [{ 공포번호: '제2026-19호', 공포일자: '20260318' }],
                },
            },
        };
        assert.equal(findNoticeNumber(detail), '제2026-19호');
    });
    it('필드가 없으면 본문 텍스트의 제YYYY-N호 패턴으로 폴백', () => {
        assert.equal(findNoticeNumber({ 본문: '… 식약처고시 제2026-19호(2026.3.18) …' }), '제2026-19호');
    });
    it('고시번호를 찾지 못하면 null', () => {
        assert.equal(findNoticeNumber({ 행정규칙일련번호: '2100000276068' }), null);
    });
});

describe('statusRows', () => {
    it('상태 파일을 표시용 4행으로 변환', () => {
        const rows = statusRows({
            baseline: { notice: '제2026-19호', effectiveDate: '2026-03-18' },
            latest: { notice: '제2026-19호', effectiveDate: '2026-03-18', serialNo: '2100000276068' },
            checkedAt: '2026-09-28T14:00:00+00:00',
            newerFound: false,
        });
        assert.equal(rows.length, 4);
        assert.match(rows[0][1], /제2026-19호/);
        assert.match(rows[1][1], /일련번호 2100000276068/);
        assert.equal(rows[3][1], '없음');
    });
    it('newerFound면 신규 고시 경고 표기', () => {
        const rows = statusRows({ baseline: {}, latest: {}, newerFound: true });
        assert.match(rows[3][1], /있음/);
    });
    it('parseRefDoc — 파일명에서 공식명·기준 고시·API 유형 추출', () => {
        const law = parseRefDoc('화장품법(법률)(제21525호)(20261008).pdf');
        assert.equal(law.name, '화장품법');
        assert.equal(law.target, 'law');
        assert.equal(law.baselineNotice, '제21525호');
        assert.equal(law.baselineDate, '2026-10-08');
        const adm = parseRefDoc('화장품 안전기준 등에 관한 규정(식품의약품안전처고시)(제2026-19호)(20260318).pdf');
        assert.equal(adm.target, 'admrul');
        assert.equal(adm.baselineNotice, '제2026-19호');
    });
    it('status 누락 시 빈 배열', () => {
        assert.deepEqual(statusRows(null), []);
        assert.deepEqual(statusRows(undefined), []);
    });
    it('docs[]가 있으면 문서별 비교 행 + 갱신 필요 표시', () => {
        const rows = statusRows({
            baseline: {}, latest: {}, checkedAt: 'x', newerFound: false,
            docs: [
                { name: '화장품법', baselineNotice: '제21525호', baselineDate: '2026-10-08',
                  latestNotice: '제21000호', latestDate: '2026-10-01', newer: true },
                { name: '안전기준', baselineNotice: '제2026-19호', baselineDate: '2026-03-18',
                  latestNotice: '제2026-19호', latestDate: '2026-03-18', newer: false },
            ],
        });
        assert.equal(rows.length, 4 + 1 + 2);
        assert.match(rows[4][1], /2종/);
        assert.match(rows[5][1], /갱신 필요/);
        assert.ok(!/갱신 필요/.test(rows[6][1]));
    });
    it('pending 문서는 시행 예정 개정본으로 표기', () => {
        const rows = statusRows({
            baseline: {}, latest: {}, checkedAt: 'x', newerFound: false,
            docs: [
                { name: '화장품법', baselineNotice: '제21525호', baselineDate: '2026-04-02',
                  latestNotice: '제21050호', latestDate: '2027-01-01', newer: true, pending: true },
            ],
        });
        const docRow = rows.find(r => r[0].includes('화장품법'));
        assert.match(docRow[1], /시행 예정 개정본/);
    });
});

describe('filterIngredientDocs (DI-11)', () => {
    const docs = [
        parseRefDoc('화장품법(법률)(제21525호)(20261008).pdf'),
        parseRefDoc('화장품 안전기준 등에 관한 규정(식품의약품안전처고시)(제2026-19호)(20260318).pdf'),
        parseRefDoc('화장품의 색소 종류 및 기준(식품의약품안전처고시)(제2023-61호)(20230921).pdf'),
    ];
    it('선언된 문서명만 subset으로 필터', () => {
        const sub = filterIngredientDocs(docs, ['화장품 안전기준 등에 관한 규정', '화장품의 색소 종류 및 기준']);
        assert.deepEqual(sub.map(d => d.name), ['화장품 안전기준 등에 관한 규정', '화장품의 색소 종류 및 기준']);
    });
    it('목록 미선언·빈 배열이면 빈 subset', () => {
        assert.deepEqual(filterIngredientDocs(docs, undefined), []);
        assert.deepEqual(filterIngredientDocs(docs, []), []);
    });
});

describe('dictNoticeDocs (DI-11)', () => {
    it('기본 시험(cosmetic)의 성분 관련 고시 subset 반환 — 법령·CGMP 제외', () => {
        const docs = dictNoticeDocs();
        const names = docs.map(d => d.name);
        assert.ok(names.includes('화장품 안전기준 등에 관한 규정'));
        assert.ok(names.includes('기능성화장품 기준 및 시험방법'));
        assert.ok(names.includes('화장품의 색소 종류 및 기준'));
        assert.ok(!names.includes('화장품법'));
        assert.ok(!names.includes('우수화장품 제조 및 품질관리기준'));
        assert.ok(docs.every(d => d.target === 'admrul'));
    });
});

describe('dictNoticeRow (DI-11)', () => {
    const doc = parseRefDoc('화장품 안전기준 등에 관한 규정(식품의약품안전처고시)(제2026-19호)(20260318).pdf');
    const live = (notice, effectiveDate) => ({ notice, effectiveDate, serial: '2100000276068' });
    it('기준과 동일하면 ok — 원문은 일련번호 시리얼 링크', () => {
        const r = dictNoticeRow(doc, live('제2026-19호', '2026-03-18'), '2026-10-19');
        assert.equal(r.level, 'ok');
        assert.equal(r.mark, '✅');
        assert.match(r.text, /제2026-19호\(2026-03-18\) → 제2026-19호\(2026-03-18\)/);
        assert.match(r.url, /admRulInfoP\.do\?admRulSeq=2100000276068/);
    });
    it('최신 시행일이 더 크면 newer — 개정 감지', () => {
        const r = dictNoticeRow(doc, live('제2026-30호', '2026-09-01'), '2026-10-19');
        assert.equal(r.level, 'newer');
        assert.equal(r.mark, '⚠ 개정 감지');
    });
    it('미래 시행일이면 pending — 시행 예정', () => {
        const r = dictNoticeRow(doc, live('제2027-1호', '2027-01-01'), '2026-10-19');
        assert.equal(r.level, 'pending');
        assert.match(r.mark, /시행 예정/);
    });
    it('live 조회 실패면 error — 한글주소 폴백 링크', () => {
        const r = dictNoticeRow(doc, null, '2026-10-19');
        assert.equal(r.level, 'error');
        assert.match(r.text, /조회 실패/);
        assert.ok(r.url.includes('law.go.kr'));
    });
});
