// views/textbook-search.js - 교재 검색 통합 로직 (Textbook Search Integration)
// @spec TS-01~09,PF-08,TS-10,TS-11
import { escapeHTML, esc } from '../sanitize.js';
import { parseMarkdown } from '../markdown-parser.js';
import { renderMermaidIn } from '../mermaid-render.js';
import { attachImageZoomIn } from '../image-zoom.js';
import { TIMING } from '../config/timing.js';
import { DataLoader } from '../data-loader.js';
import { hasFeature } from '../exam-context.js';
import { getRefTables } from '../pdf-registry.js';
import { PATHS } from '../paths.js';
import { escapeRegExp, debounce } from '../utils.js';
// [모바일 PWA 견고성] 레지스트리는 window 전역(가드)에서 읽는다(정적 import 하드 의존 지양).

const textbookState = {
    filter: 'all',
    searchQuery: '',
};

const _runSearch = debounce((value) => {
    textbookState.searchQuery = value;
    performTextbookSearch();
}, TIMING.SEARCH_DEBOUNCE_MS);

let _searchIndex = null;
let _searchIndexKeys = null;
let _invertedIndex = null; // 3. 역색인: 단어 → Set<entryIndex>
let _invertedIndexKeys = null;

// --- TS-10: 이야기형 서사 지연 인덱싱 ---
// 표준형만 번들되므로 서사 텍스트(비유·예시)는 별도 fetch가 필요하다.
// 첫 검색 실행 시 storyFile을 지연 로드해 '서사' 항목으로 인덱스에 병합한다.
/** @type {Array<object>|null} */
let _storyEntries = null;
/** @type {Promise<number>|null} */
let _storyIndexPromise = null;

