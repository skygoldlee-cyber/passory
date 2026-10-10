# 📂 cosmetic 시험 문서 인덱스

> **문서 ID**: DOC-IDX-02
> **범위**: exam:cosmetic · 판본: none
> **관련 SPEC ID**: 해당 없음 (시험별 문서 인덱스)
> 상위 인덱스: [`docs/README.md`](../../README.md) · 시험 콘텐츠 팩: `content/exams/cosmetic/`

`docs/exams/cosmetic/` 아래 문서는 **맞춤형화장품 조제관리사 시험에 종속**된 문서다. 플랫폼 공통 문서(아키텍처·명세·런북·공용 설계·참조)는 `docs/dev/`를 본다. 각 문서 헤더의 `> **범위**: … · 판본: …`가 종속성을 선언한다 — `판본: textbook`은 교재 교체 시, `판본: refmat`은 법령·고시 등 참조자료 판본 변경 시 갱신 대상이다.

## 디렉토리

| 디렉터리 | 내용 | 판본 의존 |
|------|------|------|
| `user/` | 학습자 문서 — `exam_strategy.md`(시험 공략), `subject1~4_numbers.md`(과목별 숫자 암기) | numbers 시리즈: textbook |
| `business/` | 사업 기획·시장 조사·마케팅 — 사업기획서 v3.5(현행 기준서)·경쟁전략·판매업소 조사·홍보 의뢰 | none |
| `design/` | 시험 종속 설계 — FORMULA_OS_WORKFLOW·PRODUCT_DB·PRODUCT_VISION·AUDIT_REPORT·PRACTICAL_TOOLS | none |
| `reference/` | 교재 종속 참조 — `NUMBERING_SYSTEM.md`·`TEXTBOOK_REFERENCE_MAPPING.md` | textbook |
| `report_archive/` | 시점 스냅샷 보고서 + 대체된 전략·설계 원전 (앱 미참조) | `법령최신확인결과.md`만 refmat |
| `ingredients_audit_제2026-19호.md` | 원료 DB ↔ 고시 전수 대조 리포트 (고시 판본 스냅샷) | refmat |

## 앱 내 문서 (시험 콘텐츠 팩 소속)

앱 `manual-viewer`가 런타임 fetch하는 문서는 이 저장소의 `docs/`가 아니라 콘텐츠 팩에 둔다 — 갱신 후 `node tools/build/build_doc_bundles.js`로 번들 재생성 필수.

| 문서 | 판본 |
|------|------|
| `content/exams/cosmetic/docs/user_manual.md` | none |
| `content/exams/cosmetic/docs/formula_manual.md` | none |
| `content/exams/cosmetic/docs/학습안내서.md` | textbook |
| `content/exams/cosmetic/docs/두음법_암기_총정리.md` | textbook |

## 신규 문서 추가 규칙

- 시험 종속 문서는 이 디렉터리 아래에 둔다 (종류별 하위 디렉터리 유지 — 없으면 루트).
- 헤더에 `> **범위**: exam:cosmetic · 판본: <none|textbook|refmat>` 표기 — `check:docs`가 위치↔선언 일치를 검증한다.
- 문서 ID는 종류별 접두사로 채번하고 `docs/README.md` 레지스트리에 등록한다 (이 파일의 인덱스 성격 문서는 `DOC-IDX`).
