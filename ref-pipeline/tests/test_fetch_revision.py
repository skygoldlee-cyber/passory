"""fetch_revision.py 순수 함수 + 다운로드 흐름 단위 테스트.

네트워크·저장소 경로는 모킹한다 — api_get/urlopen은 호출되지 않아야 함
(fetch_admrul의 download만 모킹). 실행: python -m pytest ref-pipeline/tests/ -v
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import fetch_revision as fr  # noqa: E402


# ---------------------------------------------------------------------------
# pick_pdf_attachment
# ---------------------------------------------------------------------------
class TestPickPdfAttachment:
    def test_prefers_jeolmun_pdf(self):
        names = ['고시(전문).hwpx', '고시(전문).pdf', '별표.pdf']
        assert fr.pick_pdf_attachment(names) == 1

    def test_falls_back_to_any_pdf(self):
        names = ['별첨.hwpx', '개정문.pdf']
        assert fr.pick_pdf_attachment(names) == 1

    def test_no_pdf_returns_none(self):
        assert fr.pick_pdf_attachment(['a.hwpx', 'b.hwp']) is None

    def test_empty_or_none(self):
        assert fr.pick_pdf_attachment([]) is None
        assert fr.pick_pdf_attachment(None) is None


# ---------------------------------------------------------------------------
# filename_agency / new_filename / notice_to_filename_token
# ---------------------------------------------------------------------------
class TestFilename:
    OLD = '화장품 안전기준 등에 관한 규정(식품의약품안전처고시)(제2026-19호)(20260318).pdf'

    def test_agency_extract(self):
        assert fr.filename_agency(self.OLD) == '식품의약품안전처고시'

    def test_new_filename(self):
        f = fr.new_filename('화장품 안전기준 등에 관한 규정', '식품의약품안전처고시',
                            '제2026-45호', '2026-09-01')
        assert f == '화장품 안전기준 등에 관한 규정(식품의약품안전처고시)(제2026-45호)(20260901).pdf'

    def test_bad_date_or_notice_returns_none(self):
        assert fr.new_filename('x', 'y', '제2026-1호', '2026') is None
        assert fr.new_filename('x', 'y', None, '20260901') is None

    def test_notice_token_validation(self):
        assert fr.notice_to_filename_token('제2026-19호') == '제2026-19호'
        assert fr.notice_to_filename_token('제21525호') == '제21525호'
        assert fr.notice_to_filename_token('2026-19') is None
        assert fr.notice_to_filename_token(None) is None


# ---------------------------------------------------------------------------
# replace_basename_in_refs
# ---------------------------------------------------------------------------
class TestReplaceBasename:
    def test_counts_and_replaces(self):
        text = json.dumps({'a': '화장품법(법률)(제1호)(20260101).pdf',
                           'b': '화장품법(법률)(제1호)(20260101)'}, ensure_ascii=False)
        new, n = fr.replace_basename_in_refs(
            text, '화장품법(법률)(제1호)(20260101)', '화장품법(법률)(제2호)(20260202)')
        assert n == 2
        assert '제2호' in new and '제1호' not in new

    def test_no_match(self):
        new, n = fr.replace_basename_in_refs('{}', 'x', 'y')
        assert n == 0 and new == '{}'


# ---------------------------------------------------------------------------
# reason_text
# ---------------------------------------------------------------------------
class TestReasonText:
    def test_flattens_groups(self):
        d = {'제개정이유': {'제개정이유내용': [['◇ 개정이유', '본문'], ['두번째']]}}
        t = fr.reason_text(d)
        assert '◇ 개정이유' in t and '두번째' in t

    def test_missing_returns_empty(self):
        assert fr.reason_text({}) == ''
        assert fr.reason_text(None) == ''


# ---------------------------------------------------------------------------
# fetch_admrul — 네트워크·파일시스템 모킹
# ---------------------------------------------------------------------------
def _doc():
    return {'name': '화장품 안전기준 등에 관한 규정', 'target': 'admrul',
            'file': '화장품 안전기준 등에 관한 규정(식품의약품안전처고시)(제2026-19호)(20260318).pdf',
            'dir': '법령고시', 'baselineNotice': '제2026-19호', 'baselineDate': '2026-03-18'}


def _latest():
    return {'notice': '제2026-45호', 'effectiveDate': '2026-09-01', 'serial': '999'}


def _detail(names=None, links=None):
    return {'첨부파일': {'첨부파일명': names or ['고시(전문).hwpx', '고시(전문).pdf'],
                        '첨부파일링크': links or ['http://x/f1', 'http://x/f2']},
            '제개정이유': {'제개정이유내용': [['이유']]}}


class TestFetchAdmrul:
    def test_happy_path(self, tmp_path, monkeypatch):
        monkeypatch.setattr(fr, 'admrul_detail', lambda s: _detail())
        monkeypatch.setattr(fr, 'download', lambda u: b'%PDF-1.7 fake')
        r = fr.fetch_admrul(_doc(), _latest(), out_dir=tmp_path)
        assert r['ok'] and r['file'].endswith('(제2026-45호)(20260901).pdf')
        pdf = tmp_path / r['file']
        assert pdf.read_bytes() == b'%PDF-1.7 fake'
        src = json.loads((tmp_path / (pdf.stem + '.src.json')).read_text(encoding='utf-8'))
        assert src['sha256'] == fr.sha256_bytes(b'%PDF-1.7 fake')
        assert src['serial'] == '999'

    def test_no_pdf_attachment(self, tmp_path, monkeypatch):
        monkeypatch.setattr(fr, 'admrul_detail',
                            lambda s: _detail(names=['a.hwpx'], links=['http://x/1']))
        r = fr.fetch_admrul(_doc(), _latest(), out_dir=tmp_path)
        assert not r['ok'] and '첨부 PDF 없음' in r['reason']

    def test_non_pdf_response_rejected(self, tmp_path, monkeypatch):
        monkeypatch.setattr(fr, 'admrul_detail', lambda s: _detail())
        monkeypatch.setattr(fr, 'download', lambda u: b'<html>err</html>')
        r = fr.fetch_admrul(_doc(), _latest(), out_dir=tmp_path)
        assert not r['ok'] and 'PDF가 아닌' in r['reason']

    def test_no_serial(self, tmp_path):
        r = fr.fetch_admrul(_doc(), {'notice': '제2026-45호', 'effectiveDate': '2026-09-01'},
                            out_dir=tmp_path)
        assert not r['ok'] and r['reason'] == 'serial 없음'

    def test_missing_serial_in_detail_error(self, tmp_path, monkeypatch):
        monkeypatch.setattr(fr, 'admrul_detail', lambda s: {})
        r = fr.fetch_admrul(_doc(), _latest(), out_dir=tmp_path)
        assert not r['ok']