/** 이야기형 MD에서 story:start/end 블록을 {title, text} 목록으로 추출 */
function _extractStoryBlocks(md) {
    const lines = md.split(/\r?\n/);
    /** @type {Array<{title:string, innerTitle:string, lines:string[]}>} */
    const blocks = [];
    /** @type {{title:string, innerTitle:string, lines:string[]}|null} */
    let cur = null;
    let lastHeading = '';
    for (const l of lines) {
        const t = l.trim();
        const heading = t.match(/^#{1,6}\s+(.*)/);
        if (cur) {
            if (t === '<!-- story:end -->') { blocks.push(cur); cur = null; continue; }
            // 블록 내부 첫 헤딩을 서사 제목으로 우선 사용 (예: '## 프롤로그 — …')
            if (heading && !cur.innerTitle) cur.innerTitle = heading[1].trim();
            cur.lines.push(l);
            continue;
        }
        if (t === '<!-- story:start -->') { cur = { title: lastHeading, innerTitle: '', lines: [] }; continue; }
        if (heading) lastHeading = heading[1].trim();
    }
    return blocks
        .map(b => ({
            title: b.innerTitle || b.title,
            text: b.lines.join('\n')
                .replace(/<!--[^\n]*?-->/g, '')
                .split('\n')
                .filter(l => !l.includes('┈') && !l.trim().startsWith('!['))
                .join('\n')
                .trim()
        }))
        .filter(b => b.text.length > 0);
}

/**
 * 활성 시험의 storyFile을 지연 로드해 서사 블록을 검색 인덱스에 병합한다.
 * @returns {Promise<number>} 추가된 인덱스 항목 수
 */
function _ensureStoryIndex() {
    if (_storyIndexPromise) return _storyIndexPromise;
    _storyIndexPromise = (async () => {
        if (!hasFeature('story_textbook')) return 0;
        const manifest = await DataLoader._getManifest();
        const STUDY_DATA = (typeof window !== 'undefined' && window.STUDY_DATA) ? window.STUDY_DATA : {};
        /** @type {Array<object>} */
        const entries = [];
        for (const subjMeta of manifest.subjects || []) {
            const subj = STUDY_DATA[subjMeta.key];
            for (const chMeta of subjMeta.chapters || []) {
                if (!chMeta.storyFile) continue;
                try {
                    const md = await DataLoader._getMd(PATHS.TEXTBOOK_FILE(subjMeta.dir, chMeta.storyFile), subjMeta.key);
                    const chapter = (subj && subj.chapters || []).find(c => c.chapterKey === chMeta.key);
                    const chapterTitle = (chapter && chapter.chapterTitle) || chMeta.title || '';
                    for (const block of _extractStoryBlocks(md)) {
                        const sectionTitle = `📖 ${block.title || '서사'}`;
                        entries.push({
                            subjId: subjMeta.key,
                            subjName: (subj && subj.name) || subjMeta.name || subjMeta.key,
                            chapterTitle,
                            filePath: PATHS.TEXTBOOK_FILE_REL(subjMeta.dir, chMeta.storyFile),
                            sectionTitle,
                            content: block.text,
                            fromStory: true,
                            _searchText: (sectionTitle + ' ' + block.text).toLowerCase()
                        });
                    }
                } catch (e) {
                    console.warn('[Search] 서사 인덱스 로드 실패:', chMeta.storyFile, e);
                }
            }
        }
        _storyEntries = entries;
        // 이미 구축된 인덱스가 있으면 서사 항목을 뒤에 붙이고 역색인을 재구축한다
        if (_searchIndex && entries.length) {
            _searchIndex.push(...entries);
            _buildInvertedIndex();
        }
        return entries.length;
    })().catch(() => { _storyIndexPromise = null; return 0; });
    return _storyIndexPromise;
}

// --- TS-11: 참조자료 지연 인덱싱 ---
// ref_md 문서는 번들되지 않으므로 첫 검색 시 지연 fetch해 문서 단위 항목으로 병합한다.
// 조문 원문이라 교재 섹션보다 매치가 넓어, 결과는 '참조자료' 배지로 구분하고 교재 뒤에 배치한다.
/** @type {Array<object>|null} */
let _refEntries = null;
/** @type {Promise<number>|null} */
let _refIndexPromise = null;

/**
 * 활성 시험의 참조자료 문서 목록 — pdf-registry 테이블 기반 (파일시스템 접근 없이 열거).
 * 과목 귀속: REF_MD_SUBJECTS의 ref_md/과목N → SUBJECT_DIR_MAP으로 subject key 역해석.
 * 원료 목록은 ref_md 밖(참조자료/원료/)이지만 과목2(제조·품질) 도메인으로 귀속해 포함한다.
 * @param {object} t getRefTables() 결과
 * @returns {Array<{subjId:string, file:string, path:string, docName:string}>}
 */
export function _listRefDocs(t) {
    const dirToSubj = {};
    for (const [key, dir] of Object.entries(t.SUBJECT_DIR_MAP || {})) dirToSubj[dir] = key;
    // 친화적 표시명 맵 — REFERENCE_* 테이블의 name 우선
    const nameOf = {};
    for (const coll of [t.REFERENCE_FILES, t.REFERENCE_COMMON, t.REFERENCE_INGREDIENTS, t.REFERENCE_LAW]) {
        const list = Array.isArray(coll) ? coll : Object.values(coll || {}).flat();
        for (const e of list) if (e && e.file && e.name) nameOf[e.file] = e.name;
    }
    const docs = [];
    for (const [file, dir] of Object.entries(t.REF_MD_SUBJECTS || {})) {
        const subjId = dirToSubj[dir];
        const path = (t.REF_FILE_TO_PATH || {})[file];
        if (!subjId || !path) continue;
        docs.push({ subjId, file, path, docName: nameOf[file] || file.replace(/\.pdf$/, '') });
    }
    const ingSubj = dirToSubj['과목2'];
    if (ingSubj) {
        for (const e of (t.REFERENCE_INGREDIENTS || [])) {
            if (!e.file) continue;
            docs.push({
                subjId: ingSubj,
                file: e.file,
                path: `${t.contentRoot || 'content'}/참조자료/원료/${e.file}`,
                docName: e.name || e.file
            });
        }
    }
    return docs;
}

/**
 * 문서 본문에서 첫 매치 주변 스니펫 + 라인 번호 계산 (참조자료 결과용).
 * @returns {{snippet: string, lineNum: number}} lineNum은 1-based (ExamViewer.openExam 인자)
 */
export function _matchSnippet(text, terms, radius = 160) {
    const lower = text.toLowerCase();
    let pos = -1;
    let hitTerm = '';
    for (const t of terms) {
        const i = lower.indexOf(t);
        if (i >= 0 && (pos < 0 || i < pos)) { pos = i; hitTerm = t; }
    }
    if (pos < 0) return { snippet: text.slice(0, radius * 2), lineNum: 1 };
    const start = Math.max(0, pos - radius);
    const end = Math.min(text.length, pos + hitTerm.length + radius);
    const snippet = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
    const lineNum = text.slice(0, pos).split('\n').length;
    return { snippet, lineNum };
}

/** 참조자료 문서를 지연 로드해 검색 인덱스에 병합한다. @returns {Promise<number>} 추가된 항목 수 */
function _ensureRefIndex() {
    if (_refIndexPromise) return _refIndexPromise;
    _refIndexPromise = (async () => {
        const manifest = await DataLoader._getManifest();
        const subjNameOf = {};
        for (const s of manifest.subjects || []) subjNameOf[s.key] = s.name;
        const docs = _listRefDocs(getRefTables());
        const entries = (await Promise.all(docs.map(async (d) => {
            try {
                const resp = await fetch(new URL(d.path, window.location.href).href);
                if (!resp.ok) return null;
                const text = await resp.text();
                return {
                    subjId: d.subjId,
                    subjName: subjNameOf[d.subjId] || d.subjId,
                    docName: d.docName,
                    filePath: d.path,
                    refText: text,
                    fromRef: true,
                    _searchText: `${d.docName}\n${text}`.toLowerCase()
                };
            } catch (e) {
                return null; // 오프라인·미캐시 — 해당 문서만 건너뜀
            }
        }))).filter(Boolean);
        _refEntries = entries;
        // 이미 구축된 인덱스가 있으면 참조 항목을 뒤에 붙이고 역색인을 재구축한다
        if (_searchIndex && entries.length) {
            _searchIndex.push(...entries);
            _buildInvertedIndex();
        }
        return entries.length;
    })().catch(() => { _refIndexPromise = null; return 0; });
    return _refIndexPromise;
}

function _getSearchIndex() {
    const STUDY_DATA = (typeof window !== 'undefined' && window.STUDY_DATA) ? window.STUDY_DATA : {};
    const keys = Object.keys(STUDY_DATA).join(',');
    if (_searchIndex && _searchIndexKeys === keys) return _searchIndex;
    _searchIndexKeys = keys;
    _searchIndex = [];
    Object.keys(STUDY_DATA).forEach(subjId => {
        const subj = STUDY_DATA[subjId];
        if (!subj.chapters) return;
        subj.chapters.forEach(chapter => {
            if (!chapter.sections) return;
            chapter.sections.forEach(section => {
                // subsections의 content도 검색 인덱스에 포함
                let fullContent = section.content || '';
                if (section.subsections && section.subsections.length) {
                    section.subsections.forEach(sub => {
                        fullContent += '\n' + (sub.title || '') + '\n' + (sub.content || '');
                    });
                }
                // story:start/end 주석·가시 경계 마커(┈ 라인)는 검색 인덱스에서 제외
                fullContent = fullContent
                    .replace(/<!--[^\n]*?-->/g, '')
                    .split('\n')
                    .filter(l => !l.includes('┈'))
                    .join('\n');
                _searchIndex.push({
                    subjId,
                    subjName: subj.name,
                    chapterTitle: chapter.chapterTitle,
                    filePath: chapter.filePath,
                    sectionTitle: section.title,
                    content: fullContent,
                    _searchText: (section.title + ' ' + fullContent).toLowerCase()
                });
            });
        });
    });
    // 서사·참조자료 인덱스가 이미 로드돼 있으면 병합 (지연 로드 시에도 인덱스 재구축 없이 유지)
    if (_storyEntries && _storyEntries.length) _searchIndex.push(..._storyEntries);
    if (_refEntries && _refEntries.length) _searchIndex.push(..._refEntries);
    // 3. 역색인 구축 — 각 섹션의 텍스트를 토큰화하여 단어→섹션 인덱스 생성
    _buildInvertedIndex();
    return _searchIndex;
}

// 3. 역색인 구축 — 한국어는 공백 기준 토큰화 + 2-gram 보조
function _buildInvertedIndex() {
    _invertedIndex = new Map();
    _invertedIndexKeys = _searchIndexKeys;

    _searchIndex.forEach((entry, idx) => {
        const text = entry._searchText;
        // 공백 기준 토큰화
        const tokens = text.split(/\s+/).filter(t => t.length >= 2);
        tokens.forEach(token => {
            // 완전 단어 인덱스
            if (!_invertedIndex.has(token)) _invertedIndex.set(token, new Set());
            _invertedIndex.get(token).add(idx);
            // 2-gram 인덱스 (부분 매칭용)
            for (let i = 0; i < token.length - 1; i++) {
                const bigram = token.substring(i, i + 2);
                if (!_invertedIndex.has(bigram)) _invertedIndex.set(bigram, new Set());
                _invertedIndex.get(bigram).add(idx);
            }
        });
    });
}

export function renderTextbookSearch() {
    const searchInput = /** @type {HTMLInputElement} */ (document.getElementById('textbook-search-input'));

    // Bind search input events only once
    if (searchInput && !searchInput.dataset.bound) {
        searchInput.dataset.bound = 'true';

        searchInput.addEventListener('input', (e) => {
            _runSearch(e.target instanceof HTMLInputElement ? e.target.value.trim() : '');
        });

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                _runSearch.cancel();
                textbookState.searchQuery = (e.target instanceof HTMLInputElement ? e.target.value : '').trim();
                performTextbookSearch();
            }
        });
    }

    performTextbookSearch();
}

