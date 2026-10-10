# 기성품 전성분 DB 설계안 (Formula OS)

> 상위 문서: [`FORMULA_OS_WORKFLOW_DESIGN.md`](FORMULA_OS_WORKFLOW_DESIGN.md) (조제관리사 업무 전체 커버리지)
> 범위: 시판 화장품의 전성분을 등록해 개인 기성품 DB를 구축하고, 공식 원료 DB·고객 카드·My 포뮬러와 교차 분석
> 상태: ✅ 구현 완료 — Phase A+B (FO-37~40) + 보완 확장 (FO-44·FO-45·FO-47~53)
> **관련 SPEC ID**: `FO-37,FO-38,FO-39,FO-40,FO-44,FO-45,FO-47,FO-48,FO-49,FO-50,FO-51,FO-52,FO-53` (SPEC §3.18) · 선행 `DI-06~09`(자가 사전) · `FO-14`(전성분 생성) · `FO-32`(미등록 원료 즉시 등록)
> **문서 ID**: DOC-DSN-12
> **범위**: exam:cosmetic · 판본: none

---

## 1. 배경·목적

조제관리사 실무에서 기성품 전성분은 ① 벤치마킹(유사 제품의 성분 구성 파악) ② 고객 상담(사용 중 제품의 알레르기·금지 성분 확인) ③ 처방 설계 참고(내 포뮬러와의 성분 비교)의 핵심 참고 자료다. 전성분 표시는 화장품법 제10조 의무 사항이라 모든 시판 제품이 라벨·판매 페이지에 공개하며, 사용자는 이 텍스트를 붙여넣어 등록한다.

| 활용 | 내용 | 재사용 자산 |
|---|---|---|
| 기성품 성분 분석 | 전성분 붙여넣기 → 성분별 규제 배지(공식/제한/금지매칭/자가/미등록) | `buildIngredientIndex` + 자가 사전 병합 인덱스 |
| 성분 → 제품 역조회 | "이 성분이 들어간 내 등록 제품" — 사전 상세에서 조회 | `normalizeEntityName` 정규화 매칭 |
| 고객 알레르기 교차 | 고객 카드 `allergies` ↔ 제품 전성분 부분일치 경고 | `formula-batch.js`의 `includes` 양방향 매칭 패턴 |
| 포뮬러 벤치마킹 | My 포뮬러 `fullIngredients`와 기성품 공통/차이 성분 3분할 | `buildFullIngredients` (FO-14, 구현됨) |
| 자가 사전 공급원 | 미등록 성분을 자가 사전(DI-06)으로 바로 등록 | `customIngAdd` 프리필 모달 (FO-32) |

---

## 2. 핵심 설계 결정

| # | 결정 | 선택 | 근거 |
|---|------|------|------|
| 1 | 저장 단위 | **성분명 문자열만** — 농도 필드 없음 | 전성분 표시에 함량이 없으므로 `concentration` 입력은 거짓 정밀도·입력 부담만 만든다 |
| 2 | 성분 목록 | **배열 순서 보존** | 전성분은 1% 초과 내림차순 표시(화장품법)라 순서 자체가 ≈함량 서열 — "상위 N종" 분석에 활용 |
| 3 | 규제 판정 | **조회 시점 라이브 매칭** — 스냅샷 저장 안 함 | 기성품 DB는 '기록 보존'이 아니라 '분석 도구'다. 원료 DB 갱신(FO-24 고시 감지) 시 등록해둔 전 제품의 판정이 자동 최신화. My 포뮬러의 `ingredients[].snapshot`은 과거 처방의 검증 근거 보존이 목적이라 성격이 다르다 |
| 4 | 엔티티 분리 | **신규 스토어·신규 키** (`product_items`) | 포뮬러와 생명주기·스키마가 다르다 — `formula_items` 확장 대신 독립 스토어 (customer-store.js 패턴) |
| 5 | 유형 게이트 | **전 유형 노출** (data-biz 미지정) | 벤치마킹·상담 보조는 맞춤형조제·제조업·책임판매업 모두에 해당 — 사용자 승인 사항 |
| 6 | 등록 UI | **모달이 아닌 폼 패널** | 전성분 textarea + 칩 미리보기가 길다 — 고객·배치 폼과 같은 `*-form-panel` 패턴 (모바일 키보드 대응도 패널이 안전) |
| 7 | 미등록 성분 | **칩으로 보존 + 사전 등록 단축** | 정보 손실 없이 전성분에 유지, 탭하면 `customIngAdd` 프리필 (FO-32 단축 경로 재사용 — 사용자 승인 사항) |

