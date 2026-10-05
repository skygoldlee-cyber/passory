# 종합 규정 점검 보고서 설계안 (Formula OS)

> 상위 문서: [`FORMULA_OS_WORKFLOW_DESIGN.md`](FORMULA_OS_WORKFLOW_DESIGN.md) (조제관리사 업무 전체 커버리지)
> 범위: 사업 유형별 법규 점검 자산(체크리스트·표시사항·광고 점검·포뮬러 검증·기록 요약)을 한 장의 종합 감사 보고서로 출력
> 상태: 📐 설계안 — 미구현
> **관련 SPEC ID**: `FO-56`(예정 — 구현 착수 시 SPEC §3.18에 선언) · 선행 `FO-33`(사업 유형) · `FO-34`(유형별 체크리스트 세트) · `FO-35`(표시사항) · `FO-36`(광고 점검) · `FO-14`(전성분 생성) · `FO-24`(고시 감지)
> **문서 ID**: DOC-DSN-14

---

## 1. 배경·목적

Formula OS의 법규 점검 자산은 여러 패널에 분산돼 있고, 출력 가능한 증적 문서가 없다:

| 자산 | 현재 상태 | 증적 출력 |
|------|----------|----------|
| 법규 준수 체크리스트 (FO-19·34) | 유형별 3세트, 체크 상태+시각 영속 | 없음 — 진행 배지만 표시 |
| 표시사항 검토 (FO-35) | 드래프트 폼 + 필수 기재 체크 | 라벨 시트 인쇄 (입력값만, 점검 판정 X) |
| 광고 문구 점검 (FO-36) | 린트 실행 결과 | 없음 — 결과가 휘발성 |
| My 포뮬러 규정 검증 | 카드별 배지 | 없음 |
| 조제·제조 기록 | 배치별 기록지 인쇄 | 개별 문서만 — 요약 없음 |

사용자 시나리오는 지방식약청 실사 대비·자체 정기 점검의 **점검 수행 증적**이다. "사업 유형 선택 → 유형별 점검 수행 → 종합 보고서 출력"의 흐름으로, 개별 패널 데이터를 한 문서로 모은다.

---

## 2. 핵심 설계 결정

| # | 결정 | 선택 | 근거 |
|---|------|------|------|
| 1 | 출력 방식 | **`printHtml()` + `fp-doc` 재사용** | 기존 4종 산출물(조제 기록지·라벨·안내문·작업지시서)과 동일 메커니즘 — PDF는 브라우저 'PDF로 저장', 서버·외부 라이브러리 불요, 오프라인·PWA 동작 |
| 2 | 데이터 시점 | **출력 순간 라이브 수집** | 보고서 결과 자체를 저장하지 않는다 — 출력이 곧 스냅샷. 고시 개정 반영·스토어 갱신이 재출력에 자동 반영 (기성품 DB의 라이브 매칭 결정과 동일 원칙) |
| 3 | 섹션 범위 | **`bizVisible()` 게이트 재사용** | sales 유형에 조제 기록 섹션이 나오는 식의 부자연을 `BIZ_PANELS` 선언 하나로 방지 — 유형 게이트 SSOT |
| 4 | 광고 점검 결과 | **신규 영속 키 (최근 실행 1건)** | 현재 결과가 휘발성이라 보고서 근거 데이터가 없다. `FORMULA_LABEL_DRAFT`와 동류의 '작업 데이터'로 영속 |
| 5 | 모듈 위치 | **수집기는 신규 도메인 모듈, 빌더는 `formula-print.js`** | fp-doc 빌더 일원화 원칙 유지. `formula-compliance.js`(416행)의 비대화 방지 — 수집 로직은 뷰가 아닌 도메인 계층 |
| 6 | 개인정보 | **법적 증적 필요 범위는 실값 포함** — 고객명·알레르기·상담 이력 | 고객 상담 기록·판매내역은 법정 보관 의무라 이름 자체가 증적이다. 단 증적과 무관한 집계 영역(포뮬러 검증·원료 현황의 개별 명칭)은 요약 수준 유지. 출력물에 개인정보 취급 주의 문구를 넣는다 |
| 7 | 보고서 보관 | **스냅샷 저장 안 함 (Phase 2 보류)** | 재열람 수요가 생기면 `audit_reports` 스토어로 확장 — 이번 범위는 즉시 출력만 |