export function setTextbookFilter(filterVal) {
    textbookState.filter = filterVal;

    // Update active filter class
    const buttons = document.querySelectorAll('.textbook-filter-buttons .btn');
    buttons.forEach(btn => {
        if (btn.getAttribute('data-filter') === filterVal) {
            btn.classList.add('active-filter');
        } else {
            btn.classList.remove('active-filter');
        }
    });

    performTextbookSearch();
}

/** 외부(통합 검색 팔레트)에서 검색어 주입 — 뷰 진입 전 호출해도 상태가 유지되어 로드 후 렌더에 반영된다 */
export function setTextbookSearchQuery(query) {
    textbookState.searchQuery = (query || '').trim();
    const searchInput = /** @type {HTMLInputElement} */ (document.getElementById('textbook-search-input'));
    if (searchInput) searchInput.value = textbookState.searchQuery;
    performTextbookSearch();
}

export function clearTextbookSearch() {
    const searchInput = /** @type {HTMLInputElement} */ (document.getElementById('textbook-search-input'));
    if (searchInput) {
        searchInput.value = '';
    }
    textbookState.searchQuery = '';
    performTextbookSearch();
}

function performTextbookSearch() {
    const container = document.getElementById('textbook-results-container');
    const summary = document.getElementById('textbook-search-summary');
    if (!container || !summary) return;

    const query = textbookState.searchQuery.toLowerCase().trim();
    if (!query) {
        // Show empty state
        summary.textContent = '키워드를 입력하면 검색 결과가 여기에 표시됩니다.';
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-book-open" style="font-size: 3rem; color: var(--color-text-muted); margin-bottom: 1rem; display: block;"></i>
                <h3>검색어를 입력하세요</h3>
                <p>위 검색창에 궁금한 교재 키워드를 입력하고 검색 결과를 확인하세요.</p>
            </div>
        `;
        return;
    }

    const terms = query.split(/\s+/).filter(t => t.length > 0);
    // TS-10/TS-11 — 서사·참조자료 인덱스 최초 1회 지연 로드; 완료 시 같은 검색어로 재실행
    // (resolved promise 재사용 시 재실행 루프가 되므로 트리거는 로드 시작 1회에 한정)
    if (!_storyIndexPromise) {
        _ensureStoryIndex().then(added => {
            if (added && textbookState.searchQuery.toLowerCase().trim() === query) {
                performTextbookSearch();
            }
        });
    }
    if (!_refIndexPromise) {
        _ensureRefIndex().then(added => {
            if (added && textbookState.searchQuery.toLowerCase().trim() === query) {
                performTextbookSearch();
            }
        });
    }
    const index = _getSearchIndex();
    /** @type {Array<object>} */
    const results = [];
    /** @type {Array<object>} */
    const refResults = [];

    // 3. 역색인 활용 — 각 검색어에 대해 후보 섹션 집합을 구하고 교집합 계산
    let candidateIndices = null;
    for (const term of terms) {
        let termMatches = new Set();
        // 역색인에서 완전 매칭
        if (_invertedIndex && _invertedIndex.has(term)) {
            termMatches = new Set(_invertedIndex.get(term));
        } else if (_invertedIndex) {
            // 부분 매칭 — 역색인에서 term을 포함하는 토큰 검색
            for (const [token, indices] of _invertedIndex) {
                if (token.includes(term)) {
                    indices.forEach(i => termMatches.add(i));
                }
            }
        }
        if (candidateIndices === null) {
            candidateIndices = termMatches;
        } else {
            // 교집합
            candidateIndices = new Set([...candidateIndices].filter(i => termMatches.has(i)));
        }
        if (candidateIndices.size === 0) break;
    }

    // 역색인 결과가 있으면 해당 섹션만 검사, 없으면 전체 검사 (fallback)
    const searchEntries = (candidateIndices && candidateIndices.size > 0)
        ? [...candidateIndices].map(i => ({ entry: index[i], originalIdx: i }))
        : index.map((entry, i) => ({ entry, originalIdx: i }));

    for (const { entry } of searchEntries) {
        if (textbookState.filter !== 'all' && textbookState.filter !== entry.subjId) continue;
        const isMatch = terms.every(term => entry._searchText.includes(term));
        if (!isMatch) continue;
        if (entry.fromRef) {
            refResults.push({
                subjId: entry.subjId,
                subjName: entry.subjName,
                docName: entry.docName,
                filePath: entry.filePath,
                refText: entry.refText,
                fromRef: true,
                _hits: entry._searchText.split(terms[0]).length - 1
            });
        } else {
            results.push({
                subjId: entry.subjId,
                subjName: entry.subjName,
                chapterTitle: entry.chapterTitle,
                filePath: entry.filePath,
                sectionTitle: entry.sectionTitle,
                content: entry.content,
                fromStory: !!entry.fromStory
            });
        }
    }

    // TS-11 — 참조자료는 조문 원문이라 매치가 넓어 교재 결과 뒤에 배치, 히트수 정렬·상한 적용
    refResults.sort((a, b) => b._hits - a._hits);
    const REF_RESULT_LIMIT = 15;
    const shownRefs = refResults.slice(0, REF_RESULT_LIMIT);
    const allResults = results.concat(shownRefs);

    // Update summary text
    summary.innerHTML = `총 <strong style="color: var(--color-primary);">${allResults.length}</strong>건의 관련 내용을 찾았습니다.`;

    if (allResults.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-triangle-exclamation" style="font-size: 3rem; color: var(--color-warning); margin-bottom: 1rem; display: block;"></i>
                <h3>일치하는 내용이 없습니다</h3>
                <p>다른 검색어로 검색해보거나 띄어쓰기를 확인해보세요.</p>
            </div>
        `;
        return;
    }

    // Render results
    container.innerHTML = '';
    allResults.forEach((item, idx) => {
        const colors = ['badge-cyan', 'badge-violet', 'badge-emerald', 'badge-amber', 'badge-rose', 'badge-indigo'];
        const badgeColors = {};
        const subjects = (window.DATA_REGISTRY && window.DATA_REGISTRY.subjects) || [];
        subjects.forEach((sub, idx) => {
            badgeColors[sub.key] = colors[idx % colors.length];
        });
        const badgeColor = badgeColors[item.subjId] || 'badge-gray';

        // 참조자료 결과 — 문서 단위 + 매치 스니펫 + ExamViewer 라인 딥링크 (TS-11)
        if (item.fromRef) {
            const { snippet, lineNum } = _matchSnippet(item.refText, terms);
            const argsJson = esc(JSON.stringify([item.filePath, lineNum]));
            const refCardHTML = `
            <div class="textbook-result-card">
                <div class="textbook-card-header">
                    <span class="textbook-card-path">
                        <span class="badge ${badgeColor}">${esc(item.subjName)}</span>
                        <span class="badge badge-gray">참조자료</span>
                        <i class="fa-solid fa-chevron-right"></i>
                        <span>${esc(item.docName)}</span>
                    </span>
                    <button class="btn btn-secondary" data-click="ExamViewer.openExam" data-args='${argsJson}' style="padding: 0.3rem 0.6rem; font-size: 0.75rem; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem;">
                        <i class="fa-solid fa-book-open"></i> 원문 보기
                    </button>
                </div>
                <h4 class="textbook-card-title">${highlightTextInString(item.docName, terms)}</h4>
                <div class="textbook-card-body"><div style="white-space:pre-wrap; word-break:break-word; font-size: 0.9rem;">${highlightTextInString(snippet, terms)}</div></div>
            </div>
        `;
            container.insertAdjacentHTML('beforeend', refCardHTML);
            return;
        }

        const isLong = item.content.length > 300;
        const bodyClass = isLong ? 'textbook-card-body collapsed' : 'textbook-card-body';
        const formattedContent = formatSectionContent(item.content, terms);
        const storyBadge = item.fromStory ? '<span class="badge badge-gray">서사</span>' : '';

        const cardId = `textbook-card-${idx}`;
        const cardHTML = `
            <div class="textbook-result-card">
                <div class="textbook-card-header">
                    <span class="textbook-card-path">
                        <span class="badge ${badgeColor}">${esc(item.subjName)}</span>
                        ${storyBadge}
                        <i class="fa-solid fa-chevron-right"></i>
                        <span>${esc(item.chapterTitle)}</span>
                    </span>
                    <a href="${esc(item.filePath)}" target="_blank" class="btn btn-secondary" style="padding: 0.3rem 0.6rem; font-size: 0.75rem; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem;">
                        <i class="fa-solid fa-arrow-up-right-from-square"></i> 전체 단원 보기
                    </a>
                </div>
                <h4 class="textbook-card-title">${highlightTextInString(item.sectionTitle, terms)}</h4>
                <div class="${bodyClass}" id="${cardId}-body">
                    ${formattedContent}
                </div>
                ${isLong ? `
                <div class="textbook-card-actions">
                    <button class="btn btn-secondary" data-click="toggleTextbookCard" data-arg="${cardId}" id="${cardId}-toggle-btn" style="padding: 0.4rem 0.8rem; font-size: 0.8rem; font-weight: 600;">
                        <i class="fa-solid fa-chevron-down"></i> 더 보기
                    </button>
                </div>
                ` : ''}
            </div>
        `;
        container.insertAdjacentHTML('beforeend', cardHTML);
    });

    if (refResults.length > REF_RESULT_LIMIT) {
        container.insertAdjacentHTML('beforeend',
            `<div style="opacity:0.6; font-size:0.85rem; text-align:center; padding:0.5rem;">참조자료 결과가 많아 상위 ${esc(String(REF_RESULT_LIMIT))}건만 표시합니다 (전체 ${esc(String(refResults.length))}건).</div>`);
    }

    // Mermaid 다이어그램 렌더링 (pre.mermaid 노드가 있을 때만 온디맨드 로드)
    renderMermaidIn(container, '[search]');
    attachImageZoomIn(container);
}

