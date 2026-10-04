# 기성품 사진 인식 등록 설계안 (Formula OS — LLM 비전)

> 상위 문서: [`PRODUCT_DB_DESIGN.md`](PRODUCT_DB_DESIGN.md) (기성품 전성분 DB — FO-37~40)
> 범위: 제품 사진(정면: 제품명·브랜드 / 후면: 전성분)을 Gemini Flash에 보내 전성분을 추출, 기존 등록 폼에 프리필
> 상태: 📋 설계 확정 — 구현 착수 전 (BYOK + Gemini Flash + 멀티샷 범위 승인됨)
> **관련 SPEC ID**: `FO-41,FO-42,FO-43` (SPEC §3.18) · 선행 `FO-37~40`(기성품 DB) · `FO-32`(미등록 원료 즉시 등록)
> **문서 ID**: DOC-DSN-13

---

## 1. 배경·목적

기성품 DB(FO-37~40)의 입력 UX 병목은 전성분 타이핑·붙여넣기다. 모바일에서는 제품 라벨 사진을 찍어 바로 등록하는 것이 자연스럽다. LLM 비전 모델은 곡면 라벨·축약 표기·광택 반사 등 규칙 파싱이 실패하는 조건에서도 한국어 전성분을 문맥으로 복원할 수 있어, 사진 → 전성분 추출의 적합한 경로다.

**목적**: 사진 1~2장으로 기성품 등록 폼을 프리필해 사용자는 **검토·수정·저장**만 하도록 한다. LLM 출력을 그대로 저장하지 않는다 — 기존 칩 미리보기가 사람 검증 게이트 역할을 한다.

---

## 2. 핵심 설계 결정

| # | 결정 | 선택 | 근거 |
|---|------|------|------|
| 1 | API 키 제공 | **BYOK — 사용자 자기 Gemini 키** | 프로젝트는 정적 배포 전용 — 서버리스 프록시가 없으므로 공유 키를 숨길 수 없다. 사용자 키를 디바이스에만 저장하면 인프라 비용 0, 키 유출 범위는 본인 디바이스로 한정 |
| 2 | 모델 | **Gemini Flash** (`gemini-2.0-flash` 계열) | 한국어 비전 인식 품질 우수, 무료 티어 1500회/일이라 개인 BYOK는 사실상 무료, `generateContent` REST 엔드포인트가 브라우저 fetch와 CORS 호환 |
| 3 | 인입 방식 | **정면+후면 멀티샷** (1~2장, 선택적) | 제품명·브랜드는 정면, 전성분은 후면 라벨에 있어 단일 샷으로는 정보가 갈린다. 정면 없이 후면만으로도 등록 가능(이름 수동 입력) — 사용자 승인 범위 |
| 4 | 결과 경로 | **폼 프리필 — 직접 저장 금지** | LLM 출력은 초안. 기존 `prod-inci-chips` 칩 미리보기(FO-38)가 검토 단계로 동작하고 미등록 칩 강조가 할루시네이션을 시각화한다. 저장은 기존 `productSave`/`createProduct` 경로 — 한도·중복·정제 규칙 동일 적용 |
| 5 | 저장 계약 | **성분명 문자열 배열만** — 추출 신뢰도·원본 이미지 비저장 | 스키마 확장 없음(§3). 사진은 검토 후 폐기 — localStorage 쿼터와 프라이버시 모두에서 저장 근거 없음 |
| 6 | 키 저장 | **`FORMULA_GEMINI_KEY` 디바이스 로컬** — `BACKUP_KEYS` 제외 | 크리덴셜이 백업 JSON·클라우드 동기에 섞이면 다른 기기/백업 파일로 키가 유출된다. storage.js 추상화 경유, 백업 대상에서 의도적 제외 |

---

## 3. 아키텍처 — 호출 흐름

```
[제품 등록 폼]
  '사진으로 등록' 버튼
    │
    ▼
[사진 수집 패널]  <input type="file" accept="image/*" capture="environment">
    │            정면(선택) + 후면(필수) 슬롯, 각각 썸네일·재촬영
    ▼
[전처리]        캔버스 리사이즈(장변 ≤1024px) → JPEG quality 0.85 → base64
    │            목표: 사진당 ~100–300KB (모바일 업로드·토큰 비용 절감)
    ▼
[Gemini 호출]   POST generativelanguage.googleapis.com/v1beta/models/
    │           gemini-2.0-flash:generateContent?key=<BYOK>
    │           contents[].parts: inline_data(image/jpeg)×N + 프롬프트 텍스트
    │           generationConfig.responseMimeType = 'application/json'
    ▼
[응답 파싱]     {name?, brand?, ingredients[]} — JSON 파싱 실패 시 1회 재시도 없이
    │           폼 프리필 취소 + '인식 실패' 안내 (재촬영 유도)
    ▼
[폼 프리필]     prod-name·prod-brand·prodForm.ingredients 채움 → renderInciChips()
    │           원본 썸네일을 폼 상단에 대조용으로 병기
    ▼
[사용자 검토]   칩 수정·삭제·미등록 '사전 등록'(FO-32) → productSave() (기존 경로)
```

