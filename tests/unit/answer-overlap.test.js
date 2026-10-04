// tests/unit/answer-overlap.test.js — 정답↔근거 지지 검증(tools/check/check_answer_overlap.js) 판정 로직 검증
// @spec CQ-06
import test from 'node:test';
import assert from 'node:assert/strict';
import checker from '../../tools/check/check_answer_overlap.js';

const { isSupported, sharesNgram, NEGATIVE_STEM_RE } = checker;

const choiceQ = (options, stem = '다음 중 옳은 것은?') => ({ num: 1, stem, options });
const ans = (answer, extra = {}) => ({ num: 1, answer, allowed: [], passage: '', ...extra });

test('sharesNgram — 조사·어미 변형을 흡수한다', () => {
    // "금속이온과 결합하여" ↔ "금속이온의 활성을 억제" — 토큰 단위로는 불일치, 4-gram "금속이온" 공유
    assert.ok(sharesNgram('원료 내 미량의 금속이온과 결합하여 변색을 방지', '금속이온의 활성을 억제하기 위해 첨가'));
    assert.ok(!sharesNgram('15일 이내 제출', '징역 또는 벌금에 처한다'));
});

test('단답형 — 정답 또는 허용 정답이 근거에 포함되면 지지', () => {
    const passage = '| 나이아신아마이드 (고시 함량) | 2.0~5.0% | 멜라닌의 이동 억제 |';
    assert.ok(isSupported(null, ans('나이아신아마이드'), passage).ok);
    assert.ok(isSupported(null, ans('카보머', { allowed: ['carbomer'] }), passage).ok === false);
});

test('단답형 — "(또는 ...)" 대안 표기도 후보로 인식한다', () => {
    const passage = '참고: 메틸파라벤 · 부틸파라벤 · 에틸파라벤';
    assert.ok(isSupported(null, ans('메틸파라벤(또는 해당 파라벤 명칭)'), passage).ok);
});

test('선다형 긍정형 — 정답 선택지의 4-gram이 근거에 없으면 미지지', () => {
    const q = choiceQ(['1년', '2년', '만 3세 이하', '5년', '7년']);
    const a = ans('③');
    assert.ok(isSupported(q, a, '영유아는 만 3세 이하로 정의한다').ok);
    assert.ok(!isSupported(q, a, '어린이는 만 13세 미만이다').ok);
});

test('선다형 부정형 — 정답 미지지가 정상, 해설이면 통과', () => {
    const q = choiceQ(['제품표준서', '제조관리기준서', '품질관리기준서', '원료관리기준서', '제조위생관리기준서'],
        '다음 중 4대 기준서에 해당하지 않는 것은?');
    assert.ok(NEGATIVE_STEM_RE.test(q.stem));
    const a = ans('④');
    // 해설형 근거
    assert.ok(isSupported(q, a, '> 해설: 4대 기준서는 제품표준서·제조관리기준서·품질관리기준서·제조위생관리기준서').ok);
    // 오답 2개 이상 지지형 근거
    assert.ok(isSupported(q, a, '제품표준서와 제조관리기준서를 작성해야 한다').ok);
    // 아무 지지도 없으면 미지지
    assert.ok(!isSupported(q, a, '시설 명세서를 제출한다').ok);
});

test('근거 구절이 비어 있으면 미지지', () => {
    assert.ok(!isSupported(choiceQ(['A', 'B', 'C', 'D', 'E']), ans('①'), '   ').ok);
});

// ── fix_answer_quotes: 인용문 보강기 판정 ──────────────────
import fixer from '../../tools/sync/fix_answer_quotes.js';
const { strongShare, expandForward, quoteWindow } = fixer;

test('strongShare — 우연한 짧은 n-gram은 지지로 인정하지 않는다', () => {
    // 4자 일반 n-gram("화장품에")은 약한 일치 → 강한 지지 아님
    assert.ok(!strongShare('화장품에 사용된 모든 성분', '소비자에게 판매하는 화장품에 한함'));
    // 숫자 포함 4-gram은 강한 지지
    assert.ok(strongShare('만 3세 이하', '영유아는 만 3세 이하로 정의한다'));
    // 6-gram 이상 공유도 강한 지지
    assert.ok(strongShare('책임판매관리자 자격', '책임판매관리자를 두어야 한다'));
    // 5자 이하 단답은 완전 포함 필요
    assert.ok(strongShare('피부', '피부 자극을 유발한다'));
    assert.ok(!strongShare('피부', '화장품의 표시 기준'));
});

test('expandForward — 인용 라인 이후에서 지지를 찾을 때까지 누적한다', () => {
    const src = [
        '① 법 제4조의2제1항에 따른 영유아의 연령 기준은 다음 각 호의',
        '1. 영유아: 만 3세 이하',
        '2. 어린이: 만 13세 미만',
    ];
    const q = choiceQ(['만 1세', '만 2세', '만 7세', '만 6세', '만 3세 이하']);
    const a = ans('⑤');
    const picked = expandForward(src, 0, q, a);
    assert.ok(picked && picked.length === 2); // 인트로 + '만 3세 이하' 라인
});

test('quoteWindow — 래핑된 조문은 문단 경계까지 포함한다', () => {
    const src = [
        '제13조(부당한 표시ㆍ광고 금지) ① 영업자는 다음 각 호에 해당하는 표시',
        '를 하여서는 아니 된다.',
        '2. 기능성화장품이 아닌 화장품을 기능성화장품으로 잘못 인식할 우려가 있',
        '는 표시 또는 광고',
        '',
        '3. 삭제<2025.1.31.>',
    ];
    // 지지 라인이 래핑 중간(인덱스 3)이면 문단 시작(인덱스 2, '2.' 마커)까지 포함
    const win = quoteWindow(src, 3);
    assert.equal(win[0], src[2]);
    assert.equal(win[win.length - 1], src[3]);
});
