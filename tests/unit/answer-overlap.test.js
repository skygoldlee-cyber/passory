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
