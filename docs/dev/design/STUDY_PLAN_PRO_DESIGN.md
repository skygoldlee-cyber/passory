# 스마트학습 — 과목별 가중 학습 계획 설계안 (study_plan_pro)

> 상위 문서: [`사업기획서`](../../exams/cosmetic/business/맞춤형화장품_조제관리사_자격증플랫폼_사업기획서.md) v4.0 §8.4 (Pro 가설) · [`SPEC.md`](../SPEC.md) §3.20
> 범위: 시험일 학습 계획 패널(SC-05)의 과목 무관 총량 계획을, 출제 비중·약점 정답률 가중 **주차별 과목 배분표**로 확장하는 Pro 가설 기능
> 상태: ✅ 구현 완료 — SC-08 (2026-10-05)
> **관련 SPEC ID**: `SC-08` · 선행 `SC-05`(계획 패널) · `SC-06`(계획 준수) · `SC-07`(마일스톤) · `D-17`(리드타임)
> **문서 ID**: DOC-DSN-16
> **범위**: platform · 판본: none

---

## 1. 배경·목적

SC-05 계획 패널은 "남은 카드 총량 ÷ 학습 가능 일수"만 보여준다 — **무엇을 얼마나**가 아니라 **총 얼마나**만 답한다. triage 등급의 권고("비중 큰 과목 우선")도 과목명 하나를 텍스트로 줄 뿐, 주차별로 어느 과목을 몇 장씩 해야 하는지는 제시하지 않는다.

`study_plan_pro`는 이 갭을 메우는 Pro 가설이다:

- **무료 영역(기배포)**: 계획 보여주기(계획표) + 지키게 하기(준수 진행률·마일스톤)
- **Pro 가설(본 설계)**: "내 약점에 맞춘 계획" — 출제 비중 + 개인 약점 가중으로 **주차별 과목 배분표**를 생성

사업 위치는 기획서 §8.4 — 학습 Premium의 지불 근거 후보. entitlement 서버 검증(ROAD-P1) 전이므로 기능 자체는 전원 접근 가능하고 "Pro 예정" 표기로 노출·전환 지표를 측정한다.

---

## 2. 핵심 설계 결정

| # | 결정 | 선택 | 근거 |
|---|------|------|------|
| 1 | 배분 단위 | **주차×과목 매트릭스 계산, 이번 주 강조 표시** | 전체 주차 표는 SC-05 표와 나란히 두면 정보 과잉 — 이번 주 과목별 목표를 칩으로 강조하고 전체 매트릭스는 접힘 영역 |
| 2 | 수요 공식 | `수요_i = 잔여_i × 비중_i × 약점가중_i`, 배정은 비례 배분 | 세 요인이 모두 기존 데이터. 곱셈 결합이라 각 요인의 기여를 문구로 설명 가능 |
| 3 | 약점 가중 | **표본 게이트 선형식** — 풀이 ≥20문이면 `(2 − 정답률)` [1.0~2.0], 미만이면 1.0(중립) | 신규 사용자·표본 부족 과목에서 가중이 흔들리는 가짜 정밀도 방지 — 표본 없으면 출제 비중만으로 배분 |
| 4 | 출제 비중 | `registry.exams[].stats.questions` 과목별 합계 (기존 `_topWeightSubjectName`과 동일 소스) | 선언된 실측치라 시험 팩 일반성 유지 — 비중 미선언 시험은 균등 1.0 폴백 |
| 5 | 잔여 상한 | **워터필링 재배분** — 배정_i ≤ 잔여_i, 초과분을 잔여 남은 과목에 재순환 | 과목 조기 완료 시 배정량이 자연스럽게 남은 과목으로 이동, 매 렌더 재계산이라 별도 상태 불요 |
| 6 | Pro 게이트 | **`feature-plan.json` `study_plan_pro` 키 + PRO 배지 + 1회 안내** (기존 `proFeatureNotice` 규약) | entitlement 미구현 상태에서 하드 게이트 불가 — 기존 "Pro 표기+무료 체험" 규약과 정합. 결제 도입 후 entitlement 분기 추가 |
| 7 | 퀴즈 배분 | **범위 제외 — 카드만** | 계획 패널이 카드 기준. 문항 배분은 2단계 (문항 수·오답 분포까지 넣으면 공식 복잡도 급증) |
| 8 | 주차 기준 | `weeks[0]` = 오늘부터 7일 (슬라이딩) | SC-06 준수 진행률과 동일 윈도우 — 달력 주(월~일)와 섞으면 두 수치가 어긋남 |
| 9 | 멀티시험 | 시험 팩 일반 — 비중·과목 목록 전부 registry 주입, cosmetic 수치는 예시일 뿐 | 하드코딩 금지 원칙 (DA-계열). 다른 팩은 과목 수·비중이 달라도 동일 함수로 동작 |

