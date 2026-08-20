// ==UserScript==
// @name         아카라이브 일본어 → 한국어
// @namespace    jpko.arca
// @version      7.1.0
// @match        *://arca.live/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      api.openai.com
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const MODEL = 'gpt-5.4-nano';

    const TITLE = '.title';
    const BODY = '.fr-view.article-content';
    const COMMENT = 'pre[data-orig]';

    const DONE = 'data-jpko';

    const CACHE_KEY = 'jpko_cache_v7';

    const MAX = 4;

    // 일본어 판별
    const JP =
        /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;

    // 한국어 판별
    const KO =
        /[가-힣]/;

    let key =
        GM_getValue(
            'jpko_api_key',
            ''
        );

    let running = 0;

    let cache = {};

    const queue = [];

    const queued =
        new WeakSet();


    // =========================================================
    // 캐시
    // =========================================================

    try {

        const x =
            GM_getValue(
                CACHE_KEY,
                '{}'
            );

        cache =
            typeof x === 'string'
                ? JSON.parse(x)
                : x || {};

    } catch {

        cache = {};
    }


    function hash(s) {

        let h = 2166136261;

        for (
            let i = 0;
            i < s.length;
            i++
        ) {

            h ^= s.charCodeAt(i);

            h +=
                (h << 1) +
                (h << 4) +
                (h << 7) +
                (h << 8) +
                (h << 24);
        }

        return (
            h >>> 0
        ).toString(16);
    }


    // =========================================================
    // 스타일
    // =========================================================

    const style =
        document.createElement('style');

    style.textContent = `

        .jpko-t {
            display:block!important;
            margin:6px 0 10px!important;
            padding:7px 10px!important;
            border-left:3px solid #4b82d8!important;
            background:#f3f6fa!important;
            color:#333!important;
            line-height:1.5!important;
            white-space:pre-wrap!important;
            word-break:break-word!important;
        }

        .jpko-loading {
            color:#777!important;
        }

        .jpko-cache {
            border-left-color:#5b9b68!important;
        }

        .jpko-error {
            border-left-color:#d9534f!important;
            color:#a33!important;
            background:#fff5f5!important;
        }

        #jpko-panel {
            position:fixed!important;
            inset:0!important;
            z-index:2147483647!important;
            display:flex!important;
            align-items:center!important;
            justify-content:center!important;
            padding:20px!important;
            background:rgba(0,0,0,.65)!important;
        }

        #jpko-box {
            width:min(420px,100%)!important;
            padding:20px!important;
            box-sizing:border-box!important;
            border-radius:12px!important;
            background:#fff!important;
            color:#222!important;
            box-shadow:0 10px 40px rgba(0,0,0,.35)!important;
        }

        #jpko-input {
            width:100%!important;
            box-sizing:border-box!important;
            padding:11px!important;
            border:1px solid #ccc!important;
            border-radius:7px!important;
            font-size:15px!important;
        }

        #jpko-save {
            width:100%!important;
            margin-top:10px!important;
            padding:11px!important;
            border:0!important;
            border-radius:7px!important;
            background:#333!important;
            color:#fff!important;
            font-weight:bold!important;
        }

        #jpko-error {
            margin-top:8px!important;
            color:#d33!important;
            font-size:13px!important;
        }

    `;

    document.head.appendChild(style);


    // =========================================================
    // API 입력
    // =========================================================

    function apiPanel() {

        if (
            document.getElementById(
                'jpko-panel'
            )
        ) {
            return;
        }

        const p =
            document.createElement('div');

        p.id =
            'jpko-panel';

        p.innerHTML = `
            <div id="jpko-box">

                <h3>
                    日本語 → 韓国語 自動翻訳
                </h3>

                <p>
                    OpenAI API 키를 입력하세요.
                </p>

                <input
                    id="jpko-input"
                    type="password"
                    placeholder="sk-..."
                    autocomplete="off"
                >

                <button id="jpko-save">
                    저장하고 시작
                </button>

                <div id="jpko-error"></div>

            </div>
        `;

        document.documentElement
            .appendChild(p);

        const input =
            document.getElementById(
                'jpko-input'
            );

        const save =
            document.getElementById(
                'jpko-save'
            );

        const error =
            document.getElementById(
                'jpko-error'
            );

        const submit = () => {

            const v =
                input.value.trim();

            if (!v) {

                error.textContent =
                    'API 키를 입력하세요.';

                return;
            }

            GM_setValue(
                'jpko_api_key',
                v
            );

            key = v;

            p.remove();

            start();
        };

        save.onclick =
            submit;

        input.onkeydown =
            e => {

                if (
                    e.key === 'Enter'
                ) {
                    submit();
                }
            };

        setTimeout(
            () => input.focus(),
            100
        );
    }


    // =========================================================
    // 번역 표시
    // =========================================================

    function show(
        el,
        text,
        cls = ''
    ) {

        if (
            !el?.isConnected
        ) {
            return;
        }

        let out =
            el.nextElementSibling;

        if (
            !out?.classList.contains(
                'jpko-t'
            )
        ) {

            out =
                document.createElement(
                    'div'
                );

            el.after(out);
        }

        out.className =
            `jpko-t ${cls}`;

        out.textContent =
            text;
    }


    // =========================================================
    // API
    // =========================================================

    function translate(text) {

        return new Promise(
            (resolve, reject) => {

                GM_xmlhttpRequest({

                    method: 'POST',

                    url:
                        'https://api.openai.com/v1/responses',

                    headers: {

                        'Content-Type':
                            'application/json',

                        'Authorization':
                            `Bearer ${key}`
                    },

                    data:
                        JSON.stringify({

                            model:
                                MODEL,

                            reasoning: {
                                effort: 'none'
                            },

                            input: [

                                {
                                    role:
                                        'system',

                                    content:
                                        '일본어를 자연스러운 한국어로 번역한다. ' +
                                        '번역문만 출력하고 설명하지 않는다. ' +
                                        '원문의 말투와 뉘앙스를 유지한다. ' +
                                        'HTML 태그나 HTML 코드를 출력하지 않는다. ' +
                                        '이미지, 링크 등의 HTML 요소는 번역하지 않는다.'
                                },

                                {
                                    role:
                                        'user',

                                    content:
                                        text
                                }

                            ]
                        }),

                    timeout:
                        30000,

                    onload(r) {

                        try {

                            const d =
                                JSON.parse(
                                    r.responseText ||
                                    '{}'
                                );

                            if (
                                r.status < 200 ||
                                r.status >= 300
                            ) {

                                reject(
                                    new Error(
                                        d?.error?.message ||
                                        `API 오류 ${r.status}`
                                    )
                                );

                                return;
                            }

                            let result =
                                d.output_text;

                            if (
                                !result &&
                                Array.isArray(
                                    d.output
                                )
                            ) {

                                result =
                                    d.output

                                        .flatMap(
                                            x =>
                                                x.content ||
                                                []
                                        )

                                        .filter(
                                            x =>
                                                x.type ===
                                                'output_text'
                                        )

                                        .map(
                                            x =>
                                                x.text
                                        )

                                        .join('');
                            }

                            if (
                                !result?.trim()
                            ) {

                                reject(
                                    new Error(
                                        '번역 결과가 없습니다.'
                                    )
                                );

                                return;
                            }

                            resolve(
                                result.trim()
                            );

                        } catch (e) {

                            reject(e);
                        }
                    },

                    onerror() {

                        reject(
                            new Error(
                                '네트워크 오류'
                            )
                        );
                    },

                    ontimeout() {

                        reject(
                            new Error(
                                '요청 시간 초과'
                            )
                        );
                    }

                });
            }
        );
    }


    // =========================================================
    // 큐
    // =========================================================

    function enqueue(
        el,
        text
    ) {

        if (
            !el?.isConnected ||
            el.hasAttribute(DONE)
        ) {
            return;
        }

        if (
            queued.has(el)
        ) {
            return;
        }

        text =
            text.trim();

        // 일본어가 없거나
        // 한국어가 한 글자라도 있으면 번역하지 않음
        if (
            !text ||
            !JP.test(text) ||
            KO.test(text)
        ) {

            el.setAttribute(
                DONE,
                'skip'
            );

            return;
        }

        const cached =
            cache[
                hash(text)
            ];

        if (cached) {

            show(
                el,
                cached,
                'jpko-cache'
            );

            el.setAttribute(
                DONE,
                'cached'
            );

            return;
        }

        queued.add(el);

        el.setAttribute(
            DONE,
            'queued'
        );

        queue.push({
            el,
            text
        });

        pump();
    }


    function pump() {

        while (
            running < MAX &&
            queue.length
        ) {

            run(
                queue.shift()
            );
        }
    }


    async function run(item) {

        running++;

        show(
            item.el,
            '번역 중…',
            'jpko-loading'
        );

        try {

            const result =
                await translate(
                    item.text
                );

            cache[
                hash(item.text)
            ] =
                result;

            GM_setValue(
                CACHE_KEY,
                JSON.stringify(cache)
            );

            show(
                item.el,
                result
            );

            item.el.setAttribute(
                DONE,
                'done'
            );

        } catch (e) {

            show(
                item.el,
                `번역 오류: ${e.message}`,
                'jpko-error'
            );

            item.el.setAttribute(
                DONE,
                'error'
            );

        } finally {

            running--;

            pump();
        }
    }


    // =========================================================
    // 제목
    // =========================================================

    function scanTitle(root) {

        const list = [];

        if (
            root instanceof Element &&
            root.matches(TITLE)
        ) {

            list.push(root);
        }

        if (
            root.querySelectorAll
        ) {

            list.push(
                ...root.querySelectorAll(
                    TITLE
                )
            );
        }

        for (
            const el of list
        ) {

            if (
                el.hasAttribute(DONE)
            ) {
                continue;
            }

            const walker =
                document.createTreeWalker(
                    el,
                    NodeFilter.SHOW_TEXT
                );

            let text = '';

            let node;

            while (
                node =
                    walker.nextNode()
            ) {

                if (
                    node.parentElement?.closest(
                        '.category-badge'
                    )
                ) {
                    continue;
                }

                text +=
                    ' ' +
                    node.nodeValue;
            }

            enqueue(
                el,
                text
            );
        }
    }


    // =========================================================
    // 본문
    // =========================================================

    function scanBody(root) {

        const list = [];

        if (
            root instanceof Element &&
            root.matches(BODY)
        ) {

            list.push(root);
        }

        if (
            root.querySelectorAll
        ) {

            list.push(
                ...root.querySelectorAll(
                    BODY
                )
            );
        }

        for (
            const body of list
        ) {

            const ps =
                [
                    ...body.querySelectorAll(
                        ':scope > p'
                    )
                ];

            // -------------------------------------------------
            // 빈 p를 제외한 실제 문단 목록
            // -------------------------------------------------

            const meaningful = [];

            for (
                const p of ps
            ) {

                const text =
                    (
                        p.innerText ||
                        p.textContent ||
                        ''
                    )
                        .replace(
                            /\u00a0/g,
                            ' '
                        )
                        .trim();

                if (text) {

                    meaningful.push({
                        el: p,
                        text
                    });
                }
            }


            // -------------------------------------------------
            // 문단 검사
            // -------------------------------------------------

            for (
                let i = 0;
                i < meaningful.length;
                i++
            ) {

                const {
                    el: p,
                    text
                } =
                    meaningful[i];

                if (
                    p.hasAttribute(DONE)
                ) {
                    continue;
                }


                // -------------------------------------------------
                // 일본어가 없으면 번역하지 않음
                // -------------------------------------------------

                if (
                    !JP.test(text)
                ) {

                    p.setAttribute(
                        DONE,
                        'skip'
                    );

                    continue;
                }


                // -------------------------------------------------
                // 한국어가 한 글자라도 섞여 있으면
                // 번역하지 않음
                // -------------------------------------------------

                if (
                    KO.test(text)
                ) {

                    p.setAttribute(
                        DONE,
                        'skip'
                    );

                    continue;
                }


                const prev =
                    i > 0
                        ? meaningful[i - 1]
                        : null;

                const next =
                    i + 1 <
                    meaningful.length
                        ? meaningful[i + 1]
                        : null;


                // -------------------------------------------------
                // 이미 번역된 문장
                //
                // 한국어
                // 일본어
                // -------------------------------------------------

                if (
                    prev &&
                    KO.test(
                        prev.text
                    ) &&
                    !JP.test(
                        prev.text
                    )
                ) {

                    p.setAttribute(
                        DONE,
                        'existing'
                    );

                    continue;
                }


                // -------------------------------------------------
                // 이미 번역된 문장
                //
                // 일본어
                // 한국어
                // -------------------------------------------------

                if (
                    next &&
                    KO.test(
                        next.text
                    ) &&
                    !JP.test(
                        next.text
                    )
                ) {

                    p.setAttribute(
                        DONE,
                        'existing'
                    );

                    continue;
                }


                // -------------------------------------------------
                // 실제 번역
                // -------------------------------------------------

                enqueue(
                    p,
                    text
                );
            }
        }
    }


    // =========================================================
    // 댓글
    // =========================================================

    function scanComments(root) {

        const list = [];

        if (
            root instanceof Element &&
            root.matches(COMMENT)
        ) {

            list.push(root);
        }

        if (
            root.querySelectorAll
        ) {

            list.push(
                ...root.querySelectorAll(
                    COMMENT
                )
            );
        }

        for (
            const el of list
        ) {

            if (
                el.hasAttribute(DONE)
            ) {
                continue;
            }

            const visible =
                (
                    el.innerText ||
                    el.textContent ||
                    ''
                ).trim();

            if (
                KO.test(visible)
            ) {

                el.setAttribute(
                    DONE,
                    'korean'
                );

                continue;
            }

            const original =
                (
                    el.getAttribute(
                        'data-orig'
                    ) ||
                    visible
                ).trim();

            enqueue(
                el,
                original
            );
        }
    }


    // =========================================================
    // 전체 검색
    // =========================================================

    function scan(root) {

        if (!root) {
            return;
        }

        scanTitle(root);

        scanBody(root);

        scanComments(root);
    }


    // =========================================================
    // DOM 감시
    // =========================================================

    function observe() {

        const observer =
            new MutationObserver(
                mutations => {

                    for (
                        const mutation
                        of mutations
                    ) {

                        for (
                            const node
                            of mutation.addedNodes
                        ) {

                            if (
                                node.nodeType ===
                                Node.ELEMENT_NODE
                            ) {

                                scan(node);
                            }
                        }

                        if (
                            mutation.type ===
                            'characterData'
                        ) {

                            scan(
                                mutation
                                    .target
                                    .parentElement
                            );
                        }
                    }
                }
            );

        observer.observe(
            document.body,
            {
                childList: true,
                subtree: true,
                characterData: true
            }
        );
    }


    // =========================================================
    // 시작
    // =========================================================

    function start() {

        loadCache();

        scan(document);

        observe();

        console.log(
            `[JP→KO] ${MODEL} 활성화`
        );
    }


    function loadCache() {

        try {

            const x =
                GM_getValue(
                    CACHE_KEY,
                    '{}'
                );

            cache =
                typeof x === 'string'
                    ? JSON.parse(x)
                    : x || {};

        } catch {

            cache = {};
        }
    }


    // =========================================================
    // 실행
    // =========================================================

    if (key) {

        start();

    } else {

        apiPanel();
    }

})();
