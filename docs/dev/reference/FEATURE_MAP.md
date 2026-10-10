# 🧭 기능 → 소스 지도 (Feature → Source Map)

> **최종 업데이트**: 2026-10-15
> **대상**: 개발자 — "이 기능을 바꾸려면 어느 파일을 열어야 하는가"를 즉시 찾는 조회표
> **관련 SPEC ID**: 해당 없음 (탐색 보조 문서)
> **문서 ID**: DOC-REF-13
> **범위**: platform · 판본: none

---

## 사용법

- **뷰 ↔ 파셜 ↔ URL 해시 ↔ SPEC 절** 매핑은 [`SCREEN_MAP.md`](SCREEN_MAP.md)가 담당 — 이 문서는 **파일 단위 소스 위치**를 안내합니다.
- 표의 **SPEC 접두사**는 `SPEC.md`의 요구사항 계열 — 코드의 `// @spec XX-nn` 태그와 연결됩니다.
- 생성물(`index.html`, `data/`, `sw.js` 스탬프)은 편집 금지 — 원본을 고치고 빌드로 재생성하세요 (`CODE_READING_GUIDE.md` §5).

## 1. 학습 도메인

| 무엇을 바꾸고 싶은가 | 핵심 소스 | 관련 테스트 | SPEC |
|----------------------|-----------|-------------|------|
| 대시보드 과목 카드·통계·히트맵·추천 | `src/views/dashboard.js` + `src/views/subject-stats.js` | `study-dashboard.dom.test.js` | D-* |
| 맞춤학습 진단 카드·주간 리포트 | `src/views/analysis-view.js` | `study-dashboard.dom.test.js` | AN-*, SC-11/12 |
| 예상 점수·실제 시험 결과 기록 | `src/views/score-estimate.js` | `study-dashboard.dom.test.js` | AN-05, D-14 |
| 추천 엔진 ("오늘의 합격 전략") | `src/recommendations.js` | `tests/unit/learning-pro.test.js` | AN-06 |
| 분석 계산 (취약 단원·성장·합격 갭·리포트) | `src/analysis-engine.js` | `tests/unit/analysis-engine.test.js`, `analysis-deepening.test.js` | AN-* |
| 플래시카드 세션·플립·스와이프 | `src/views/flashcard.js` | `study-flashcard.dom.test.js` | FC-* |
| 기출 퀴즈 출제·채점 | `src/views/quiz.js` + `src/questions.js` | `study-quiz.dom.test.js` | QZ-* |
| 오답 원인 태깅·재학습 | `src/views/quiz-wrong-cause.js` | `study-quiz.dom.test.js` | QZ-*, AN-07 |
| 오답 복습 (weak pool) | `src/weak-items.js` + `src/views/` review 흐름 | `tests/unit/property-based.test.js` (PBT) | RV-*, DR-* |
| 간격 반복 (SM-2 due 계산) | `src/spaced-repetition.js` | `tests/unit/property-based.test.js` (PBT 스코프) | FC-*/DR-* |
| 실전 모의고사·OMR | `src/views/exam-simulator.js` + `exam-sim-state.js` | `tests/dom/study-simulator.dom.test.js` | ES-* |
| 모의고사 결과 리뷰·오답 재응시 | `src/views/exam-sim-review.js` + `exam-sim-weak.js` | — | ES-* |
| 학습 캘린더·목표·스마트학습 배분 | `src/views/study-calendar.js` + `src/study-tracker.js` | `study-calendar.dom.test.js` | SC-* |
| 데일리 챌린지·스트릭 | `src/views/daily-challenge.js` | `study-challenge.dom.test.js` | SC-04 |
| 뽀모도로 타이머 | `src/views/pomodoro.js` | `study-pomodoro.dom.test.js` | — |
| 훈련소 허브·O/X 드릴·콤보 드릴 | `src/views/trainer.js`, `trainer-drills.js`, `trainer-drill-combo.js` | `tests/dom/study-trainer.dom.test.js`, `study-trainer-drills.dom.test.js` | DR-* |
| 배합 계산 연습기·스크래치패드 | `src/trainer-calc.js` + `src/views/trainer-calc-practice.js` + `src/scratchpad.js` | `tests/unit/trainer-calc.test.js`, `common-scratchpad.dom.test.js` | FO-*/DR-* |