---

## 3. 데이터 스키마·스토리지 계약

### 3.1 스토어 — `src/exams/cosmetic/product-store.js`

`custom-ingredient-store.js`의 CRUD 패턴 미러 (sanitize → 중복 검사 → 한도 → saveItems).

```js
{ id: 'prod_<base36>',        // newId('prod')
  name: '제품명',             // 필수, 최대 120자
  brand: '브랜드',            // 선택, 최대 60자
  category: '크림·밤',        // 선택 — CUSTOMER_OPTIONS.formulation 재사용 (제형 enum 공유)
  ingredients: ['정제수', '글리세린', …],  // 전성분 표시 순서, 각 최대 120자, 최대 150종
  note: '',                   // 메모, 최대 300자
  createdAt, updatedAt }
```

### 3.2 스토리지 키 계약 — `storage-keys.js` 도메인 섹션

```js
// Formula OS — 기성품 전성분 DB (product-store.js, FO-37)
PRODUCT_ITEMS: 'product_items',
```

- `BACKUP_KEYS` 편입 → 백업·복원·클라우드 동기화 대상 (scopedKey가 시험 네임스페이스 자동 적용)
- `RESET_KEYS`는 BACKUP_KEYS 상속이라 자동 포함
- 고객 카드와 달리 **동기화 허용** — 개인정보 아님 (기성품 정보는 공개 라벨 데이터)

### 3.3 정책 상수

| 상수 | 값 | 근거 |
|---|---|---|
| `PRODUCT_LIMIT_FREE` | **30종** | 포뮬러 5·고객 20·자가성분 50 관행의 중간 — 제품당 ~50종 문자열만이라 쿼터 무관 |
| 중복 정책 | `normalizeEntityName(brand+name)` 동일 시 `code:'duplicate'` 반환 — 폼이 '리뉴얼·개정 별도 등록' 확인 후 `allowVariant`로 허용 (FO-52) | 실수 중복 등록은 기본 차단하되, 전성분이 바뀐 리뉴얼 제품은 덮어쓰기가 아니라 별도 항목 — 벤치마킹 시 구·신 포뮬러 대조가 실무 가치. 목록은 '동명 N종' 메타로 구분. 수정 경로는 타 제품명 변경 차단 유지 |
| 전성분 상한 | 성분명 120자·전체 150종 | 쿼터·렌더 비용 상한. 초과분은 절단하되 **무음 손실 금지** — 파서가 `dropped`로 노출하고 폼 카운터에 '상한 초과 N종 잘림' 경고 (FO-49) |

---

## 4. 전성분 파싱 — `parseFullIngredients(text)`

### 4.1 구분자 함정 — `1,2-헥산디올`

한국 전성분 표기에는 **`1,2-헥산디올`·`2,3-부탄디올`처럼 성분명 안에 쉼표가 들어간다**. 단순 `split(',')`은 이를 `1`과 `2-헥산디올`로 분해한다.

**규칙**: `숫자,숫자` 패턴의 쉼표는 구분자로 취급하지 않는다.

```js
// 의사코드 — 실제 구현은 product-store.js
const PROTECTED = /(\d),(\d)/g;          // 자릿수 사이 쉼표 보호
const SEP = /[,·•\n;|]+/;                // 쉼표·중점·개행·세미콜론·파이프
text.replace(PROTECTED, '$1\x00$2')      // 보호 문자로 치환
    .split(SEP)
    .map(s => s.replace(/\x00/g, ',').trim())
    .filter(Boolean)
    .slice(0, 150);
```

### 4.2 입력 정제 — 필드 라벨·문장부호 (FO-48)

판매 페이지·라벨 원문 복사에는 `전성분:`·`전 성분`·`성분표`·`INGREDIENTS` 같은
**필드 표기**와 문장 끝 마침표가 딸려 온다. 정제 없이 분리하면 첫 토큰이
`전성분 정제수`로, 끝 토큰이 `부틸렌글라이콜.`로 미등록 오염된다.

**규칙**: 성분명이 될 수 없는 키워드(한·중·영 전성분 표기 + 뒤따르는 괄호 주석·콜론)를
구분자로 승격해 제거하고, 토큰 양끝의 문장부호(`.`, `。`, `…`, `:`, `：`)를
따옴표·괄호와 함께 벗긴다.