---

## 3. 보고서 구성 명세

출력 문서는 헤더 → 요약 스코어카드 → 섹션 본문 → 서명·면책 순이다.

### 3.1 헤더

```
종합 점검 보고서
사업 유형: 화장품제조업 (제조업 등록 — CGMP 기준 품질관리)
점검 기준: 화장품제조업 (CGMP) 체크리스트 · 발행일시: 2026-10-05 14:32
```

- 사업 유형: `getBizType()` → `BIZ_TYPES[id].label` + `desc`
- 점검 기준: 활성 `CHECKLIST_SETS` 세트의 `label`

### 3.2 요약 스코어카드 (섹션 목록 상단)

각 섹션 상태를 한 줄 요약 테이블로 — 보고서 수신자가 첫 장에서 현황을 파악:

| 점검 영역 | 상태 |
|----------|------|
| 법규 준수 체크리스트 | 12/16 항목 점검 (미점검 4) |
| 표시사항 자가점검 | 필수 6/8 기재 — 미기재 2 |
| 광고 문구 점검 | 최근 점검 2026-10-04 — 적발 3건 |
| 포뮬러 규정 검증 | 저장 5건 — 금지 0·초과 1·확인 필요 2 |
| 조제·제조 기록 | 배치 12건 — QC 이상 1·위생 미완료 0 |
| 원료 기한 관리 | 등록 34종 — 경과 2·임박 3 |
| 상담 기록 | 고객 8명 — 상담 이력 21건 |

### 3.3 섹션 본문

| # | 섹션 | 유형 게이트 | 내용 |
|---|------|------------|------|
| ① | 고객 상담 기록 | `customer` (custom·sales) | **고객별 행** — 이름·피부타입·알레르기 목록·상담 건수·최근 상담일 + 고객별 최근 상담 이력(날짜·내용, 상한 적용) — '고객 상담·알레르기 정보 기록' 의무의 증적 |
| ② | 표시사항 자가점검 | `label` (mfg·sales) | `LABEL_FIELDS`별 기재/미기재 + '해당 시' 표기 + 미기재 필수 항목 수 + 기능성 수동 확인 표시 |
| ③ | 광고 문구 점검 | `adlint` (mfg·sales) | 최근 실행 시각 + 카테고리별 적발 건수 + 적발 표현 목록(표현·분류·수정 가이드) |
| ④ | 포뮬러 규정 검증 | `calc` (custom·mfg) | 포뮬러별 이름 + 금지/초과/확인/정상 건수 + 기준 변경 원료 수 + 안정성 경고 수 |
| ⑤ | 조제·제조 기록 요약 | `batch` (custom·mfg) | 배치 총 수·최근 배치일·QC 이상 건수·위생 미완료 건수 (`batchQcSummary` 재사용) + 최근 배치 목록(배치번호·처방명·**고객명**·조제일 — 판매내역 증적) |
| ⑥ | 원료 기한 관리 | `material` (custom·mfg) | 등록 원료 수·기한 경과 n·임박 n·미등록(기한 없음) n (`materialStatus`) |
| ⑦ | 법규 준수 체크리스트 | 전 유형 | 활성 세트 전 항목 — 섹션별 n/m + 항목별 ☑/☐ + 점검일 + note + 근거 문서 라벨 (미점검 항목은 note·근거 생략 한 줄 압축) |

- **표시 순서** (후속): 고객 정보가 맨 앞, 법규 준수 체크리스트가 맨 뒤 — 실무 증적(고객·기록)을 먼저 제시하고 준수 점검으로 마무리하는 흐름. 번호는 노출 섹션 기준 자동 매김.

