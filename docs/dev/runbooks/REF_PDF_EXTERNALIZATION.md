# 📦 참조자료 PDF 외부 호스팅 이전 계획

> **최종 업데이트**: 2026-10-15
> **목적**: `content/exams/cosmetic/참조자료/`의 원본 PDF(73MB, 41개)를 git 저장소에서 분리해 클론 비용을 줄이는 절차
> **관련 SPEC ID**: `RR-13` (참조자료 레지스트리)
> **문서 ID**: DOC-RBK-12
> **범위**: platform · 판본: none

---

## 1. 현황 — 왜 분리해도 안전한가

| 사실 | 근거 |
|------|------|
| 런타임은 PDF를 서빙하지 않는다 | `.pdf` 링크는 `src/reader-format.js`·`src/exam-viewer.js`가 `ref_md/` MD 경로로 변환. `type:'pdf'`는 "원본이 PDF"라는 표식일 뿐 |
| 배포에도 포함되지 않는다 | `.vercelignore` — `content/exams/*/참조자료/**/*.pdf` 배포 제외 |
| 소비자는 개발 파이프라인뿐 | `convert:refs`(pdfplumber 변환), `check:reffresh`(해시 신선도), `check:reflayout`(4계층 정합) |
| 무결성 매니페스트가 이미 있다 | `content/exams/cosmetic/참조자료/pdf_hashes.json`에 41개 SHA-256이 스탬프됨 — 다운로드 검증 키로 그대로 재사용 가능 |

즉 PDF는 **배포·런타임 모두 무관한 순수 변환 입력물**이다. 저장소에서 빼도 앱에는 영향이 없고, 파이프라인만 복원 절차가 필요하다.

## 2. 권장 방식 — GitHub Releases + 해시 검증 다운로더

오디오북(`AUDIO_BASE_URL` 외부 URL 패턴, `AUDIO_HOSTING_GUIDE.md`)과 동일한 구조.

### 단계

1. **릴리스 생성** — GitHub Releases에 태그 `ref-pdf-cosmetic` 생성, 41개 PDF를 에셋으로 업로드
   (에셋 1개 2GB 제한 — 최대 파일 수 MB 수준으로 여유. `gh` CLI 미설치 시 웹 UI 사용)
2. **다운로더 작성** — `tools/sync/fetch_ref_pdfs.js` (신규, ~80줄)
   - `content/exams/cosmetic/참조자료/pdf_hashes.json`을 읽어 로컬에 없는 PDF만 `releases/download/ref-pdf-cosmetic/<파일명>`에서 fetch
   - 수신 후 SHA-256 대조 — 불일치 시 오류로 중단 (내용 변조·파일명 드리프트 방지)
   - `fetch:refpdfs` npm 스크립트로 등록
3. **gitignore + 추적 해제**
   ```
   content/**/참조자료/**/*.pdf
   !content/**/참조자료/ref_md/**     # MD 변환본은 계속 추적 (런타임 서빙)
   ```
   `git rm --cached "content/exams/cosmetic/참조자료/**/*.pdf"` 후 커밋.
   ⚠️ 해시 매니페스트(pdf_hashes.json)는 추적 유지 (`git rm --cached` 범위가 `*.pdf`만 잡도록 주의).
4. **파이프라인 게이트 보강** — PDF 부재 시 동작 명시:
   - `convert:refs`, `check:reffresh`, `check:reflayout` 시작 시 PDF 존재 확인 → 없으면
     `node tools/sync/fetch_ref_pdfs.js 먼저 실행` 안내 메시지로 종료 (빌드 오류 오인 방지)
   - `check:content`(CI 포함)는 ref_md만 검사하므로 PDF 부재 환경에서도 통과해야 함 — 사전 검증
5. **문서 갱신** — AGENTS.md의 ref-pipeline 절차에 "PDF 부재 시 fetch_ref_pdfs 실행" 선행 조건 추가,
   `MULTI_MACHINE_SETUP.md`에 신규 머신 복원 절차 기록.

## 3. 주의 사항

- **git 히스토리는 그대로 남는다** — working tree에서 빼도 과거 커밋의 blob이 pack에 남아
  full clone 크기는 즉시 줄지 않는다. 효과: 새 작업자의 `--depth 1` 클론· sparse-checkout·CI 체크아웃.
  히스토리까지 줄이려면 BFG/`git filter-repo` 재작성이 필요하며 **강제 푸시·전 클론 재생성이 동반되는 파괴 작업** — 별도 합의 없이 진행 금지.
- **신규 시험 팩** — `content/exams/<id>/참조자료/`를 같은 규칙으로 처리할 수 있도록 glob 패턴(`content/**/`)으로 작성.
- **PDF 교체 워크플로** — 이전 후에도 "PDF 교체 → convert:refs → verify:refs → 승격 → check:reffresh --update"는 동일.
  단, 교체된 PDF는 릴리스 에셋도 함께 갱신해야 다른 머신이 같은 원본을 받는다 (해시 불일치가 이를 감지).

## 4. 대안 비교

| 방식 | 장점 | 단점 |
|------|------|------|
| GitHub Releases (권장) | 오디오북 선례와 동일, sha256 매니페스트 재사용, 무료 | 릴리스 에셋 관리가 수동 |
| Git LFS | 파일 지시어로 버전 추적 유지 | LFS 쿼터(무료 1GB), 클론마다 lfs pull 필요, 미설치 환경 오류 |
| 유지 (아무것도 안 함) | 파이프라인 변경 0 | 클론 비대 지속, GitHub 100MB/파일 한계 접근 시 강제 대응 |

## 5. 실행 전 체크리스트

- [ ] 릴리스 에셋 41개 업로드 완료 + 수량 대조
- [ ] `fetch_ref_pdfs.js`로 클린 디렉터리에서 복원 → sha256 전수 일치 확인
- [ ] PDF 제거 후 `npm run check:content -- --quick` 통과 (ref_md만 검사됨)
- [ ] `npm run verify:assets`·`check:reflayout` 통과 (PDF 부재 시 명확한 안내 메시지)
- [ ] AGENTS.md·MULTI_MACHINE_SETUP.md 갱신
