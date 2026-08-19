// ==UserScript==
// @name         Arca KR->JP Auto Translate
// @namespace    korjp.arca
// @version      7.0.1
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

    const DONE = 'data-korjp';
    const CACHE_KEY = 'korjp_cache_v7';
    const MAX = 4;

    const KO = /[가-힣]/;
    const JP = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;

    let key = GM_getValue('korjp_api_key', '');
    let running = 0;
    let cache = {};

    const queue = [];
    const queued = new WeakSet();


    // ==================================================
    // 캐시
    // ==================================================

    try {
        const x = GM_getValue(CACHE_KEY, '{}');

        cache =
            typeof x === 'string'
                ? JSON.parse(x)
                : x || {};

    } catch {
        cache = {};
    }


    function hash(s) {

        let h = 2166136261;

        for (let i = 0; i < s.length; i++) {

            h ^= s.charCodeAt(i);

            h +=
                (h << 1) +
                (h << 4) +
                (h << 7) +
                (h << 8) +
                (h << 24);
        }

        return (h >>> 0).toString(16);
    }


    // ==================================================
    // 스타일
    // ==================================================

    const style =
        document.createElement('style');

    style.textContent = `

        .korjp-t {
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

        .korjp-loading {
            color:#777!important;
        }

        .korjp-cache {
            border-left-color:#5b9b68!important;
        }

        .korjp-error {
            border-left-color:#d9534f!important;
            color:#a33!important;
            background:#fff5f5!important;
        }

        @media (max-width:700px) {

            .korjp-t {
                margin:3px 0 6px!important;
                padding:4px 7px!important;
                font-size:12px!important;
                line-height:1.35!important;
                max-width:90%!important;
            }

        }

        #korjp-panel {
            position:fixed!important;
            inset:0!important;
            z-index:2147483647!important;
            display:flex!important;
            align-items:center!important;
            justify-content:center!important;
            padding:20px!important;
            background:rgba(0,0,0,.65)!important;
        }

        #korjp-box {
            width:min(420px,100%)!important;
            padding:20px!important;
            box-sizing:border-box!important;
            border-radius:12px!important;
            background:#fff!important;
            color:#222!important;
            box-shadow:0 10px 40px rgba(0,0,0,.35)!important;
        }

        #korjp-input {
            width:100%!important;
            box-sizing:border-box!important;
            padding:11px!important;
            border:1px solid #ccc!important;
            border-radius:7px!important;
            font-size:15px!important;
        }

        #korjp-save {
            width:100%!important;
            margin-top:10px!important;
            padding:11px!important;
            border:0!important;
            border-radius:7px!important;
            background:#333!important;
            color:#fff!important;
            font-weight:bold!important;
        }

        #korjp-error {
            margin-top:8px!important;
            color:#d33!important;
            font-size:13px!important;
        }

    `;

    document.head.appendChild(style);


    // ==================================================
    // API 입력
    // ==================================================

    function apiPanel() {

        if (
            document.getElementById(
                'korjp-panel'
            )
        ) {
            return;
        }

        const p =
            document.createElement('div');

        p.id =
            'korjp-panel';

        p.innerHTML = `

            <div id="korjp-box">

                <h3>
                    한국어 → 일본어 자동번역
                </h3>

                <p>
                    OpenAI API 키를 입력하세요.
                </p>

                <input
                    id="korjp-input"
                    type="password"
                    placeholder="sk-..."
                    autocomplete="off">

                <button id="korjp-save">
                    저장하고 시작
                </button>

                <div id="korjp-error"></div>

            </div>

        `;

        document.documentElement
            .appendChild(p);

        const input =
            document.getElementById(
                'korjp-input'
            );

        const save =
            document.getElementById(
                'korjp-save'
            );

        const error =
            document.getElementById(
                'korjp-error'
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
                'korjp_api_key',
                v
            );

            key = v;

            p.remove();

            start();
        };

        save.onclick = submit;

        input.onkeydown = e => {

            if (e.key === 'Enter') {
                submit();
            }
        };

        setTimeout(
            () => input.focus(),
            100
        );
    }


    // ==================================================
    // 번역 표시
    // ==================================================

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
                'korjp-t'
            )
        ) {

            out =
                document.createElement(
                    'div'
                );

            el.after(out);
        }

        out.className =
            `korjp-t ${cls}`;

        out.textContent =
            text;
    }


    // ==================================================
    // API
    // ==================================================

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
                                effort:
                                    'none'
                            },

                            input: [

                                {
                                    role:
                                        'system',

                                    content:
                                        '한국어를 자연스러운 일본어로 번역한다. ' +
                                        '번역문만 출력하고 설명하지 않는다. ' +
                                        '원문의 말투와 뉘앙스를 유지한다.'
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


    // ==================================================
    // 큐
    // ==================================================

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
            (text || '').trim();


        // 한국어가 없으면 번역하지 않음

        if (
            !text ||
            !KO.test(text)
        ) {

            el.setAttribute(
                DONE,
                'skip'
            );

            return;
        }


        // 캐시

        const cached =
            cache[
                hash(text)
            ];

        if (cached) {

            show(
                el,
                cached,
                'korjp-cache'
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
            '翻訳中…',
            'korjp-loading'
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

            console.error(
                '[KO→JP]',
                e
            );


            show(
                item.el,
                `翻訳エラー: ${e.message}`,
                'korjp-error'
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


    // ==================================================
    // 제목
    // ==================================================

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


            /*
             * 댓글 제목 / 댓글 수
             */

            if (
                el.closest(
                    '#comment'
                ) ||
                el.querySelector(
                    '.title-comment-count'
                )
            ) {

                el.setAttribute(
                    DONE,
                    'ui'
                );

                continue;
            }


            /*
             * 알림
             */

            if (
                el.querySelector(
                    '#removeAllBtn'
                )
            ) {

                el.setAttribute(
                    DONE,
                    'ui'
                );

                continue;
            }


            /*
             * 채널명
             */

            if (
                el.querySelector(
                    '[title$=" 채널"]'
                ) ||
                el.querySelector(
                    '[title$=" チャンネル"]'
                )
            ) {

                el.setAttribute(
                    DONE,
                    'ui'
                );

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


    // ==================================================
    // 본문
    // ==================================================

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


            for (
                let i = 0;
                i < ps.length;
                i++
            ) {

                const p =
                    ps[i];


                if (
                    p.hasAttribute(DONE)
                ) {
                    continue;
                }


                const text =
                    (
                        p.innerText ||
                        p.textContent ||
                        ''
                    ).trim();


                if (
                    !text ||
                    !KO.test(text)
                ) {

                    p.setAttribute(
                        DONE,
                        'skip'
                    );

                    continue;
                }


                /*
                 * 앞쪽의 실제 텍스트 문단
                 */

                let prev = '';

                for (
                    let j = i - 1;
                    j >= 0;
                    j--
                ) {

                    const t =
                        (
                            ps[j].innerText ||
                            ps[j].textContent ||
                            ''
                        ).trim();


                    if (t) {

                        prev = t;

                        break;
                    }
                }


                /*
                 * 뒤쪽의 실제 텍스트 문단
                 */

                let next = '';

                for (
                    let j = i + 1;
                    j < ps.length;
                    j++
                ) {

                    const t =
                        (
                            ps[j].innerText ||
                            ps[j].textContent ||
                            ''
                        ).trim();


                    if (t) {

                        next = t;

                        break;
                    }
                }


                /*
                 * 이미 일본어 원문 + 한국어 번역
                 *
                 * 예:
                 *
                 * 日本語の原文
                 * 한국어 번역
                 *
                 * 현재 p가 한국어라면
                 * 번역하지 않는다.
                 */

                if (
                    prev &&
                    JP.test(prev) &&
                    !KO.test(prev)
                ) {

                    p.setAttribute(
                        DONE,
                        'existing'
                    );

                    continue;
                }


                /*
                 * 혹시 한국어 → 일본어 순서라면
                 * 뒤의 일본어도 확인
                 */

                if (
                    next &&
                    JP.test(next) &&
                    !KO.test(next)
                ) {

                    p.setAttribute(
                        DONE,
                        'existing'
                    );

                    continue;
                }


                enqueue(
                    p,
                    text
                );
            }
        }
    }


    // ==================================================
    // 댓글
    // ==================================================

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


            /*
             * 현재 화면에 보이는 댓글
             */

            const visible =
                (
                    el.innerText ||
                    el.textContent ||
                    ''
                ).trim();


            /*
             * 한→일에서는
             * 한국어가 보인다고 skip하면 안 된다.
             *
             * 한국어 자체가 번역 대상이기 때문.
             */


            /*
             * data-orig가 있으면
             * 그것을 원문으로 사용
             */

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


    // ==================================================
    // 전체 검색
    // ==================================================

    function scan(root) {

        if (!root) {
            return;
        }

        scanTitle(root);

        scanBody(root);

        scanComments(root);
    }


    // ==================================================
    // DOM 감시
    // ==================================================

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
                childList:
                    true,

                subtree:
                    true,

                characterData:
                    true
            }
        );
    }


    // ==================================================
    // 시작
    // ==================================================

    function start() {

        scan(
            document
        );

        observe();

        console.log(
            `[KO→JP] ${MODEL} 활성화`
        );
    }


    // ==================================================
    // 실행
    // ==================================================

    if (key) {

        start();

    } else {

        apiPanel();
    }

})();