## 2. 콘텐츠 읽기·뷰어

| 무엇을 바꾸고 싶은가 | 핵심 소스 | 관련 테스트 | SPEC |
|----------------------|-----------|-------------|------|
| 교재 리더 본문·목차·진도 | `src/views/textbook-reader.js` + `src/reader-toc.js` | `study-reader.dom.test.js` | TR-* |
| 리더 툴바·독서 설정·스크롤 | `src/views/reader-toolbar.js` | `study-reader.dom.test.js` | TR-* |
| MD 본문 후처리 (링크·강조 변환) | `src/reader-format.js` | `tests/unit/reader-format-general.test.js`, `reader-toc.test.js` | TR-* |
| 교재 검색 (역색인) | `src/views/textbook-search.js` | `study-search.dom.test.js`, `story-search.dom.test.js` | TS-* |
| 용어집 렌더·조회 | `src/views/glossary-renderer.js` + `src/glossary-query.js` | `common-glossary.dom.test.js` | TR-*/DI-* |
| 참조자료 링크·레지스트리 | `src/views/reader-ref-links.js` + `src/pdf-registry.js`(생성물) | `study-reader.dom.test.js` | RR-* |
| 법령 한글주소·고시 배너 | `src/law-links.js` + `src/notice-check.js` | `tests/unit/law-links.test.js` | RR-*, CE-* |
| 오디오북 플레이어 | `src/views/reader-audio.js` | `reader-audio.dom.test.js` | AO-* |
| 성분 사전 (knowledge 스키마 구동) | `src/views/dictionary.js` | `study-dictionary.dom.test.js`, `dictionary-*.dom.test.js` | DI-* |
| 문제집 뷰어 (PDF형 문서 열람) | `src/exam-viewer.js` | `study-examviewer.dom.test.js` | EV-* |
| 학습안내서·매뉴얼 뷰어 | `src/manual-viewer.js` | `study-manual.dom.test.js` | MV-* |
| Markdown → HTML 파서 | `src/markdown-parser.js` | `tests/unit/markdown-parser-general.test.js` | BP-* |
| Mermaid 다이어그램 렌더 | `src/mermaid-render.js` + `mermaid-utils.js` | `mermaid-zoom.dom.test.js` | TR-* |
| 이미지 확대·문서 오버레이 | `src/image-zoom.js` + `src/doc-overlay.js` | `doc-overlay.dom.test.js` | TR-* |

## 3. Formula OS (실무 영역, `src/exams/cosmetic/`)