---

## 3. 배분 로직 명세

### 3.1 입력

| 입력 | 소스 |
|---|---|
| `plan` | `computeStudyPlan(remaining)` — 주차별 `w.cards` 총량 (SC-05) |
| 과목 목록 | `DataLoader.getSubjectList()` — `key`, `name`, `stats.cards`/`targetCards` |
| 비중_i | `registry.exams[].stats.questions`의 과목별 합계 → 총합 대비 비율. 미선언 시 `1/N` |
| 잔여_i | `displayCards_i − memorized_i` (`subj_card_` 접두사로 집계, `_getSubjCounts` 패턴) |
| 약점가중_i | 풀이 수 ≥ `MIN_SAMPLE`(20)이면 `2 − 정답률_i`, 미만이면 `1.0` |

### 3.2 공식

```
각 주차 w:
  수요_i = 잔여_i × 비중_i × 약점가중_i
  배정_i = w.cards × 수요_i / Σ수요        — 올림 후 잔여 상한
  초과분 = Σ max(0, 배정_i − 잔여_i)        → 잔여 남은 과목에 동일 비례로 재배분
```

재배분은 최대 2회 순환(수렴 보장: 잔여가 0인 과목은 후보에서 제외). 최종 Σ배정 = min(w.cards, Σ잔여)를 보장한다.

### 3.3 산출

```js
computeSubjectAllocation(plan, subjects) → null | {
  weeks: [{ week, total, alloc: [{ key, name, cards }] }],
  thisWeek: { total, alloc: [...] },   // weeks[0] 별칭 — 이번 주 강조용
  hasWeights: boolean                  // 비중 선언 여부 — 미선언 시 '균등 배분' 표기
}
```

DOM 비의존 순수 함수 — `study-tracker.js`에 배치해 `computeStudyPlan`과 같은 계층 유지.

### 3.4 예시 (cosmetic 팩)

D-30, 전 과목 미학습(잔여 = 카드 수), 정답률 표본 없음(가중 1.0):

| 과목 | 카드 | 비중(문항) | 주간 배정(주당 ~197장 기준) |
|---|---|---|---|
| 화장품법 | 112 | 10% | ~20장 |
| 제조·품질 | 281 | 25% | ~49장 |
| 안전관리 | 281 | 25% | ~49장 |
| 맞춤형의 이해 | 449 | 40% | ~79장 |

과목4 정답률 40%(표본 충족)로 측정되면 가중 1.6 → 해당 과목 배정이 상대적으로 증가한다.

---

## 4. UI 명세

계획 패널(SC-05)의 주간 진행률(SC-06) 아래, 주차 표 위에 삽입:

```
┌─ 이번 주 과목별 목표 ──────────── [PRO 배지]
│  맞춤형의 이해 79장 · 안전관리 49장 · 제조·품질 49장 · 화장품법 20장
│  └ 배정 근거: 출제 비중 + 약점 정답률 가중   [주차별 배분 펼치기 ▾]
└────────────────────────────────────────────
(펼침 시) 주차×과목 배정 매트릭스 표 — 행=주차, 열=과목
```

- 과목 카드 소진 시 해당 과목 행은 "완료" 표시 + 배정 0
- `plan.tier === 'done'`(잔여 0)이면 섹션 미표시
- 비중 미선언 시험이면 "균등 배분 기준" 부기 — 약점 가중만 적용됨을 구분