**모듈 분할** — `src/exams/cosmetic/product-vision.js` 신규. 이미지 전처리·API 호출·응답 파싱만 담당하고, DOM 바인딩·저장은 `formula-products.js`가 이어받는다 (뷰 컨트롤러 비대화 방지 — 기존 패턴 계승).

### 3.1 프롬프트 계약

```
시스템 지시(프롬프트 본문에 포함 — REST 단일 요청):
- 한국 화장품 라벨 사진이다. 전성분(全成分) 표기를 표시 순서 그대로 추출하라.
- 성분명 내부의 숫자 쉼표(1,2-헥산디올)는 토큰을 나누지 않는다.
- 광고 문구·사용법·제조번호 등 전성분 외 텍스트는 무시한다.
- 읽을 수 없는 부분은 추측하지 말고 빼라 — 배열은 읽힌 성분만 담는다.
- 정면 사진이 있으면 제품명·브랜드를 추출한다.
응답 스키마(generationConfig.responseSchema):
{ type: OBJECT, properties: {
    name: STRING, brand: STRING,
    ingredients: { type: ARRAY, items: STRING } },
  required: ['ingredients'] }
```

`responseMimeType: 'application/json'` + `responseSchema`를 함께 지정하면 구조화 출력이 보장된다 (Gemini API 지원 기능 — 프리폼 텍스트 파싱 불필요).

### 3.2 CSP·보안 변경

`vercel.json`의 `connect-src`에 `https://generativelanguage.googleapis.com` 추가 — 유일한 인프라 변경. 로컬 `serve.js`가 헤더를 미러링한다면 동일 반영.

- API 키는 쿼리스트링 `?key=`로 전달 (Gemini REST 규약 — 헤더 방식 `x-goog-api-key`도 가능하면 헤더 우선: URL이 로그·히스토리에 남지 않음)
- 키 입력 UI: 설정 영역이 아닌 사진 수집 패널 내 'API 키 설정' 접힘 블록 — 첫 사용 시 안내와 함께 노출, 저장 후에는 마스킹 표시(`sk-…끝4자리`)·삭제 버튼
- **키는 `BACKUP_KEYS` 제외** — `storage-keys.js` 도메인 섹션에 '백업 제외' 주석 명시 (§2-6)

### 3.3 오류 경로

| 상황 | 처리 |
|---|---|
| 오프라인 | fetch 실패 → '네트워크 연결 필요' 토스트, 수동 붙여넣기 안내 |
| 키 미설정·무효 (400/403) | 키 입력 블록 펼침 + 발급 안내 (Google AI Studio 링크) |
| JSON 파싱 실패·빈 ingredients | '전성분을 읽지 못했습니다 — 라벨이 잘 보이는 후면 사진으로 재촬영' |
| 응답 지연 | 로딩 스피너 + 취소 버튼 — AbortController |
| 비라벨 사진 | ingredients 빈 배열 → 위와 동일 경로 (LLM이 라벨 아님을 판별하도록 프롬프트 포함) |

---

## 4. 데이터·스토리지 계약

| 키 | 값 | 백업 | 비고 |
|---|---|---|---|
| `FORMULA_GEMINI_KEY` | 사용자 Gemini API 키 (평문 문자열) | **제외** | 디바이스 로컬 크리덴셜 — 동기 시 타기기 유출 방지 |

- 추출 결과는 기존 `product_items` 스키마로 저장 — 스키마 변경 없음
- 사진·응답 원문은 저장하지 않는다 (메모리상 폐기) — 쿼터·프라이버시
- `manifest.json` 기능 게이트 불필요 — BYOK라 기능 자체는 무료, `feature-plan.json` Pro 게이트는 **적용하지 않음** (사용자가 자기 비용 부담 — 앱이 과금할 이유 없음)

---

## 5. UI·UX 설계

### 5.1 진입점 — 기성품 폼 패널

`formula-product-form-panel` 상단에 '사진으로 채우기' 버튼 추가 — 등록(productNew)·수정(productEdit) 폼 모두에서 사용 가능. 수동 입력과 혼합 가능(일부만 인식돼도 나머지는 타이핑).

```
[사진으로 채우기 ▾]
  ├ 정면 사진 (제품명·브랜드)  [촬영/선택]  썸네일 + ✕
  ├ 후면 사진 (전성분 — 필수)  [촬영/선택]  썸네일 + ✕
  ├ [AI로 전성분 읽기]  ← 후면 1장 이상일 때 활성
  └ [API 키 설정 ▾]  (미설정 시 자동 펼침)
```