- **미수집 섹션**: 데이터 소스가 비어 있으면 섹션 제목 + "기록 없음 — 해당 점검 미실시" 한 줄 출력. '미실시' 자체가 증적 가치이므로 생략하지 않는다. 유형 게이트로 제외된 섹션만 완전 생략.
- **잔존 데이터 예외** (후속 — FO-56 후속): 패널이 현재 유형 비대상이어도 실제 데이터가 잔존하면(유형 전환 전 기록 등) 감사 증적이므로 섹션을 포함하고 요약에 "현재 사업 유형 비대상 잔존 데이터"를 병기한다. 비대상 + 빈 데이터 조합만 완전 생략.
- **점검 0건 허용**: 체크 0개 상태도 출력 가능 — "전체 미점검" 보고서가 다음 점검의 기준선 역할.

### 3.4 서명·면책

기존 `fp-sign-row`·`fp-disclaimer` 패턴:

```
점검자(조제관리사/책임판매관리자): ______  확인자: ______  확인일: ______
본 보고서는 자가점검용 참고 자료이며 법률 자문이 아닙니다.
실제 의무·기준의 판단은 법령 원문과 관할 지방식약청 안내를 따르세요.
⚠ 본 문서에는 고객 개인정보(이름·피부 정보·상담 내용)가 포함될 수 있습니다 — 출력물의 보관·폐기에 주의하세요.
```

---

## 4. 데이터 수집 설계

### 4.1 수집기 — `collectAuditReportData()`

DOM 비의존 순수 함수 — 모든 소스를 읽기 전용으로 호출하고 보고서 뷰모델을 반환한다. 스토어 모듈은 수집기를 모른다 (단방향 의존).

| 섹션 | 소스 | 호출 | 비고 |
|------|------|------|------|
| 헤더 | `biz-profile.js` | `getBizType()`, `BIZ_TYPES` | — |
| ① | `formula-compliance.js` | `CHECKLIST_SETS`, `bizChecklistSet`, 체크 상태 | `loadChecks`는 현재 모듈 내부 — export로 승격 또는 수집기에서 키 직접 읽기(세트 `key` 재사용) |
| ② | `formula-sales.js` | `summarizeLabelDraft()` (신규 export) | 기존 `labelChecklistHtml`의 판정 로직을 순수 요약 함수로 추출해 패널·보고서 공용 |
| ③ | 스토리지 | `getJSON(STORAGE_KEYS.FORMULA_ADLINT_STATE)` | §5 신규 키 |
| ④ | `formula-store.js` + `formula-check.js` + `formula-stability.js` | `listFormulas()`, `checkFormulaItems`, `evaluateStability`, `getIndex` | 카드 배지(`checkSummaryHtml`)와 동일 계산 — `countChangedStandards`는 현재 formula.js 내부라 수집기로 이관·재사용 검토 |
| ⑤ | `batch-store.js` | `listBatches()` + `batchQcSummary` | 요약 + 최근 배치 행(고객명 포함) — 개별 배치 상세는 기존 기록지 인쇄의 영역 |
| ⑥ | `material-ledger.js` | `listMaterials()` + `materialStatus` | 기한 상태는 저장값이 아닌 조회 시 계산 — 수집 시점 계산 그대로 사용 |
| ⑦ | `customer-store.js` | `listCustomers()` + `consultLog` | 고객별 행 + 최근 상담 이력 — 상담 원문 상한은 §9-4 참조 |

### 4.2 뷰모델 스키마

```js
{ generatedAt: 'ISO',
  biz: { id, label, desc },
  checklistSet: { id, label, total, done },
  sections: [
    { id: 'checklist', title, summary, rows: [...] },   // ①
    { id: 'label',     title, summary, rows: [...] },   // ② — 게이트 제외 시 sections에 미포함
    ...
  ] }
```

`buildAuditReportHtml(data)`는 이 뷰모델만 받아 `fp-doc` HTML을 만든다 — 수집과 렌더를 분리해 각각 단위 테스트 가능하게 한다.

### 4.3 모듈·파일 배치