| 무엇을 바꾸고 싶은가 | 핵심 소스 | 관련 테스트 | SPEC |
|----------------------|-----------|-------------|------|
| 배합 폼·필드·추천 메인 | `views/formula.js`, `formula-fields.js`, `formula-recommend.js` | `tests/dom/exams/cosmetic/formula*.dom.test.js` | FO-01~* |
| 처방 규칙·적합성 검사 | `formula-rules.js`, `formula-check.js`, `formula-stability.js` | `tests/unit/exams/cosmetic/formula-*.test.js` | FO-* |
| 고객 관리·상담 이력 | `views/formula-customer.js` + `customer-store.js` | `formula-customer.dom.test.js` | FO-* |
| 기성품 DB·전성분 비교·OCR | `views/formula-products.js` + `product-store.js` + `product-vision.js` | `formula-products.dom.test.js` | FO-* |
| 원료 장부·LOT·기한 | `views/formula-material.js` + `material-ledger.js` | `formula-material.dom.test.js` | FO-* |
| 법규 준수 체크리스트 | `views/formula-compliance.js` | `formula-compliance.dom.test.js` | FO-* |
| 표시사항·광고 문구 점검 | `views/formula-sales.js` + `ad-lint.js` | `formula-sales.dom.test.js` | FO-* |
| 종합 규정 점검 보고서 | `views/formula-audit.js` | `formula-audit.test.js`, `formula-audit.dom.test.js` | FO-56 |
| 인쇄 빌더 (조제 기록지·라벨) | `views/formula-print.js` | `formula-print.dom.test.js` | FO-* |
| 소비자 이상사례 기록 | `views/formula-adverse.js` + `adverse-store.js` | `formula-adverse.dom.test.js` | FO-59 |
| 배치·사업자 프로필 저장소 | `batch-store.js`, `biz-profile.js`, `*-store.js` | — | FO-* |
| 원료 배합 챌린지 | `views/trainer-ingredients.js` | `tests/dom/study-trainer.dom.test.js` | FO-*(ingredients 플래그) |
| 스토어 공통 기반 (가져오기/보내기·백업) | `store-utils.js` | `tests/unit/exams/cosmetic/formula-store.test.js` | FO-* |

> 도메인 모듈은 `practice-registry.js`가 활성 시험 + features 플래그 확인 후 지연 import — **플랫폼 공통 코드에서 직접 import하지 않습니다**.

## 4. 플랫폼 셸·인프라

| 무엇을 바꾸고 싶은가 | 핵심 소스 | 관련 테스트 | SPEC |
|----------------------|-----------|-------------|------|
| 부팅·핸들러 등록·라우팅 진입 | `src/app.js` (맨 아래 `startAppInit`) | `app-shell.dom.test.js` | DA-* |
| 시험 컨텍스트·브랜딩·기능 플래그 | `src/exam-context.js` + `src/exam-data-boot.js` | `exam-switching.dom.test.js` | DA-* |
| 시험 선택/전환 화면 | `src/views/exam-select.js` | `study-examselect.dom.test.js` | DA-*/CS-* |
| data-click 위임 규칙 | `src/views/listeners-delegation.js` | `common-eventlisteners.dom.test.js` | UX-* |
| 뷰 전환·사이드바 | `src/views/navigation.js` | `common-navigation.dom.test.js` | UX-NAV-* |
| 계정 로그인·프로필 | `src/auth-view.js` + `src/supabase-*.js` | `common-auth.dom.test.js` | AU-* |
| 클라우드 동기화·충돌 해결 | `src/sync.js` | `common-sync.dom.test.js` | AU-*/SY-* |
| 백업/복원 (보내기·가져오기) | `src/views/backup.js` | `backup.dom.test.js` | BK-* |
| 상태 객체·진도 저장 | `src/state.js` + `src/storage.js` + `src/storage-keys.js` | `tests/unit/state.test.js`, `storage.test.js`, `storage-key-sync.test.js` | DA-*/ID-* |
| 오프라인 감지 배너 | `src/views/offline-detection.js` | `common-offline.dom.test.js` | PF-*/P-* |
| Service Worker·캐시 정책·프리캐시 | `sw.js` | `tests/e2e/sw-*.spec.js`, `verify:assets` | P-* |
| PWA 설치·매니페스트 | `src/pwa-install.js`, `pwa-manifest.js` | E2E 전용 | P-* |
| 테마·UI 모드 | `src/theme-toggle.js`, `src/ui-mode.js`, `src/theme-init.js` | `common-theme.dom.test.js`, `common-uimode.dom.test.js` | TH-*/UM-* |
| 토스트·모달·로딩 유틸 | `src/ui-utils.js` + `src/modal-back.js` | `common-a11y.dom.test.js` | UX-* |
| XSS 이스케이프·`html`` ` 템플릿 | `src/sanitize.js` | `tests/unit/sanitize.test.js` | SEC-* |
| 명령 팔레트 (Ctrl+K) | `src/command-palette.js` | `study-commandpalette.dom.test.js` | UX-*/CQ-* |
| 차트 렌더링 | `src/charts.js` | `charts.dom.test.js` | D-*/AN-* |
| 온보딩·신기능 안내·피드백 | `src/onboarding.js`, `whats-new.js`, `feedback.js` | `onboarding-zoom.dom.test.js`, `feedback.dom.test.js` | ON-*/WN-*/FB-* |
| Pro 배지·플랜 비교 | `src/pro-upgrade.js` + `feature-plan.json` | `pro-plan.dom.test.js` | PL-* |
| 오류 텔레메트리·폴백 부팅 | `src/error-telemetry.js` + `app-fallback.js` | `tests/unit/error-telemetry.test.js` | — |
| 사용 통계·웹바이탈 | `src/usage-stats.js`, `src/web-vitals.js` | — | PF-* |