- 라벨은 성분명에 포함될 수 없는 키워드만 대상 — `전성분`·`성분표`·`ingredients?`
  계열. `제품명:` 등 다른 필드 라벨은 의도적으로 남긴다 — 원문 보존 원칙상
  사용자가 칩에서 삭제하는 게 안전하다
- 마침표류는 한국 INCI 성분명이 양끝에 가지지 않는 문자라 무손실 제거다
- 사진 인식 경로는 구조화 스키마로 성분 배열을 받으므로 이 정제가 필요 없다 —
  붙여넣기 전용이다

```js
// 의사코드 — 실제 구현은 product-store.js
const FIELD_LABEL = /전\s*성\s*분|全\s*成\s*分|성\s*분\s*표|ingredients?\b(?:\s+list)?/gi;
text.replace(FIELD_LABEL, '\n')   // 라벨 → 구분자로 승격 (괄호 주석·콜론 흡수)
    .replace(PROTECTED, '$1\x00$2')
    .split(SEP)
    .map(s => /* 쉼표 복원 → trim → 양끝 장식(따옴표·괄호·문장부호) 제거 → trim */);
```

### 4.3 후처리

- 토큰 앞뒤 공백·따옴표 제거, 빈 토큰·연속 구분자 흡수
- 괄호는 보존 — `정제수(정제수)` 같은 중복 표기도 전성분 원문 그대로가 가치
- **중복 성분 제거 안 함** — 전성분 원문의 재현이 우선 (같은 성분 중복 표기는 드물지만 원문 존중)
- 상한 절단은 `parseFullIngredientsDetailed`의 `dropped`로 노출 — 폼 카운터가 '상한 초과 N종 잘림' 경고 (FO-49). 임포트·저장 경로의 절단은 폼 카운터 범위 밖이다
- 매칭은 저장 후 분석 단계에서 `normalizeEntityName`으로 수행 — 저장값은 원문 유지

### 4.4 입력 UX (등록·수정 폼 패널)

```
[제품명*] [브랜드] [제형 select]
[전성분 textarea — 붙여넣기]   → 입력 중 실시간 칩 미리보기
[칩 영역]  정제수  글리세린  부틸렌글라이콜  …(파싱 순서)
           └ 미등록 성분은 '미등록' 칩 강조 + 탭 시 자가 등록 단축(FO-32)
[메모]     [저장]
```

- 칩은 순서대로 나열, 개별 ✕ 삭제 가능 — 파싱 오류를 저장 전 교정
- 성분 수·미등록 수 실시간 표시

---

## 5. 분석 엔진 — 조회 시점 라이브 매칭 (FO-39)

### 5.1 유형 분류기 — `classifyProductIngredients(product, index)`

`checkIngredient`는 농도 필수 경로라 재사용하지 않는다. 기성품에는 함량 정보가 없으므로 **함유 여부 + 유형 분류**가 맞는 시각이다 — 공식 인덱스 조회 후 `type`만 분류하는 경량 로직:

| 인덱스 결과 | 분류 | 배지 | 비고 |
|---|---|---|---|
| `index.get(name)` 없음 | `unknown` | **DB 미등록** | 자가 사전 등록 단축 제공 |
| `custom`/`type:'custom'` | `custom` | **자가 등록** | DI-07 계승 — 법정 판정 아님을 문구로 구분 |
| `type:'banned'` 또는 한도문에 '사용 불가/금지' | `banned` | **금지 성분명 매칭** | ⚠ 책임 경계 — 아래 §9 |
| `type:'restricted'` | `restricted` | **사용 제한** | 한도는 농도를 몰라 판정 불가 → '원문 확인' 안내 |
| 그 외 | `official` | **공식 등록** | |

인덱스는 `formula.js`의 `getIndex()` 재사용 (공식 DB + 자가 사전 병합본 — 싱글턴이라 비용 없음).

### 5.2 제품 요약 — `summarizeProduct(product, index)`

`{official, restricted, banned, custom, unknown}` 카운트 → 목록 카드에 `금지매칭 N · 제한 N · 미등록 N` 배지. `official`만 있으면 '전성분 공식 매칭' 표시.

### 5.3 조회 정규화 계층 — `ingredientMatchKey`·괄호 병기·동의어 (FO-50)