---

## 5. Pro 게이트 명세

| 항목 | 내용 |
|---|---|
| 플랜 키 | `feature-plan.json` → `"study_plan_pro": "pro"` |
| 배지 | 섹션 헤더에 `<span class="pro-badge" data-pro-feature="study_plan_pro">PRO</span>` — `refreshProBadges`가 플랜 반영 |
| 안내 | 섹션 첫 렌더 시 `proFeatureNotice('study_plan_pro', '스마트학습')` 1회 |
| 접근 | entitlement 미구현 — 현 규약상 전원 이용 가능, "Pro 제공 예정" 표기로 전환 지표(`trackAction('study_plan_pro')`) 측정 |

`check:plan` 게이트가 플랜 키↔코드 사용↔로드맵 문서 양방향을 검증하므로 `feature-plan.json`·`data-pro-feature`·`proFeatureNotice`·기획서 §8.4의 네 곳이 함께 갱신돼야 한다.

---

## 6. 테스트 계획

| 계층 | 검증 |
|---|---|
| 유닛 (`study-tracker.test.js`) | 배분 비례 정확성 · 잔여 상한·재배분(조기 완료 과목 → 재배분) · 표본 미만 중립 가중 · 비중 미선언 균등 폴백 · 잔여 0 과목 제외 · Σ배정 = min(주차 총량, Σ잔여) |
| DOM (`study-calendar.dom.test.js`) | 시험일 설정 시 과목별 목표 칩 렌더 · PRO 배지 표시 · 잔여 0 과목 "완료" 표시 · done 티어 시 섹션 미표시 · 펼침 매트릭스 |

---

## 7. 미결 사항·후속

- **문항(퀴즈) 배분**: 카드 완료 후 문항 풀이까지 계획에 넣을지 — 문제은행 1,000제를 같은 주차 축에 얹는 2단계 과제 → ✅ 구현 (Rev 3 — 과목별 퀴즈 잔여 배분 + `quizBySubj` 실적 추적)
- **재계획 이벤트**: 목표 변경·장기 미접속 시 "계획 재조정됨" 안내 — SC-07 마일스톤 id 체계(`replan-*`)로 확장 가능
- **entitlement 실게이트**: ROAD-P1 결제 도입 시 `hasProEntitlement()` 분기 추가 — 현 설계는 표기 게이트만
- **내보내기**: 배분표를 주간 리포트(AN-09)에도 넣을지 — Pro 리포트 가치 강화 옵션 → ✅ 구현 (Rev 2 — `p.planBySubject` 과목별 준수 행)

---

## 8. 보강 (SC-09, 2026-10-05)

구현 후 검토에서 도출한 5개 보강 항목:

| # | 항목 | 구현 |
|---|---|---|
| 1 | 과목별 주간 실적 | 캘린더 엔트리에 `bySubj` 맵 추가 — `saveProgress`가 암기 카드 과목별 증분(`_prevMemBySubj` 차분)을 `recordStudyActivity({bySubj})`로 기록, `sumRecentCardsBySubject`로 최근 7일 합산 → 칩 `N/배정장` 표시 |
| 2 | 실행 동선 | 칩을 `<button data-click="startSubjectStudy" data-arg="<subj>">`로 — 해당 과목 플래시카드 바로 진입 |
| 3 | 근거 투명성 | 약점 가중 활성 시 `약점` 배지(퀴즈 가중 >1.15 또는 취약 카드 가산 ≥0.25), 비중 선언 시 `N%` 배지 — 배분 개인화가 사용자에게 보이도록 |
| 4 | 약점 신호 확장 | `recentQuizBySubject`(과목당 최근 60문)가 표본 ≥20이면 누적 대신 우선 적용(현재 약점 반영) + 헷갈림 카드 비율 최대 +0.5 가산, 약점 가중 상한 2.5 |
| 5 | 키 해석 견고화 | `[a-z]+_card_` 정규식 → `subjectKeyFromItemId()`(weak-items) — 숫자·밑줄 포함 과목 키·`weak_*` 접두사 안전 |
| — | 기저 수정 | `loadState`에 `_prevMemCount/_prevQuizCount/_prevMemBySubj` 기준점 스탬프 — 미초기화 시 첫 저장이 전체 진도를 오늘 활동으로 기록하던 기존 결함 해소 |