export function toggleTextbookCard(cardId) {
    const body = document.getElementById(`${cardId}-body`);
    const btn = document.getElementById(`${cardId}-toggle-btn`);
    if (!body || !btn) return;

    if (body.classList.contains('collapsed')) {
        body.classList.remove('collapsed');
        body.style.maxHeight = 'none';
        btn.innerHTML = `<i class="fa-solid fa-chevron-up"></i> 접기`;
    } else {
        body.classList.add('collapsed');
        body.style.maxHeight = '';
        btn.innerHTML = `<i class="fa-solid fa-chevron-down"></i> 더 보기`;
        body.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function formatSectionContent(rawContent, searchTerms = []) {
    // parseMarkdown으로 마크다운 → HTML 변환 (코드블록, 머메이드, 테이블 등 지원)
    let html = parseMarkdown(rawContent, {
        useCustomListDiv: true,
        useReaderStyles: true,
        customSpacing: true,
        allowItalics: false,
        allowInlineCode: false,
        allowMermaid: true
    });

    // 검색어 하이라이트 (마크다운 파싱 후 적용)
    if (searchTerms.length > 0) {
        searchTerms.forEach(term => {
            if (term.length > 0) {
                html = highlightTextOutsideTags(html, term);
            }
        });
    }

    return html;
}

function highlightTextInString(text, searchTerms = []) {
    let html = escapeHTML(text);
    if (searchTerms.length > 0) {
        searchTerms.forEach(term => {
            if (term.length > 0) {
                const escapedTerm = escapeRegExp(term);
                const termRegex = new RegExp(`(${escapedTerm})`, 'gi');
                html = html.replace(termRegex, '<mark class="txt-highlight">$1</mark>');
            }
        });
    }
    return html;
}

function highlightTextOutsideTags(html, term) {
    const regex = new RegExp(`([^<]*)(<[^>]+>)?`, 'g');
    const escapedTerm = escapeRegExp(term);
    const termRegex = new RegExp(`(${escapedTerm})`, 'gi');

    return html.replace(regex, (match, text, tag) => {
        const highlightedText = text.replace(termRegex, '<mark class="txt-highlight">$1</mark>');
        return highlightedText + (tag || '');
    });
}

