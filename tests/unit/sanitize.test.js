// @spec S-05
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHTML, safeTextWithBreaks, esc, html, raw } from '../../src/sanitize.js';

test('escapeHTML: 특수문자 이스케이프', () => {
    assert.equal(escapeHTML('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.equal(escapeHTML('"hello"'), '&quot;hello&quot;');
    assert.equal(escapeHTML("it's"), 'it&#39;s');
    assert.equal(escapeHTML('a & b'), 'a &amp; b');
});

test('escapeHTML: 일반 문자열은 그대로 반환', () => {
    assert.equal(escapeHTML('Hello World'), 'Hello World');
    assert.equal(escapeHTML('한글 텍스트'), '한글 텍스트');
});

test('escapeHTML: null/undefined는 빈 문자열 반환', () => {
    assert.equal(escapeHTML(null), '');
    assert.equal(escapeHTML(undefined), '');
});

test('escapeHTML: 비문자열은 문자열로 변환 후 이스케이프', () => {
    assert.equal(escapeHTML(123), '123');
    assert.equal(escapeHTML(true), 'true');
});

test('escapeHTML: 모든 특수문자가 혼재된 경우', () => {
    const input = '<div class="x" data-y=\'z\'>&</div>';
    const expected = '&lt;div class=&quot;x&quot; data-y=&#39;z&#39;&gt;&amp;&lt;/div&gt;';
    assert.equal(escapeHTML(input), expected);
});

test('safeTextWithBreaks: 개행을 <br>로 변환', () => {
    assert.equal(safeTextWithBreaks('line1\nline2'), 'line1<br>line2');
    assert.equal(safeTextWithBreaks('a\r\nb'), 'a<br>b');
    assert.equal(safeTextWithBreaks('a\rb'), 'a<br>b');
});

test('safeTextWithBreaks: 특수문자 이스케이프 후 개행 변환', () => {
    assert.equal(safeTextWithBreaks('<b>\n</b>'), '&lt;b&gt;<br>&lt;/b&gt;');
});

test('safeTextWithBreaks: 개행이 없으면 escapeHTML과 동일', () => {
    assert.equal(safeTextWithBreaks('hello & world'), 'hello &amp; world');
});

test('esc: escapeHTML의 별칭으로 동일 동작', () => {
    assert.equal(esc('<x>'), escapeHTML('<x>'));
    assert.equal(esc(null), '');
    assert.equal(esc('normal'), 'normal');
});

// ROAD-Q5 — html`` 태그드 템플릿: 보간값 자동 이스케이프
test('html: 보간값을 자동 이스케이프한다', () => {
    assert.equal(
        String(html`<li>${'<script>alert(1)</script>'}</li>`),
        '<li>&lt;script&gt;alert(1)&lt;/script&gt;</li>'
    );
    assert.equal(String(html`<a href="${'a?x=1&y=2'}">${"it's"}</a>`),
        '<a href="a?x=1&amp;y=2">it&#39;s</a>');
});

test('html: null/undefined 보간은 빈 문자열', () => {
    assert.equal(String(html`<p>${null}${undefined}x</p>`), '<p>x</p>');
});

test('html: 숫자·불리언 보간은 문자열 변환', () => {
    assert.equal(String(html`<b>${42}${true}</b>`), '<b>42true</b>');
});

test('html: 배열 보간은 각 요소를 이스케이프 후 join', () => {
    const items = ['<b>a</b>', 'c'];
    assert.equal(String(html`<ul>${items.map(i => html`<li>${i}</li>`)}</ul>`),
        '<ul><li>&lt;b&gt;a&lt;/b&gt;</li><li>c</li></ul>');
});

test('html: 중첩 html 결과는 이중 이스케이프 없이 통과', () => {
    const inner = html`<b>${'<i>'}</b>`;
    assert.equal(String(html`<div>${inner}</div>`), '<div><b>&lt;i&gt;</b></div>');
});

test('html: raw() 래핑값은 마크업 그대로 통과', () => {
    assert.equal(String(html`<div>${raw('<em>ok</em>')}</div>`), '<div><em>ok</em></div>');
});

test('html: raw() null은 빈 문자열', () => {
    assert.equal(String(html`<p>${raw(null)}</p>`), '<p></p>');
});

test('html: innerHTML 대입 시 toString으로 평탄화된다', () => {
    const out = html`<x>${'<y>'}</x>`;
    assert.equal(`${out}`, '<x>&lt;y&gt;</x>');
    assert.equal(out + '!', '<x>&lt;y&gt;</x>!');
});