- `capture="environment"`는 모바일에서 후면 카메라 론치, 데스크탑에서는 파일 선택으로 폴백 — 단일 input이 양쪽 커버
- 인식 완료 후 원본 썸네일은 폼 상단 '참조 사진'으로 유지 — 칩과 대조 가능
- 모달 불사용 — 폼 패널 인라인 확장 (기존 '모달이 아닌 폼 패널' 결정 계승, PRODUCT_DB_DESIGN §2-6)

### 5.2 모바일

- `accept="image/*"` file input은 모바일 브라우저·PWA 모두 지원 — getUserMedia 불요(권한 프롬프트·HTTPS·video 스트림 관리 회피)
- 촬영 → 리사이즈는 디코딩 비용 고려해 `createImageBitmap` 우선, 미지원 시 `Image` 폴백

---

## 6. 파일 인벤토리·게이트 영향

| 파일 | 변경 |
|---|---|
| `src/exams/cosmetic/product-vision.js` | **신규** — 이미지 전처리·Gemini 호출·응답 파싱 |
| `src/exams/cosmetic/views/formula-products.js` | 사진 수집 UI·키 관리·프리필 바인딩 |
| `html/exams/cosmetic/formula.html` | 폼 패널에 사진 인입 섹션 마크업 |
| `css/exams/cosmetic/formula.css` | 사진 슬롯·썸네일·참조 사진 스타일 |
| `src/storage-keys.js` | `FORMULA_GEMINI_KEY` — 백업 제외 주석 |
| `vercel.json` (+`serve.js` 미러 시) | `connect-src`에 Gemini 도메인 추가 |
| `tools/check/domain-map.json` | `product-vision.js` 분류 (glob 커버면 불필요) |
| `AGENTS.md` | 트리에 신규 모듈 등록 |
| `docs/dev/SPEC.md` | FO-41~43 선언 (이 문서와 함께) |
| `tests/` | §8 테스트 |

---

## 7. 안전·책임 원칙

1. **LLM 출력은 초안** — 사용자 검토 없는 저장 경로를 만들지 않는다 (PRODUCT_DB_DESIGN §9 계승)
2. **할루시네이션 시각화** — 추출 성분의 미등록 칩 강조는 이미 구현된 방어선. 추가로 인식 결과 상단에 '사진 인식 초안 — 원본 라벨과 대조하세요' 안내 문구 표시
3. **키는 사용자 소유·디바이스 로컬** — 앱이 키를 수집·중계·백업하지 않는다. 키 삭제 시 저장소에서 즉시 제거
4. **사진은 폐기** — 추출 후 원본 이미지·응답 원문을 영속하지 않는다. 참조 썸네일은 세션 DOM에만 존재
5. **네거티브 리스트 원칙 동일** — 추출 성분의 배지 판정은 기존 라이브 매칭 경로를 그대로 탐 — 인식 경로가 분석 결과에 영향을 주지 않음

---

## 8. 테스트 계획

| 계층 | 대상 | 핵심 단언 |
|---|---|---|
| 유닛 (`tests/unit/`) | 이미지 전처리·프롬프트 빌드·응답 파싱 | 캔버스 리사이즈 목업·JSON 스키마 파싱·오류 분기(키 무효·파싱 실패·빈 배열)·fetch 요청 형상(헤더 키·inline_data 구조) |
| 유닛 | 키 저장 계약 | `FORMULA_GEMINI_KEY` 저장·조회·삭제 + `BACKUP_KEYS` 미포함 단언 |
| DOM (`tests/dom/exams/cosmetic/`) | 사진 슬롯·키 입력 UI·프리필 | file input 존재·fetch 모킹으로 성공/실패 프리필·칩 렌더·'사전 등록' 단축 유지·원본 썸네일 표시 |
| 수동/E2E | 실기기 카메라 론치 | `capture="environment"` 동작 — 자동화 불가 영역이라 수동 확인 항목으로 문서화 |

`@spec FO-41~43` 태그 부여 — specrefs 기준선 유지.

---

## 9. 후속 범위 (미승인 — 착수 시 신규 ID)

- **Supabase Edge Function 프록시** — 공유 키 무설정 UX. Pro 게이트 후보. 로그인·레이트리밋·남용 방지 설계 선결
- **온디바이스 OCR 폴백** (Tesseract.js kor) — 오프라인 경로. 정확도 한계로 미등록 칩이 대량 발생할 수 있어 'OCR 초안' 별도 표기 필요
- **멀티샷 확장** — 성분표가 둘로 갈린 제품(본품+포장지) 다중 후면 샷
- **바코드 연동** — 제품 바코드 → 공개 DB 조회는 별도 데이터 소스 계약 필요
