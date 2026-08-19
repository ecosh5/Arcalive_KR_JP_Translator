// ==UserScript==
// @name         아카라이브 한→일 작성 자동번역
// @namespace    arca.korjp.writer
// @version      10.0.0
// @description  아카라이브 제목/본문/댓글 한국어 자동 일본어 번역
// @match        *://arca.live/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      api.openai.com
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    // =========================================================
    // 설정
    // =========================================================

    const MODEL = 'gpt-5.4-nano';

    // 제목 / 댓글 번역 대기시간
    const DELAY = 500;

    const API_KEY_STORAGE =
        'arca_korjp_writer_api_key';

    const BODY_SELECTOR =
        '.fr-element.fr-view[contenteditable="true"]';

    const TITLE_SELECTOR =
        '#inputTitle';

    const REPLY_SELECTOR =
        'textarea.reply-form-textarea';

    const KOREAN =
        /[가-힣]/;


    // =========================================================
    // API KEY
    // =========================================================

    let apiKey =
        GM_getValue(
            API_KEY_STORAGE,
            ''
        );


    function ensureApiKey() {

        if (apiKey) {
            return true;
        }

        const key =
            prompt(
                'OpenAI API 키를 입력하세요.'
            );

        if (!key) {
            return false;
        }

        apiKey =
            key.trim();

        GM_setValue(
            API_KEY_STORAGE,
            apiKey
        );

        return true;
    }


    // =========================================================
    // OpenAI 번역
    // =========================================================

    function translate(text) {

        return new Promise(
            (resolve, reject) => {

                GM_xmlhttpRequest({

                    method:
                        'POST',

                    url:
                        'https://api.openai.com/v1/responses',

                    headers: {

                        'Content-Type':
                            'application/json',

                        'Authorization':
                            `Bearer ${apiKey}`
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
                                        '한국어를 자연스러운 일본어로 번역하세요. ' +
                                        '번역문만 출력하세요. ' +
                                        '설명이나 따옴표를 붙이지 마세요. ' +
                                        '원문의 말투와 뉘앙스를 유지하세요.'
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
                        60000,


                    onload(response) {

                        try {

                            const data =
                                JSON.parse(
                                    response.responseText ||
                                    '{}'
                                );


                            if (
                                response.status < 200 ||
                                response.status >= 300
                            ) {

                                reject(
                                    new Error(
                                        data?.error?.message ||
                                        `API 오류 ${response.status}`
                                    )
                                );

                                return;
                            }


                            let result =
                                data.output_text ||
                                '';


                            if (
                                !result &&
                                Array.isArray(
                                    data.output
                                )
                            ) {

                                result =
                                    data.output
                                        .flatMap(
                                            item =>
                                                item.content ||
                                                []
                                        )
                                        .filter(
                                            item =>
                                                item.type ===
                                                'output_text'
                                        )
                                        .map(
                                            item =>
                                                item.text ||
                                                ''
                                        )
                                        .join('');
                            }


                            result =
                                result.trim();


                            if (!result) {

                                reject(
                                    new Error(
                                        '번역 결과가 없습니다.'
                                    )
                                );

                                return;
                            }


                            resolve(
                                result
                            );

                        } catch (error) {

                            reject(
                                error
                            );
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
                                'API 요청 시간 초과'
                            )
                        );
                    }
                });
            }
        );
    }


    // =========================================================
    // 공통 텍스트
    // =========================================================

    function getText(element) {

        return (
            element.innerText ||
            element.textContent ||
            ''
        )
            .replace(
                /\u00a0/g,
                ' '
            )
            .trim();
    }


    function hasKorean(text) {

        return KOREAN.test(
            text
        );
    }


    // =========================================================
    // 본문 ID 생성
    // =========================================================

    let idCounter = 0;


    function makeId() {

        idCounter++;


        return (
            'korjp_' +
            Date.now() +
            '_' +
            idCounter +
            '_' +
            Math.random()
                .toString(36)
                .slice(2, 8)
        );
    }


    // =========================================================
    // 원문 ID 확보
    // =========================================================

    function ensureSourceId(p) {

        if (
            !p.dataset.korjpSourceId
        ) {

            p.dataset.korjpSourceId =
                makeId();
        }


        return p.dataset.korjpSourceId;
    }


    // =========================================================
    // 해당 원문의 일본어 번역 찾기
    // =========================================================

    function findTranslation(
        editor,
        sourceId
    ) {

        return editor.querySelector(
            `p[data-korjp-translation-for="${CSS.escape(sourceId)}"]`
        );
    }


    // =========================================================
    // 본문 한 문장 번역
    // =========================================================

    async function translateParagraph(
        editor,
        p
    ) {

        if (
            !p ||
            !p.isConnected
        ) {

            return;
        }


        /*
         * 자동 생성 일본어는 번역하지 않음
         */
        if (
            p.dataset.korjpTranslation ===
            '1'
        ) {

            return;
        }


        const text =
            getText(
                p
            );


        /*
         * 빈 문단
         */
        if (!text) {
            return;
        }


        /*
         * 한국어가 없으면 번역하지 않음
         */
        if (
            !hasKorean(text)
        ) {

            return;
        }


        /*
         * 원문 ID
         */
        const sourceId =
            ensureSourceId(
                p
            );


        /*
         * 기존 번역 찾기
         */
        let translation =
            findTranslation(
                editor,
                sourceId
            );


        /*
         * 기존 번역이 있고
         * 원문도 그대로라면 끝
         */
        if (
            translation &&
            translation.dataset.korjpSource ===
                text
        ) {

            return;
        }


        /*
         * 수정된 원문이면
         * 기존 번역 삭제
         */
        if (
            translation
        ) {

            translation.remove();

            translation =
                null;
        }


        if (
            !ensureApiKey()
        ) {

            return;
        }


        console.log(
            '[한→일] 본문 번역 요청:',
            text
        );


        const japanese =
            await translate(
                text
            );


        /*
         * API 요청 중 원문이 삭제됐으면
         * 결과를 넣지 않음
         */
        if (
            !p.isConnected
        ) {

            return;
        }


        /*
         * API 요청 중 원문이 수정됐으면
         * 결과를 넣지 않음
         */
        const currentText =
            getText(
                p
            );


        if (
            currentText !==
            text
        ) {

            console.log(
                '[한→일] 번역 중 원문 변경 → 적용 안 함'
            );

            return;
        }


        /*
         * 혹시 다른 경로에서 이미 생성됐는지 확인
         */
        const existing =
            findTranslation(
                editor,
                sourceId
            );


        if (
            existing
        ) {

            return;
        }


        // =====================================================
        // 일본어 문단 생성
        // =====================================================

        const jp =
            document.createElement(
                'p'
            );


        jp.textContent =
            japanese;


        /*
         * 자동 번역문 표시
         */
        jp.dataset.korjpTranslation =
            '1';


        /*
         * 어떤 원문에 대응하는지 기록
         */
        jp.dataset.korjpTranslationFor =
            sourceId;


        /*
         * 어떤 원문으로 번역했는지 기록
         */
        jp.dataset.korjpSource =
            text;


        /*
         * 원문 바로 뒤에 삽입
         */
        p.after(
            jp
        );


        console.log(
            '[한→일] 본문 번역 완료:',
            text,
            '→',
            japanese
        );
    }


    // =========================================================
    // Enter 처리
    // =========================================================

    function connectEnter(
        editor
    ) {

        editor.addEventListener(
            'keydown',
            event => {

                /*
                 * Enter만 처리
                 *
                 * Shift+Enter는 일반 줄바꿈으로 둠
                 */
                if (
                    event.key !==
                    'Enter' ||
                    event.shiftKey
                ) {

                    return;
                }


                /*
                 * 현재 커서가 있는 p 찾기
                 */
                const selection =
                    window.getSelection();


                if (
                    !selection ||
                    !selection.rangeCount
                ) {

                    return;
                }


                let node =
                    selection.anchorNode;


                if (
                    node &&
                    node.nodeType ===
                    Node.TEXT_NODE
                ) {

                    node =
                        node.parentElement;
                }


                const p =
                    node?.closest?.(
                        'p'
                    );


                if (
                    !p ||
                    !editor.contains(p)
                ) {

                    return;
                }


                /*
                 * 빈 문단이면 그냥 기본 Enter
                 */
                const text =
                    getText(
                        p
                    );


                if (
                    !text
                ) {

                    return;
                }


                /*
                 * 우리가 직접 Enter를 처리
                 */
                event.preventDefault();


                /*
                 * 새 문단을 먼저 만들어 놓음
                 */
                const newP =
                    document.createElement(
                        'p'
                    );


                newP.innerHTML =
                    '<br>';


                /*
                 * 새 문단의 ID는 나중에 생성
                 */
                p.after(
                    newP
                );


                /*
                 * 새 문단에 커서 이동
                 */
                const range =
                    document.createRange();


                range.selectNodeContents(
                    newP
                );


                range.collapse(
                    true
                );


                selection.removeAllRanges();

                selection.addRange(
                    range
                );


                /*
                 * 방금 끝낸 문장을
                 * 비동기로 번역
                 *
                 * 새 문단 입력은 즉시 가능
                 */
                translateParagraph(
                    editor,
                    p
                );
            },
            true
        );
    }


    // =========================================================
    // 본문 blur 처리
    // =========================================================

    function connectBlur(
        editor
    ) {

        editor.addEventListener(
            'blur',
            event => {

                /*
                 * blur된 요소에서 현재 p 찾기
                 */
                const p =
                    event.target.closest?.(
                        'p'
                    );


                if (
                    !p ||
                    !editor.contains(p)
                ) {

                    return;
                }


                /*
                 * 500ms 뒤 번역
                 */
                setTimeout(
                    () => {

                        /*
                         * 다시 본문 안으로 들어왔다면
                         * 굳이 번역하지 않아도 됨
                         */
                        if (
                            editor.contains(
                                document.activeElement
                            )
                        ) {

                            return;
                        }


                        translateParagraph(
                            editor,
                            p
                        );

                    },
                    DELAY
                );

            },
            true
        );
    }


    // =========================================================
    // 본문 input
    // =========================================================

    function connectInput(
        editor
    ) {

        editor.addEventListener(
            'input',
            event => {

                const p =
                    event.target.closest?.(
                        'p'
                    );


                if (
                    !p ||
                    !editor.contains(p)
                ) {

                    return;
                }


                /*
                 * 입력 중에는 번역하지 않음.
                 *
                 * Enter 또는 본문 밖으로 나갔을 때
                 * 번역한다.
                 */
            },
            true
        );
    }


    // =========================================================
    // 본문 연결
    // =========================================================

    function connectBody(
        editor
    ) {

        if (
            editor.dataset.korjpConnected ===
            '1'
        ) {

            return;
        }


        editor.dataset.korjpConnected =
            '1';


        connectEnter(
            editor
        );


        connectBlur(
            editor
        );


        connectInput(
            editor
        );


        console.log(
            '[한→일] 본문 연결 완료'
        );
    }


    // =========================================================
    // 본문 찾기
    // =========================================================

    function scanBody() {

        const editors =
            document.querySelectorAll(
                BODY_SELECTOR
            );


        editors.forEach(
            connectBody
        );
    }


    // =========================================================
    // 제목 / 댓글 상태
    // =========================================================

    const normalStates =
        new WeakMap();


    function getNormalState(
        element
    ) {

        let state =
            normalStates.get(
                element
            );


        if (!state) {

            state = {

                timer:
                    null,

                running:
                    false,

                lastText:
                    ''
            };


            normalStates.set(
                element,
                state
            );
        }


        return state;
    }


    // =========================================================
    // 제목 번역
    // =========================================================

    async function translateTitle(
        input
    ) {

        const state =
            getNormalState(
                input
            );


        if (
            state.running
        ) {

            return;
        }


        const text =
            input.value.trim();


        if (
            !text ||
            !hasKorean(text)
        ) {

            return;
        }


        if (
            state.lastText ===
            text
        ) {

            return;
        }


        if (
            !ensureApiKey()
        ) {

            return;
        }


        state.running =
            true;


        try {

            const japanese =
                await translate(
                    text
                );


            /*
             * 번역 중 제목 변경 확인
             */
            if (
                input.value.trim() !==
                text
            ) {

                return;
            }


            let result =
                `${text} / ${japanese}`;


            /*
             * maxlength=256
             */
            if (
                result.length >
                256
            ) {

                const prefix =
                    `${text} / `;


                result =
                    prefix +
                    japanese.slice(
                        0,
                        Math.max(
                            0,
                            256 -
                            prefix.length
                        )
                    );
            }


            input.value =
                result;


            state.lastText =
                text;


        } catch (error) {

            console.error(
                '[한→일 제목]',
                error
            );

        } finally {

            state.running =
                false;
        }
    }


    // =========================================================
    // 댓글 번역
    // =========================================================

    async function translateReply(
        textarea
    ) {

        const state =
            getNormalState(
                textarea
            );


        if (
            state.running
        ) {

            return;
        }


        const text =
            textarea.value.trim();


        if (
            !text ||
            !hasKorean(text)
        ) {

            return;
        }


        if (
            state.lastText ===
            text
        ) {

            return;
        }


        if (
            !ensureApiKey()
        ) {

            return;
        }


        state.running =
            true;


        try {

            const japanese =
                await translate(
                    text
                );


            /*
             * 번역 중 댓글 변경 확인
             */
            if (
                textarea.value.trim() !==
                text
            ) {

                return;
            }


            textarea.value =
                text +
                '\n' +
                japanese;


            state.lastText =
                text;


        } catch (error) {

            console.error(
                '[한→일 댓글]',
                error
            );

        } finally {

            state.running =
                false;
        }
    }


    // =========================================================
    // 제목 / 댓글 input 감지
    // =========================================================

    document.addEventListener(
        'input',
        event => {

            const target =
                event.target;


            // -------------------------------------------------
            // 제목
            // -------------------------------------------------

            if (
                target instanceof
                    HTMLInputElement &&
                target.matches(
                    TITLE_SELECTOR
                )
            ) {

                const state =
                    getNormalState(
                        target
                    );


                if (
                    state.timer
                ) {

                    clearTimeout(
                        state.timer
                    );
                }


                state.timer =
                    setTimeout(
                        () => {

                            state.timer =
                                null;


                            translateTitle(
                                target
                            );

                        },
                        DELAY
                    );


                return;
            }


            // -------------------------------------------------
            // 댓글
            // -------------------------------------------------

            if (
                target instanceof
                    HTMLTextAreaElement &&
                target.matches(
                    REPLY_SELECTOR
                )
            ) {

                const state =
                    getNormalState(
                        target
                    );


                if (
                    state.timer
                ) {

                    clearTimeout(
                        state.timer
                    );
                }


                state.timer =
                    setTimeout(
                        () => {

                            state.timer =
                                null;


                            translateReply(
                                target
                            );

                        },
                        DELAY
                    );
            }

        },
        true
    );


    // =========================================================
    // 최초 실행
    // =========================================================

    scanBody();


    // =========================================================
    // 페이지에서 에디터가 나중에 생기는 경우
    // =========================================================

    const observer =
        new MutationObserver(
            () => {

                scanBody();

            }
        );


    observer.observe(
        document.body,
        {
            childList:
                true,

            subtree:
                true
        }
    );


    console.log(
        '[아카라이브 한→일] v10.0 활성화'
    );

})();