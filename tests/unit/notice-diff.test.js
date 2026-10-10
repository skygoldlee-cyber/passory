// tests/unit/notice-diff.test.js — 참조 문서 개정 조문 diff (notice_diff.json)
// @spec FO-24
// ref_md 현행본 ↔ _archive 구본의 조문 단위 비교: 신설·삭제·개정 분류와
// PDF 변환 아티팩트(목차 중복·개정이력 태그·장절 헤딩·부칙) 정규화를 고정한다.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { splitArticles, normalizeArticle, diffDocs, parseDocName, buildExamDiff }
    = require(join(ROOT, 'tools/build/build_notice_diff.js'));

const { unseenRevisions, diffSummary } = await import('../../src/notice-check.js');

describe('splitArticles', () => {
    test('조문 단위로 분할하고 목차 중복은 긴 본문을 채택한다', () => {
        const md = '제1조\n제2조\n제3조\n\n제1조 (목적) 이 법은 목적을 규정한다.\n제2조 (정의) 정의 본문.\n제3조 (적용) 적용 범위 본문.';
        const arts = splitArticles(md);
        assert.ok(arts);
        assert.ok(arts['제1조'].includes('목적을 규정'));
        assert.ok(!arts['제1조'].startsWith('제2조'));
    });
    test('조문 헤딩이 없으면 null을 반환한다', () => {
        assert.equal(splitArticles('별표 1. 사용불가 원료 목록\n가. 사포닌'), null);
    });
});

describe('normalizeArticle', () => {
    test('개정이력 태그·이미지·장절 헤딩·중복 제목을 제거한다', () => {
        const body = '(제목) (제목) ① 본문 <개정 2026. 4. 1.> ![img](images/x.png)\n제2장 유통\n[법률 제20901호, 2025. 4. 1.] 추가분';
        const n = normalizeArticle(body);
        assert.equal(n.includes('<개정'), false);
        assert.equal(n.includes('!['), false);
        assert.equal(n.includes('제2장'), false);
        assert.equal(n.includes('[법률'), false);
        assert.equal((n.match(/\(제목\)/g) || []).length, 1);
    });
});

describe('diffDocs', () => {
    const OLD = '본문 시작\n\n제1조 (목적) 이 법은 A를 규정한다.\n제2조 (정의) 기존 정의.\n제3조 (의무) 의무 조문.';
    const NEW = '제1조 (목적) 이 법은 A를 규정한다.\n제2조의2 (신설 정의) 새 조문.\n제3조 (의무) 바뀐 의무 조문 내용.';

    test('신설·삭제·개정을 조문 단위로 분류한다', () => {
        const d = diffDocs(OLD, NEW);
        assert.deepEqual(d.added, ['제2조의2']);
        assert.deepEqual(d.removed, ['제2조']);
        assert.deepEqual(d.changed, ['제3조']);
        assert.equal(d.unstructured, false);
    });

    test('부칙 이후 텍스트는 비교 대상에서 제외한다', () => {
        const withAdd = OLD + '\n부칙 <법률 제1호> 이 법은 공포 후 시행한다.';
        const d = diffDocs(OLD, withAdd);
        assert.deepEqual(d.changed, []);
        assert.deepEqual(d.added, []);
    });

    test('조문이 없는 비정형 문서는 전체 비교로 폴백한다', () => {
        const d = diffDocs('별표 목록 A\n가. 원료1', '별표 목록 B\n가. 원료1');
        assert.equal(d.unstructured, true);
        assert.deepEqual(d.changed, ['(전체 문서)']);
    });

    test('정규화가 변환 노이즈를 걸러 실제 개정만 남긴다', () => {
        const oldNoisy = '제1조 (목적) (목적) 이 법은 A를 규정한다. <개정 2020. 1. 1.>';
        const newClean = '제1조 (목적) 이 법은 A를 규정한다.';
        assert.deepEqual(diffDocs(oldNoisy, newClean).changed, []);
    });
});

describe('parseDocName', () => {
    test('참조 문서명에서 메타를 추출한다', () => {
        const m = parseDocName('화장품법(법률)(제21525호)(20261008)');
        assert.equal(m.key, '화장품법(법률)');
        assert.equal(m.notice, '제21525호');
        assert.equal(m.effectiveDate, '2026-10-08');
    });
    test('비규약 파일명은 null', () => {
        assert.equal(parseDocName('원료목록.md'), null);
    });
});

describe('buildExamDiff (실데이터)', () => {
    const arch = join(ROOT, 'content/exams/cosmetic/참조자료/_archive/화장품법(법률)(제20901호)(20260402)');
    const cur = join(ROOT, 'content/exams/cosmetic/참조자료/ref_md/과목1/화장품법(법률)(제21525호)(20261008)');
    test('화장품법 제20901호→제21525호 개정 쌍을 감지한다', (t) => {
        if (!existsSync(arch) || !existsSync(cur)) { t.skip('개정 쌍 파일 없음'); return; }
        const { docs } = buildExamDiff('content/exams/cosmetic');
        const law = docs.find(d => d.name === '화장품법');
        assert.ok(law, '개정 항목에 화장품법이 있어야 함');
        assert.equal(law.to.notice, '제21525호');
        assert.ok(law.added.includes('제2조의4'), '신설 제2조의4 검출');
        assert.ok(law.added.includes('제2조의5'), '신설 제2조의5 검출');
    });
});

describe('unseenRevisions / diffSummary (런타임)', () => {
    const docs = [
        { key: 'A법(법률)', name: 'A법', to: { doc: 'A법(법률)(제2호)(20260101)', notice: '제2호' }, added: ['제2조'], changed: [], removed: [] },
        { key: 'B고시', name: 'B고시', to: { doc: 'B고시(제2호)(20260101)', notice: '제2호' }, added: [], changed: ['제1조'], removed: [] },
    ];
    test('미확인 판본만 필터한다', () => {
        const seen = { 'A법(법률)': 'A법(법률)(제2호)(20260101)' };
        const out = unseenRevisions(docs, seen);
        assert.equal(out.length, 1);
        assert.equal(out[0].name, 'B고시');
    });
    test('요약 문구 — 신설·개정·삭제를 조합한다', () => {
        assert.equal(diffSummary(docs[0]), '신설 제2조');
        assert.equal(diffSummary(docs[1]), '개정 제1조');
        assert.equal(diffSummary({}), '조문 단위 차이 없음(서식 수준)');
    });
});