---

## 9. Rev 2 — 맞춤학습 연계·약점 신호 통합 (SC-11·SC-12, 2026-10-05)

스마트학습(계획)과 맞춤학습(진단)의 양방향 연결. 진단 뷰에서 "지금 할 일"이 보이고,
계획 뷰에서 "왜 이렇게 배정됐는지" 진단 상세로 진입할 수 있어야 한다.

### 9.1 맞춤학습 뷰 스마트학습 요약 카드 (SC-11①)

- 분석 인사이트 그리드에 `analysis-smart-plan` 카드 추가 — `_renderSmartPlanInsight()`가
  `computeStudyPlan` + `computeSubjectAllocation` + `sumRecentCardsBySubject`로 과목별 `실적/배정` 행 렌더
- PRO 배지(`data-pro-feature="study_plan_pro"`) + "캘린더 보기" 버튼
- 시험일 미설정·완료 시엔 빈 상태 카드로 전환(시험일 설정 유도) — 진단 뷰에서도 계획 설정이 최우선 동선

### 9.2 배정 근거 딥링크 (SC-11②)

- 칩 옆 `이유` 버튼(`data-click="gotoSubjectAnalysis" data-arg="<key>"`) → 맞춤학습 뷰로 전환 후
  해당 과목 카드(`id="subj-card-<key>"`)로 스크롤 + `subj-card-flash` 일시 강조
- 과목 카드는 기존 맞춤학습 그리드(`subject-cards-container`)의 카드에 id 부여 — 별도 DOM 추가 없음

### 9.3 주간 리포트 과목별 준수 (AN-09 확장)

- `buildWeeklyReportText`에 `p.planBySubject` 배열 추가 — `  - 과목명: 실적/배정장` 행을
  `p.plan`(총량 준수) 줄 아래에 나열. 배분 없으면(시험일 미설정·완료) 총량 행만 출력

### 9.4 약점 신호 통합 (SC-12)

맞춤학습이 이미 집계하는 진단 신호를 약점 가중에 가산한다 — 퀴즈 표본 부족
과목(콜드스타트)도 실제 약점을 반영하도록:

```text
diagBoost_i = min(0.5, 0.1 × causes30d_i + 0.15 × weakChapters_i)
weakW_i     = min(MAX_WEAK_WEIGHT, quizW + weakBoost + diagBoost)
```

| 신호 | 출처 | 가산 |
|---|---|---|
| `causes30d` | `state.wrongCauses` — `subjectId` 일치 + `ts` 최근 30일 태그 수 | 건당 +0.1 |
| `weakChapters` | `computeSubjectWeakChapters` 결과의 과목별 취약 단원 수 | 단원당 +0.15 |

- 상한은 기존 `MAX_WEAK_WEIGHT = 2.5` 유지 — 모든 신호가 같은 예산을 공유,
  어떤 신호 조합이든 과배정 폭주 방지
- `weakBadge` 표시 조건에 `diagBoost ≥ 0.15` 추가
- 입력 파이프라인 공용화: `computeSubjectAllocInputs()`가 mem·quiz·recent·weak·
  weights·diag 맵을 한 번에 집계 — 캘린더 칩·분석 카드·리포트 3곳이 동일 입력 공유

### 9.5 테스트 계획 (Rev 2)

| 계층 | 검증 |
|---|---|
| 유닛 | `computeSubjectAllocInputs` 집계 · diagBoost 가산·상한 · `p.planBySubject` 리포트 행 |
| DOM | 분석 뷰 요약 카드 렌더 · 칩 `이유` 버튼 존재 · `gotoSubjectAnalysis` 뷰 전환+앵커 |

---

## 10. Rev 3 — 퀴즈 배분·복습 대기 수요·목표 상향 루프 (SC-13·SC-14, 2026-10-05)