'미등록' 오분류의 주원인은 표기 변형이다. 조회 경로에만 느슨한 키를 쓰고
식별(중복 검사·역정규화)은 `normalizeEntityName`을 유지한다 — 표기 변형이
다른 항목을 합치는 것보다 '미등록'이 낫다는 기존 원칙의 연장.

| 계층 | 메커니즘 | 해결 사례 |
|---|---|---|
| matchKey | 공백·대소문자 + 하이픈·대시 무시 | `1,2-헥산디올` ↔ `1,2 헥산디올` |
| 괄호 병기 부분 키 | DB명의 바깥쪽·괄호 내 요소를 부분 키로 인덱싱 | `비타민E` → `토코페롤(비타민E)`, `디부틸프탈레이트` → `프탈레이트류(…)` |
| 입력 괄호 분해 | 입력 병기의 바깥·안쪽 부분으로 재조회 | `살리실산(베타)` → `살리실산` |
| 명시 동의어 | 속칭·영문 → 표준명 (1회 전이) | `BHA`→`살리실산`, `산화아연`→`징크옥사이드`, `메칠파라벤`→`파라벤류` |

- 괄호 부분 키는 설명·제외 문구(`제외|한함|이하|이상|까지|로서|부가`)를 걸러낸다
- **별개 성분은 등록하지 않는다** — `스쿠알란↔스쿠알렌`·`세틸↔세테아릴`처럼
  화학적으로 다른 성분을 동의어로 매칭하면 금지·한도 배지가 오인된다
- 동의어 해석도 배지는 표준 엔트리 기준 — '참고 매칭' 별도 표기는 하지 않는다
  (속칭 입력에 '공식 등록'이 뜨는 것이 사용자 기대)
- 역조회·알레르기 교차·3분할 비교도 matchKey로 통일 — 역조회는 동의어 맵을
  양방향 확장해 클래스↔개별 성분을 상호 커버한다

---

## 6. 교차 분석 (FO-40)

### 6.1 성분 → 제품 역조회 — `findProductsByIngredient(name)` (FO-51)

전 제품 순회 → 해당 성분을 함유한 제품 목록. 규모(≤30종×150성분)가 작아 조회 시점 선형 검색 — 별도 역인덱스 유지 불필요.

매칭 규칙은 `ingredientMatchKeys(name)`(matchKey + 동의어 양방향 키 집합) +
`ingredientKeyHit`(정확 키 또는 양방향 함유 일치)로 통일:

- **동의어 확장** — '파라벤류' 검색은 '메칠파라벤' 함유 제품까지, 역방향도 동일
- **부분일치** — '파라벤' 같은 부분 검색은 함유 관계 양방향으로 포착
  (알레르기 교차 §6.2와 같은 `includes` 규칙)
- 목록 성분 필터(`prodFilter.ingredient`)도 같은 헬퍼 사용 — 인라인 비교 이원화 해소
- 사전 배지 '함유 기성품 N개'는 정확 정규화 카운트(플랫폼 격리상 도메인 조회
  함수에 접근하지 않음) — 필터 목록이 확장 상위집합이라 실표시는 같거나 넓다

**사전 상세 연동**: 성분 사전 상세 카드에 '함유 기성품 N개' 섹션 → 탭 시 기성품 상세로 이동 (DI-06 진입점과 같은 교차 참조).

### 6.2 고객 알레르기 교차 — `findAllergyHits(product, allergies)`

`formula-batch.js`의 부분일치 패턴 재사용 (`제품성분.includes(알레르기어) || 알레르기어.includes(제품성분)`) — '파라벤류' 같은 포괄 태그가 '메칠파라벤'을 잡도록.

- 고객 상세 패널: '알레르기 주의 기성품' 목록 (등록 제품 중 매칭 있는 것만)
- 제품 상세 패널: '알레르기 보유 고객' 역방향 표시 (고객 카드 있는 경우만)

### 6.3 포뮬러 전성분 비교 — `compareWithFormula(product, formula)`

제품 `ingredients` ↔ 포뮬러 `fullIngredients` (안정성 양호 포뮬러만)를 정규화 이름으로 3분할:

```
공통 성분   | 제품에만    | 내 포뮬러에만
정제수      | 향료        | 판테놀
글리세린    | …           | …
```

제품 상세의 '내 포뮬러와 비교' 셀렉트 → 전성분 보유 포뮬러 목록 → 3열 비교 뷰.