## 5. 콘텐츠·빌드 파이프라인

| 무엇을 바꾸고 싶은가 | 핵심 위치 | 검증 | SPEC |
|----------------------|-----------|------|------|
| 시험 팩 등록·기능 플래그·브랜딩 | `content/exams.json` | `check:featflags`, `check:manifest` | DA-* |
| 교재 원고 | `content/exams/<id>/교재/` | `build:data` → `check:content` | BP-* |
| 문제은행 원고 | `content/exams/<id>/문제은행/` | `build:data` → `check:content` | BP-* |
| 참조자료 PDF·ref_md·레지스트리 | `content/exams/<id>/참조자료/` + `references.json` | `check:reflayout`·`check:reffresh` | RR-* |
| 앱 내 매뉴얼·학습안내서 원고 | `content/exams/<id>/docs/` | `build_doc_bundles` → `check:docbundles` | MV-* |
| 번들 빌드 로직 | `tools/build/build_all_data.js`, `build_story_textbooks.js` | `check:parser`, `check:datafresh` | BP-* |
| 인용 라인 동기화·교정 | `tools/sync/sync_citation_lines.js`, `fix_citation_targets.js` | `check:reflines` | RR-* |
| PDF → ref_md 변환·법령 감지 | `ref-pipeline/` (Python) | `convert:refs` → `verify:refs` | RR-*/CE-* |

## 6. 품질 게이트 자체를 바꿀 때

| 게이트 | 구현 파일 |
|--------|-----------|
| 이스케이프 싱크 | `tools/check/check_html_escape.js` |
| SPEC 추적 | `tools/check/check_spec_refs.js` + `tools/lib/trace_scan.js` |
| 문서 정합 (경로·ID·명령·CI 패리티) | `tools/check/check_docs_*.js`, `check_inventory.js` |
| 파일 계층 분류 | `tools/check/domain-map.json` + `check_domain_map.js` |
| 성능 예산 | `tools/check/check_perf_budget.js` |
| 콘텐츠 통합 게이트 | `tools/check/check_content.js` (23단계 오케스트레이터) |
| 생성물 신선도 | `tools/check/check_data_freshness.js` |

## 7. 이 표에 없는 것을 찾을 때

1. **뷰인지 확인** — 화면 요소면 `html/views/<파셜>` → 대응 `src/views/<컨트롤러>` 순으로 찾습니다.
2. **텍스트 검색** — 화면에 보이는 문구를 그대로 ripgrep: `rg "문구" html/ src/` 가 가장 빠릅니다.
3. **SPEC에서 역추적** — 기능 이름을 `SPEC.md` 목차에서 찾아 ID를 얻고, `rg "@spec XX-" src/`로 구현 위치를 역추적합니다 (`TRACE_MATRIX.md`가 같은 매핑을 미리 만들어 둡니다).
4. **테스트에서 역추적** — `tests/`의 파일명은 대상 모듈명과 대응합니다 (`study-dashboard.dom.test.js` → `dashboard.js`).
