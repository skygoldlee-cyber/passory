// tests/unit/textbook-search-ref.test.js — 참조자료 검색 헬퍼 계약 (TS-11)
// @spec TS-11
// 검증: _listRefDocs — REF_MD_SUBJECTS→과목키 역해석·표시명 우선·원료 목록 과목2 귀속·참조 없는 시험 빈 결과
//       _matchSnippet — 첫 매치 주변 슬라이스·1-based 라인 번호·미매치 폴백

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { _listRefDocs, _matchSnippet } from '../../src/views/textbook-search.js';

const TABLES = {
    contentRoot: 'content/exams/cosmetic',
    SUBJECT_DIR_MAP: { law: '과목1', manufacturing: '과목2', safety: '과목3' },
    REF_MD_SUBJECTS: {
        '화장품법(법률)(제21525호)(20261008).pdf': '과목1',
        'KFCC_별표1_통칙.pdf': '과목2',
        '무귀속문서.pdf': '과목9'
    },
    REF_FILE_TO_PATH: {
        '화장품법(법률)(제21525호)(20261008).pdf': 'content/exams/cosmetic/참조자료/ref_md/과목1/화장품법(법률)(제21525호)(20261008)/화장품법(법률)(제21525호)(20261008).md',
        'KFCC_별표1_통칙.pdf': 'content/exams/cosmetic/참조자료/ref_md/과목2/KFCC_별표1_통칙/KFCC_별표1_통칙.md',
        '무귀속문서.pdf': 'content/exams/cosmetic/참조자료/ref_md/과목9/x/x.md'
    },
    REFERENCE_LAW: [
        { name: '화장품법', file: '화장품법(법률)(제21525호)(20261008).pdf', type: 'pdf', dir: '법령고시' }
    ],
    REFERENCE_FILES: {
        manufacturing: [{ name: 'KFCC 별표1 통칙', file: 'KFCC_별표1_통칙.pdf', type: 'pdf' }]
    },
    REFERENCE_INGREDIENTS: [
        { name: '승인 원료 목록', file: 'approved_ingredients.md', type: 'md', dir: '원료' }
    ]
};

describe('_listRefDocs — 과목 귀속·표시명·원료', () => {
    const docs = _listRefDocs(TABLES);

    test('REF_MD_SUBJECTS의 과목N이 SUBJECT_DIR_MAP으로 subject key에 역해석된다', () => {
        const law = docs.find(d => d.file.startsWith('화장품법'));
        const mfg = docs.find(d => d.file.startsWith('KFCC'));
        assert.equal(law.subjId, 'law');
        assert.equal(mfg.subjId, 'manufacturing');
    });

    test('매핑 없는 과목N 문서는 제외된다', () => {
        assert.equal(docs.some(d => d.file === '무귀속문서.pdf'), false);
    });

    test('REFERENCE_* name이 표시명으로 우선 사용된다', () => {
        assert.equal(docs.find(d => d.file.startsWith('화장품법')).docName, '화장품법');
        assert.equal(docs.find(d => d.file.startsWith('KFCC')).docName, 'KFCC 별표1 통칙');
    });

    test('원료 목록은 과목2 subject key에 귀속되고 ref_md 밖 경로를 가진다', () => {
        const ing = docs.find(d => d.file === 'approved_ingredients.md');
        assert.equal(ing.subjId, 'manufacturing');
        assert.equal(ing.path, 'content/exams/cosmetic/참조자료/원료/approved_ingredients.md');
        assert.equal(ing.docName, '승인 원료 목록');
    });

    test('참조자료 없는 시험(빈 테이블)은 빈 목록', () => {
        assert.deepEqual(_listRefDocs({}), []);
    });
});

describe('_matchSnippet — 스니펫·라인 번호', () => {
    const text = ['제1조(목적) 이 법은 화장품에 관한 법이다', '제2조(정의) 화장품이란', '제3조(등록) 제조업자는'].join('\n');

    test('첫 매치 주변을 radius만큼 자르고 1-based 라인 번호를 반환한다', () => {
        const r = _matchSnippet(text, ['정의'], 10);
        assert.equal(r.lineNum, 2);
        assert.ok(r.snippet.includes('정의'));
        assert.ok(r.snippet.startsWith('…'));
        assert.ok(r.snippet.endsWith('…'));
    });

    test('첫 번째 라인 매치는 라인 1, 끝 매치는 마지막 라인', () => {
        assert.equal(_matchSnippet(text, ['목적']).lineNum, 1);
        assert.equal(_matchSnippet(text, ['제조업자']).lineNum, 3);
    });

    test('여러 검색어 중 가장 앞선 매치 위치를 사용한다', () => {
        const r = _matchSnippet(text, ['제조업자', '목적'], 10);
        assert.equal(r.lineNum, 1);
    });

    test('미매치 시 문서 앞부분 스니펫 + lineNum 1', () => {
        const r = _matchSnippet(text, ['없는단어'], 10);
        assert.equal(r.lineNum, 1);
        assert.ok(r.snippet.startsWith('제1조'));
        assert.equal(r.snippet.length, 20);
    });

    test('검색어 대소문자 무시', () => {
        const r = _matchSnippet('CGMP 기준은 GMP와 같다', ['cgmp'], 10);
        assert.ok(r.snippet.includes('CGMP'));
        assert.equal(r.lineNum, 1);
    });
});