### 6.4 JSON 임포트·익스포트 — `serializeProduct`/`importProduct`

`serializeFormula`/`importFormula` 패턴: `{type:'formula-os-product', version:1, product}` 래퍼, id·타임스탬프는 가져오기 시 재부여, Free 한도 적용.

---

## 7. UI·UX 설계

### 7.1 허브 카드 — `formula.html`

업무 흐름 단계(①~⑤)가 아닌 보조 기능 → `is-continuous` 배지(`분석`), 법규 준수 카드와 같은 비순번 그룹. `data-biz` 미지정 → 전 유형 노출.

```html
<div class="trainer-menu-card" data-click="openProductPanel">
  <span class="trainer-step-badge is-continuous" aria-hidden="true">분석</span>
  …기성품 DB — 시판 제품의 전성분을 등록해 성분 분석·고객 알레르기 교차·내 포뮬러 비교
</div>
```

### 7.2 패널 구성 — 고객 관리와 동일한 3패널 패턴

| 패널 id | 역할 |
|---|---|
| `formula-product-panel` | 목록 — 카드(제품명·브랜드·성분 수·요약 배지) + 검색 + JSON 가져오기 |
| `formula-product-form-panel` | 등록·수정 폼 — §4.3 입력 UX |
| `formula-product-detail-panel` | 상세 — 전성분 순서 리스트 + 성분별 배지 + 교차 분석(알레르기·포뮬러 비교) |

- `formula.js`의 `PANELS` 배열에 3개 추가, `SUBNAV_ITEMS`에 `{id:'products', label:'기성품 DB', click:'openProductPanel'}` 추가 — `BIZ_PANELS` 미선언이라 전 유형 자동 노출 (§2-5)
- 뷰 컨트롤러: `views/formula-products.js` 신규 — `formula-batch.js`/`formula-customer.js` 분할 패턴 계승 (formula.js 비대화 방지 — ROAD-Q4)

### 7.3 모바일

- 폼 패널 사용이라 모달 잘림 이슈 없음 — 단 textarea·칩 영역은 `.dialog-card` 계약 불요(패널이므로)
- 칩 행·버튼 행은 mobilesafe 규약대로 flex-wrap 유지

---

## 8. 파일 인벤토리·게이트 영향

| 파일 | 변경 |
|---|---|
| `src/exams/cosmetic/product-store.js` | **신규** — 스토어 + 파싱 + 분류·교차 함수 |
| `src/exams/cosmetic/views/formula-products.js` | **신규** — 3패널 컨트롤러 |
| `src/storage-keys.js` | `PRODUCT_ITEMS` 키 + `BACKUP_KEYS` 편입 |
| `src/exams/cosmetic/views/formula.js` | `PANELS`·`SUBNAV_ITEMS` 확장 (임포트 없이 id만) |
| `src/exams/cosmetic/views/formula-customer.js` | 고객 상세에 알레르기 교차 섹션 |
| `src/views/dictionary.js` (또는 도메인 브리지) | 상세 카드 '함유 기성품' 섹션 |
| `html/exams/cosmetic/formula.html` | 허브 카드 + 패널 3개 마크업 |
| `css/exams/cosmetic/formula.css` | 제품 카드·칩·비교 3열 스타일 |
| `tools/check/domain-map.json` | 신규 파일 분류 등록 (check:domainmap) |
| `AGENTS.md` | 디렉토리 트리에 신규 파일 2개 추가 (check:inventory) |
| `docs/dev/SPEC.md` | FO-37~40 상태 ✅ 갱신 (구현 시) |
| `tests/` | §11 테스트 |

기존 `formula-store.js`·`formula-check.js`·`custom-ingredient-store.js`는 변경 없음 — 신규 모듈이 공개 API만 소비.

---

## 9. 안전·책임 원칙

1. **전성분은 사용자 기록** — 입력값을 법정 사실로 취급하지 않는다 (DI-07 계승)
2. **판정은 공식 DB 매칭만** — 사용자가 '이 성분은 안전' 등 선언하는 경로 없음. 미등록이면 '미등록'이지 위험 아님
3. **금지 매칭 배지의 문구 경계** — 시판 제품에서 `banned` 매칭은 대부분 동명이인·개정 시차·입력 오탈다. '금지 성분 함유' 단정이 아니라 **'금지 성분명 매칭 — 원문 확인 권장'** 수준 문구 유지
4. **한도 초과 판정 없음** — 함량 정보가 없으므로 '사용 제한'은 존재 표시까지만. 초과 여부는 사용자가 원문으로 확인
5. **네거티브 리스트 원칙(FO-25) 준수** — '공식 등록'은 별표 목록 확인 결과지 안전 보증이 아님을 안내 문구로 표기