| 파일 | 변경 |
|------|------|
| `src/exams/cosmetic/views/formula-audit.js` | **신규** — `collectAuditReportData()` + `auditPrintReport()` 핸들러. views 배치 이유: 수집 대상이 compliance·sales·formula 뷰 모듈이라 동층 배치가 뷰 간 import 관례와 정합 |
| `src/exams/cosmetic/views/formula-print.js` | `buildAuditReportHtml()` 추가 (fp-doc 패턴) |
| `src/exams/cosmetic/views/formula-sales.js` | `summarizeLabelDraft()` 추출·export, `adlintRun`에 결과 영속, `adlintClear`에 영속 삭제 |
| `src/exams/cosmetic/views/formula-compliance.js` | `loadChecks` export 승격 — 수집기가 같은 파싱을 공유 |
| `src/storage-keys.js` | `FORMULA_ADLINT_STATE` + `BACKUP_KEYS` 등록 |
| `html/exams/cosmetic/formula.html` | compliance 패널 헤더에 '종합 보고서' 버튼 → `build:html` 재생성 |
| `src/practice-registry.js` | `audit` 로더 + `auditPrintReport` 핸들러 등록 |
| `domain-map.json` | glob 규칙(`src/exams/cosmetic/views/*.js`·`tests/*/exams/cosmetic/`)으로 자동 커버 — 별도 선언 불필요 |
| `docs/dev/SPEC.md` | FO-56 행 + 구현 코드에 `@spec FO-56` |

---

## 5. 광고 점검 결과 영속화 (신규)

현재 `adlintRun`은 결과를 DOM에만 출력한다. 보고서 §③의 근거 데이터로 최근 실행 1건을 영속한다.

```js
// STORAGE_KEYS.FORMULA_ADLINT_STATE = 'formula_adlint_state'
{ text: '점검 대상 원문 (textarea maxlength 5000과 동일 상한)',
  hits: [{ term, category, label, suggestion }],   // lintAdCopy 결과 그대로
  at: 'ISO 시각' }
```

- 저장 시점: `adlintRun`에서 입력이 비어 있지 않고 실행 완료 시 덮어쓰기 (최근 1건만)
- `adlintClear`: 화면 초기화와 함께 영속 상태도 삭제 — 사용자의 명시적 비움을 반영
- `BACKUP_KEYS` 포함 — 작업 데이터 (LABEL_DRAFT와 동류)
- **미실시 표기**: state가 없거나 적발 0건이면 보고서에 "최근 점검 없음" / "적발 없음"으로 명시
- **원문 포함 여부**: 보고서 §③에 점검 대상 원문을 그대로 포함한다 — 점검 증적은 '무엇을 점검했는지'가 핵심. 다만 원문이 길 수 있으므로 본문은 접이식 없이 전문 출력하되, 필요 시 상한(예: 2000자 초과분 절단 + '…(이하 생략)') 적용 여부를 구현 시 결정 — §9 논의 사항

---

## 6. UI·진입점

- **버튼 위치**: 법규 준수 체크리스트 패널 헤더, `초기화` 옆 — `종합 보고서` (`data-click="auditPrintReport"`, `fa-file-lines` 아이콘)
  - 헤더 버튼이 2개→3개로 늘어나므로 `check:mobilesafe`(버튼 2+ 나열 행 줄바꿈) 통과 확인 필요
- **허브 진입점** (후속 — 발견성): '분석·법규 도구' 그리드에 `종합 보고서` 카드를 추가해 법규 준수 패널을 열지 않고도 바로 인쇄 가능하게 한다. 동일 `data-click="auditPrintReport"` — 별도 패널 없이 즉시 출력. `BIZ_GUIDE` 3유형 문구·법규 준수 카드 설명에 출력 경로를 병기한다
- **인쇄 영역**: 공용 `#formula-print-area` 재사용 — 기존 산출물과 충돌 없음 (출력은 직렬 사용자 액션)
- **앱 버전 표기**: 보고서 푸터에 `data/version.js`의 APP_VERSION을 표기해 산출 시점의 앱·원료 DB 기준을 남긴다 — 고시 개정 전후 출력물 구분 근거