§7 미결 사항의 "문항(퀴즈) 배분" 2단계 과제와 후속 두 가지 수요 신호를 구현한다.

### 10.1 퀴즈 배분 (SC-13①)

카드와 같은 축으로 과목별 퀴즈 풀이량을 배분한다 — 문제은행 커버리지를 계획에 편입.

```text
quizRemaining_i = max(0, 과목 퀴즈 총량 − 풀이 수_i)
주차 퀴즈 총량  = 주차 학습일 × 일일 퀴즈 목표 (plan.weeks[w].studyDays × goals.dailyQuizzes)
수요_i        = quizRemaining_i × 출제비중_i × weakW_i  ← 카드와 동일 가중 공유
```

- 과목 퀴즈 총량은 `stats.targetQuizzes` 상한 적용(`stats.quizzes` 폴백) — 카드 `targetCards`와 동일 규약
- `_allocWeek` 워터필링을 재사용한 별도 배분 패스 — 잔여 상한·초과 재배분 동일
- 칩 표기: `과목명 카드실적/카드배정장·퀴즈실적/퀴즈배정문` — 퀴즈 배정이 있을 때만 `·` 뒤 병기
- **과목별 퀴즈 실적 추적**: 캘린더 엔트리에 `quizBySubj` 맵 추가 — `saveProgress`가
  `_prevQuizBySubj` 차분을 `recordStudyActivity({quizBySubj})`로 기록,
  `sumRecentQuizzesBySubject`로 최근 7일 합산 (SC-09 `bySubj`와 동형)
- 주차 매트릭스 셀도 `카드장·퀴즈문` 병기, 맞춤학습 요약 카드·주간 리포트 `planBySubject`에 퀴즈 행 병기

### 10.2 SM-2 복습 대기 수요 (SC-13②)

기한을 넘긴 복습 카드는 "망각 위험 = 실질 약점"이므로 약점 가중에 가산한다:

```text
dueBoost_i = min(0.5, due_i / max(1, mem_i))   — 암기 카드 중 기한초과 비율
weakW_i    = min(MAX_WEAK_WEIGHT, quizW + weakBoost + diagBoost + dueBoost)
```

- `dueBySubject`는 `computeSubjectAllocInputs({dueCardIds})`에 `getDueCards()` 결과를 전달해 집계
- 분모는 `mem_i`(암기 수) — `remaining`은 미암기 신규 카드라 복습 대기와 무관
- `weakBadge` 표시 조건에 `dueBoost ≥ 0.25` 추가 — "밀린 복습 있는 과목"도 근거가 보임
- 주의: 복습 대기는 신규 카드 배분을 늘리는 신호가 아니라 **해당 과목 우선순위 가중**으로 해석 —
  칩 클릭 시 과목 학습 세션이 복습 대기 카드를 포함해 소화하므로 동선은 닫힘

### 10.3 합격 갭→목표 상향 권고 (SC-14)

진단(맞춤학습 합격 갭)이 계획 파라미터(일일 목표)까지 되먹는 루프:

- `gap.gap > 0`(예상 점수가 합격선 미만)일 때 합격 갭 카드에 목표 상향 권고 추가
- `plan.perStudyDay > dailyCards`(tight/triage)이면 "일일 카드 목표를 N→M장으로"라고
  **계산된 권장치**를 제시 — 임의 계수가 아니라 계획 수학의 필요량을 그대로 사용
- 계획 없거나 normal이면 "일일 목표·주간 학습일 상향을 검토하세요" 일반 권고
- 버튼 `data-click="openGoalSettings"` — 어느 뷰에서든 목표 모달 호출 가능

### 10.4 테스트 계획 (Rev 3)

| 계층 | 검증 |
|---|---|
| 유닛 | 퀴즈 잔여·주차 배분 합계 보존 · `dueBoost` 가산·상한 · `quizBySubj` 증분 기록 · `sumRecentQuizzesBySubject` |
| DOM | 칩 `장·문` 병기 · 매트릭스 퀴즈 셀 · 분석 카드 퀴즈 행 · 합격 갭 미달 시 목표 상향 버튼 |