---

## 10. 단계·범위 (승인: Phase A+B)

| Phase | 범위 | SPEC | 상태 |
|---|---|---|---|
| **A (MVP)** | 스토어·파싱·등록 폼·목록·상세 라이브 분석·성분 역조회(사전 연동) | FO-37, FO-38, FO-39 | ✅ 구현 |
| **B** | 고객 알레르기 교차(양방향)·포뮬러 비교·JSON 임포트/익스포트 | FO-40 | ✅ 구현 |
| C-1 | 전성분 순서 유효성 힌트(색소가 중간에 있으면 표시 오류 의심 — `COLORANT_RE` 역방향 검증) | FO-44 | ✅ 구현 |
| C-9 | 순서 힌트 색소 범주 확장 — `COLORANT_RE`를 별표2 색소 범주로(레이크·광택 안료·금속가루 등), 탈크·마이카 단독은 기재라 제외 | FO-53 | ✅ 구현 |
| C-2 | 제품↔제품 비교·유사 포뮬러 랭킹·분석 리포트 내보내기·성분 행→사전 링크 | FO-45 | ✅ 구현 |
| C-3 | 미등록 성분 일괄 자가 사전 등록 | FO-47 | ✅ 구현 |
| C-4 | 전성분 입력 정제 — 필드 라벨(전성분·성분표·INGREDIENTS) 구분자 승격 + 토큰 양끝 문장부호 제거 | FO-48 | ✅ 구현 |
| C-5 | 전성분 상한 절단 안내 — 파서 dropped 노출 + 폼 카운터 '잘림 N종' 경고 | FO-49 | ✅ 구현 |
| C-6 | 성분 매칭 보강 — matchKey·괄호 병기 부분 키·명시 동의어 | FO-50 | ✅ 구현 |
| C-7 | 역조회 부분일치 — 키 집합+함유 일치 통일, 성분 필터 확장 | FO-51 | ✅ 구현 |
| C-8 | 동명 리뉴얼 등록 — duplicate 코드 + allowVariant + 목록 '동명 N종' | FO-52 | ✅ 구현 |
| D (후보) | 제품 공유 형식·바코드 조회 등 | 후속 착수 시 신규 ID | 미착수 |

구현 중 확인·수정된 결함: 제형 라디오 칩 `productNew` 잔류(`catEl.value` 무동작 — `checked` 리셋으로 수정), 성분 매칭 경로 불일치(원문 키 vs `normalizeEntityName` — `findIngredient()` 정규화 폴백으로 통일), 제한 원료 한도의 `title` 툴팁 전용 노출(모바일 불가 — `prod-ing-note` 인라인 노트로 상시 표시).

---

## 11. 테스트 계획

| 계층 | 대상 | 핵심 단언 |
|---|---|---|
| 유닛 (`tests/unit/`) | `parseFullIngredients` | **`1,2-헥산디올` 등 자릿수 쉼표 보호**, 쉼표/개행/중점 혼합 구분, 빈 토큰·150종 상한·순서 보존, **필드 라벨 승격·문장부호 정제 (FO-48)**, **상한 절단 `dropped` 노출 (FO-49)** |
| 유닛 | 스토어 CRUD | 한도·중복(brand+name 정규화)·sanitize·import/export 라운드트립 |
| 유닛 | `classifyProductIngredients`·`findProductsByIngredient`·`findAllergyHits`·`compareWithFormula` | 유형 분류 5분기·역조회·부분일치·3분할 |
| DOM (`tests/dom/exams/cosmetic/`) | 패널 렌더·등록 폼·배지·서브내비 칩·허브 카드 노출 | 칩 미리보기·요약 배지·전 유형 노출(data-biz 부재) |
| E2E | `mobile-overflow.spec.js` 패턴 확장 | 폼 패널 모바일 잘림 — 칩 영역 길어질 때 스크롤 |

`@spec FO-37~40` 태그를 테스트에 부여 — specrefs 테스트 갭 기준선(0) 유지.
