# -*- coding: utf-8 -*-
# @spec FO-24
"""개정 고시·법령 원문 자동 확보기.

check_mfds_notice.py가 '신규 고시 발견'까지만 감지한다면, 이 스크립트는
그 다음 단계 — 공식 원문 파일을 법령고시/에 내려받는 일 — 을 자동화한다.

- 행정규칙(고시, target=admrul): lawService.do 상세의 첨부파일 중
  '전문' PDF를 자동 다운로드 → 참조자료/법령고시/에 규약 파일명으로 배치.
  --apply 시 구 PDF를 _archive/로 이동하고 references.json의 파일명 참조를 일괄 치환.
- 법령(법률·령·규칙, target=law): DRF가 문서 파일을 제공하지 않아
  (type=PDF/HWP/DOC 모두 HTML 오류 페이지 반환) 수동 다운로드가 필요하다.
  대신 다운로드 페이지 URL·저장할 파일명·개정문 요지를 출력해 절차를 안내한다.

출력 파일명 규약은 parse_ref_filename()과 동일:
    {문서명}({발령기관})({제N호})({시행일 YYYYMMDD}).pdf

사용:
    LAW_OC_KEY=<키> python ref-pipeline/fetch_revision.py [--exam <id>]
        [--doc <문서명 부분일치>] [--apply]

- 기본: 신규본이 감지된 고시의 전문 PDF를 다운로드 + 후속 절차 안내
- --doc: 특정 문서만 처리
- --apply: 고시에 한해 구본 _archive 이동 + references.json 파일명 치환까지 수행
"""
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _exam_root import exam_root, fmt_date, utf8_stdio  # noqa: E402

utf8_stdio()
ROOT = Path(__file__).resolve().parent.parent


def _arg(flag):
    for i, a in enumerate(sys.argv):
        if a == flag and i + 1 < len(sys.argv):
            return sys.argv[i + 1]
        if a.startswith(flag + '='):
            return a.split('=', 1)[1]
    return None


EXAM_DIR = exam_root(_arg('--exam'))
REFS_FILE = EXAM_DIR / 'references.json'
REF_BASE = EXAM_DIR / '참조자료'


# ---------------------------------------------------------------------------
# API 접근 — check_mfds_notice.py의 검증된 함수를 재사용한다.
# (지연 import: --doc/--exam 인자가 argv에 있어야 EXAM_DIR 해석이 일치)
# ---------------------------------------------------------------------------
def _notice_api():
    import check_mfds_notice as n
    return n


# ---------------------------------------------------------------------------
# 순수 함수 — pytest 대상
# ---------------------------------------------------------------------------
def pick_pdf_attachment(attachment_names):
    """첨부파일명 목록에서 고시 전문 PDF의 인덱스를 고른다.

    우선순위: ① '전문'을 포함한 .pdf ② 아무 .pdf ③ 없으면 None.
    .hwpx 등 비PDF는 반환하지 않는다 (PDF 파이프라인이 기존 변환기 재사용).
    """
    names = list(attachment_names or [])
    pdfs = [i for i, n in enumerate(names) if str(n).lower().endswith('.pdf')]
    for i in pdfs:
        if '전문' in str(names[i]):
            return i
    return pdfs[0] if pdfs else None


def filename_agency(old_file):
    """'{문서}({기관})({제N호})({날짜}).pdf'에서 발령기관 문자열을 추출한다."""
    m = re.findall(r'\(([^()]*)\)', old_file or '')
    return m[0] if len(m) >= 1 and m[0] else None


def new_filename(doc_name, agency, notice, yyyymmdd):
    """파일명 규약 조립. notice는 '제2026-19호' 형식."""
    d = re.sub(r'\D', '', yyyymmdd or '')
    if len(d) != 8 or not notice:
        return None
    return f'{doc_name}({agency})({notice})({d}).pdf'


def notice_to_filename_token(notice):
    """'제2026-19호' → '제2026-19호' (그대로), None/빈값 → None."""
    s = str(notice or '').strip()
    return s if re.fullmatch(r'제\d+(?:-\d+)?호', s) else None


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def replace_basename_in_refs(refs_text, old_base, new_base):
    """references.json 원문에서 구 파일명 스템 → 신 스템 일괄 치환.

    서식 보존을 위해 파싱 대신 문자열 치환을 쓴다 — 스템은 규약상
    (기관)(제N호)(날짜)가 포함돼 충돌 위험이 없다.
    반환: (새 텍스트, 치환 횟수)
    """
    return refs_text.replace(old_base, new_base), refs_text.count(old_base)