---

## 7. 테스트 계획

| 수준 | 파일 | 검증 |
|------|------|------|
| 유닛 | `tests/unit/exams/cosmetic/formula-audit.test.js` | `collectAuditReportData` — 스토어 시드 후 뷰모델 스키마·유형별 섹션 게이트·빈 데이터 '기록 없음' 분기 |
| DOM | `tests/dom/exams/cosmetic/formula-audit.dom.test.js` | `auditPrintReport` → `#formula-print-area` 렌더 내용 단언(헤더·섹션·면책), `adlintRun`→영속→보고서 반영 왕복, `adlintClear` 삭제 |
| 기존 | `formula-compliance.dom.test.js` | 비파괴 — `loadChecks` export 승격 후에도 기존 시나리오 유지 |

- `check:specrefs` 기준선 규칙(신규 갭 즉시 실패)상 FO-56 `@spec` 태그는 테스트와 동반 필수
- `check:testfirst` — src 로직 변경이므로 테스트 동반 필수

---

## 8. 게이트·수반 작업 체크리스트

구현 PR에 포함될 정적 게이트:

- `npm.cmd run build:html` — formula.html 파셀 변경 반영 + `check:html`
- `domain-map.json` — glob 규칙으로 자동 커버, 선언 불필요 확인됨 (`check:domainmap`)
- `storage-keys.js` — 키·`BACKUP_KEYS` 선언 (`check:storage` — 직접 localStorage 접근 금지)
- `SPEC.md` FO-56 + `TRACE_MATRIX` 재생성 (`check:trace`)
- `check:mobilesafe` — 패널 헤더 버튼 3개 나열
- `check:docs` — 본 문서의 미구현 경로(`formula-audit.js`, 테스트 파일)는 `tools/config/docs_paths_allowlist.json`에 예외 등록됨
- `check:docsync` — 구현 시 AGENTS.md 디렉토리 구조(src/ 전수 트리)에 `formula-audit.js` 추가 필수

---

## 9. 미결정·논의 사항

| # | 쟁점 | 제안 |
|---|------|------|
| 1 | 광고 문구 원문의 보고서 포함 범위 | 전문 포함(증적 목적) + 2000자 상한 절단 — 구현 시 확인 |
| 2 | 기성품 DB(FO-37~) 섹션 포함 여부 | 제외 — 기성품은 규제 점검이 아닌 분석 도구. 보고서 성격(법규 증적)과 무관 |
| 3 | 체크리스트 3개 세트 전부 출력 vs 활성 세트만 | 활성 세트만 — 다른 유형의 점검 상태는 현재 사업 유형의 증적이 아님. 헤더에 세트 라벨 명시로 충분 |
| 4 | 고객 상담 이력의 원문 범위 | 고객별 최근 상담 N건(날짜+원문) 상한 — 이력 최대 100건·300자/건이라 전문 포함 시 문서가 폭증. 기본 3건·필요 시 '전체 이력 포함' 옵션을 구현 시 검토 |
| 5 | 보고서 스냅샷 저장·재열람 | Phase 2 보류 — 요구 발생 시 `audit_reports` 스토어 + 이력 패널로 확장 |
| 6 | Pro 게이팅 | free 유지 — Formula OS 법규 도구 전체가 현재 free, `feature-plan.json` 키 추가 불요 |
| 7 | `countChangedStandards` 재사용 방식 | formula.js에서 순수 함수로 이관해 카드·보고서 공용 — 구현 시 결정 |

---

## 10. 구현 순서 (제안)

1. **선행 데이터**: `FORMULA_ADLINT_STATE` 키 + `adlintRun` 영속 + `summarizeLabelDraft` 추출
2. **수집기·빌더**: `formula-audit.js` + `buildAuditReportHtml` + 유닛 테스트
3. **연결**: 마크업 버튼 + registry + domain-map + SPEC FO-56 + DOM 테스트
4. **게이트**: `check:content -- --quick` → `check:ci` 전수