# ---------------------------------------------------------------------------
# 네트워크·파일 단계
# ---------------------------------------------------------------------------
def download(url, timeout=60):
    """flDownload.do 등에서 바이너리를 받는다. http/https 모두 지원."""
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def admrul_detail(serial):
    """행정규칙 상세 — AdmRulService 루트 반환 (별표/첨부파일/제개정이유 포함)."""
    n = _notice_api()
    d = n.api_get('lawService.do', {'ID': serial})
    return d.get('AdmRulService', d)


def law_detail(serial):
    n = _notice_api()
    d = n.api_get('lawService.do', {'MST': serial}, target='law')
    return d.get('법령', d)


def reason_text(detail):
    """제개정이유 내용을 평문으로 펼친다 (리뷰용, 없으면 '')."""
    node = (detail or {}).get('제개정이유') or {}
    rows = node.get('제개정이유내용') or []
    out = []
    for group in rows:
        if isinstance(group, list):
            out.extend(str(x) for x in group)
        else:
            out.append(str(group))
    return '\n'.join(out).strip()


def fetch_admrul(doc, latest, apply=False, out_dir=None):
    """고시 1종: 전문 PDF 다운로드 → 법령고시/ 배치 (+--apply면 아카이브·치환).

    반환 dict: {ok, file, reason} — ok=False면 reason에 사유.
    """
    serial = latest.get('serial')
    if not serial:
        return {'ok': False, 'reason': 'serial 없음'}
    detail = admrul_detail(serial)
    att = detail.get('첨부파일') or {}
    names = att.get('첨부파일명') or []
    links = att.get('첨부파일링크') or []
    if isinstance(names, str):
        names = [names]
    if isinstance(links, str):
        links = [links]
    idx = pick_pdf_attachment(names)
    if idx is None or idx >= len(links):
        return {'ok': False, 'reason': f'첨부 PDF 없음 (첨부: {names})'}

    notice = notice_to_filename_token(latest.get('notice'))
    date8 = re.sub(r'\D', '', latest.get('effectiveDate') or '')
    agency = filename_agency(doc['file'])
    fname = new_filename(doc['name'], agency, notice, date8)
    if not fname:
        return {'ok': False, 'reason': f'파일명 조립 실패 (notice={latest.get("notice")}, '
                                      f'date={latest.get("effectiveDate")})'}

    link = links[idx]
    url = link if link.startswith('http') else 'https://www.law.go.kr' + link
    data = download(url)
    if not data.startswith(b'%PDF'):
        return {'ok': False, 'reason': f'PDF가 아닌 응답 ({len(data)}B, head={data[:16]!r})'}

    dest_dir = Path(out_dir) if out_dir else REF_BASE / doc.get('dir', '법령고시')
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / fname
    if dest.exists():
        return {'ok': False, 'reason': f'이미 존재: {dest.name}'}
    dest.write_bytes(data)

    src = {
        'source': 'law.go.kr DRF lawService.do?target=admrul',
        'serial': serial,
        'attachment': names[idx],
        'url': url,
        'sha256': sha256_bytes(data),
        'fetchedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    }
    (dest_dir / (dest.stem + '.src.json')).write_text(
        json.dumps(src, ensure_ascii=False, indent=2), encoding='utf-8')

    result = {'ok': True, 'file': fname, 'dir': dest_dir.name,
              'bytes': len(data), 'sha256': src['sha256'],
              'reason_text': reason_text(detail)}

    if apply:
        old_base = Path(doc['file']).stem
        new_base = dest.stem
        arch = REF_BASE / '_archive'
        arch.mkdir(exist_ok=True)
        for stem in (old_base + '.pdf', old_base + '.src.json'):
            p = REF_BASE / doc.get('dir', '법령고시') / stem
            if p.exists():
                p.rename(arch / p.name)
        text = REFS_FILE.read_text(encoding='utf-8')
        new_text, count = replace_basename_in_refs(text, old_base, new_base)
        if count:
            REFS_FILE.write_text(new_text, encoding='utf-8')
        result['refsUpdated'] = count
        result['archived'] = doc['file']
    return result


def law_guidance(doc, latest):
    """법률류: DRF는 문서 파일 미제공 — 수동 다운로드 안내 + 개정문 요지."""
    detail = law_detail(latest.get('serial')) if latest.get('serial') else {}
    url = ('https://www.law.go.kr/lsInfoP.do?lsiSeq=' + str(latest.get('serial'))
           if latest.get('serial') else doc.get('url', ''))
    agency = filename_agency(doc['file'])
    date8 = re.sub(r'\D', '', latest.get('effectiveDate') or '')
    fname = new_filename(doc['name'], agency, latest.get('notice'), date8)
    return {'ok': False, 'manual': True, 'url': url, 'file': fname,
            'reason_text': reason_text(detail)}


def find_updates(doc):
    """문서 1종의 신규본 감지 → (latest dict | None)."""
    n = _notice_api()
    res = n.search_law(doc['name']) if doc['target'] == 'law' else n.search_admrul(doc['name'])
    if res is None:
        return None
    latest = res['latest']
    base = doc.get('baselineDate') or ''
    if latest.get('effectiveDate') and latest['effectiveDate'] > base:
        return latest
    return None


def main():
    doc_filter = _arg('--doc')
    do_apply = '--apply' in sys.argv

    if not REFS_FILE.exists():
        print(f'!! references.json 없음: {REFS_FILE}')
        sys.exit(1)
    refs = json.loads(REFS_FILE.read_text(encoding='utf-8'))
    docs = []
    for e in refs.get('referenceLaw', []):
        if not e.get('file'):
            continue
        from _exam_root import parse_ref_filename
        meta = parse_ref_filename(e['file'])
        meta['dir'] = e.get('dir', '법령고시')
        docs.append(meta)
    if doc_filter:
        docs = [d for d in docs if doc_filter in d['name']]
        if not docs:
            print(f'!! --doc "{doc_filter}" 일치 문서 없음')
            sys.exit(1)

    print(f'감시 문서 {len(docs)}종 — law.go.kr 조회 중…')
    fetched, manual, skipped = [], [], []
    for d in docs:
        try:
            latest = find_updates(d)
        except SystemExit:
            raise
        except Exception as e:  # noqa: BLE001 — 문서별 실패가 전체를 중단시키지 않음
            print(f'  ✗ {d["name"]}: 조회 실패 — {e}')
            skipped.append(d['name'])
            continue
        if latest is None:
            skipped.append(d['name'])
            continue
        print(f'  ⚠ {d["name"]}: {d.get("baselineNotice")}({d.get("baselineDate")}) '
              f'→ {latest.get("notice")}({latest.get("effectiveDate")})')
        if d['target'] == 'admrul':
            r = fetch_admrul(d, latest, apply=do_apply)
            if r['ok']:
                fetched.append((d, r))
                print(f'    ✓ 다운로드: {r["dir"]}/{r["file"]} ({r["bytes"]:,}B)')
                if do_apply:
                    print(f'    ✓ references.json {r.get("refsUpdated", 0)}곳 치환, '
                          f'구본 _archive 이동')
            else:
                manual.append((d, r))
                print(f'    ✗ 자동 다운로드 불가 — {r["reason"]}')
        else:
            r = law_guidance(d, latest)
            manual.append((d, r))
            print(f'    → 법률류는 수동 다운로드: {r["url"]}')
            print(f'      저장 파일명: {r["file"] or "(파일명 조립 실패)"}')

    print('\n' + '=' * 60)
    print(f'자동 확보 {len(fetched)}건 / 수동 필요 {len(manual)}건 / 최신 또는 실패 {len(skipped)}건')
    if fetched:
        print('\n[후속 절차 — 자동 확보분]')
        for _, r in fetched:
            print(f'  · {r["file"]}')
        print('  1. npm.cmd run convert:refs           # ref_md_v2 스테이징')
        print('  2. npm.cmd run verify:refs            # 골든 비교')
        print('  3. ref_md_v2 → ref_md/과목N/ 승격 + 구 ref_md _archive')
        print('  4. npm.cmd run check:reflines && npm.cmd run fix:citations')
        print('  5. check_mfds_notice.py --update && npm.cmd run check:reffresh -- --update')
        print('  6. npm.cmd run build:data && npm.cmd run check:content -- --build')
        for d, r in fetched:
            if r.get('reason_text'):
                print(f'\n[제개정이유 — {d["name"]}]\n{r["reason_text"][:600]}')
    if manual:
        print('\n[수동 필요]')
        for d, r in manual:
            print(f'  · {d["name"]}: {r.get("reason") or r.get("url", "")}')
            if r.get('reason_text'):
                print(f'    개정요지: {r["reason_text"][:200]}')
    if not fetched and not manual:
        print('모든 문서가 최신입니다.')


if __name__ == '__main__':
    main()
