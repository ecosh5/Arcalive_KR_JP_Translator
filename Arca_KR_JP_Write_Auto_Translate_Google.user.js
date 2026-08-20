// ==UserScript==
// @name         아카라이브 한→일 작성 자동번역
// @namespace    arca.kroj.writer
// @version      12.1.0
// @description  아카라이브 제목/본문/댓글 한국어 자동 일본어 번역 - API 키 불필요
// @match        *://arca.live/*
// @grant        GM_xmlhttpRequest
// @connect      translate.googleapis.com
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const DELAY = 500;

    const BODY_SELECTOR =
        '.fr-element.fr-view[contenteditable="true"]';

    const TITLE_SELECTOR =
        '#inputTitle';

    const REPLY_SELECTOR =
        'textarea.reply-form-textarea';

    const SEPARATOR =
        ' / ';

    const KOREAN =
        /[\uac00-\ud7a3]/;


    // =========================================================
    // 공통
    // =========================================================

    function getText(element) {

        return (
            element.innerText ||
            element.textContent ||
            ''
        )
            .replace(/\u00a0/g, ' ')
            .trim();
    }


    function hasKorean(text) {

        return KOREAN.test(text);
    }


    // =========================================================
    // Google Translate
    // =========================================================

    function translate(text) {

        return new Promise((resolve, reject) => {

            const url =
                'https://translate.googleapis.com/translate_a/single' +
                '?client=gtx' +
                '&sl=ko' +
                '&tl=ja' +
                '&dt=t' +
                '&q=' +
                encodeURIComponent(text);


            GM_xmlhttpRequest({

                method: 'GET',
                url: url,
                timeout: 30000,


                onload(response) {

                    try {

                        if (
                            response.status < 200 ||
                            response.status >= 300
                        ) {

                            reject(
                                new Error(
                                    `번역 요청 오류 ${response.status}`
                                )
                            );

                            return;
                        }


                        const data =
                            JSON.parse(
                                response.responseText
                            );


                        if (
                            !Array.isArray(data) ||
                            !Array.isArray(data[0])
                        ) {

                            reject(
                                new Error(
                                    '번역 결과 형식이 올바르지 않습니다.'
                                )
                            );

                            return;
                        }


                        const result =
                            data[0]
                                .filter(
                                    item =>
                                        Array.isArray(item) &&
                                        typeof item[0] === 'string'
                                )
                                .map(
                                    item => item[0]
                                )
                                .join('');


                        if (
                            !result.trim()
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

                    } catch (error) {

                        reject(error);
                    }
                },


                onerror() {

                    reject(
                        new Error(
                            '번역 서버에 연결할 수 없습니다.'
                        )
                    );
                },


                ontimeout() {

                    reject(
                        new Error(
                            '번역 요청이 시간 초과되었습니다.'
                        )
                    );
                }

            });
        });
    }


    // =========================================================
    // 본문 ID
    // =========================================================

    let idCounter = 0;


    function makeId() {

        idCounter++;


        return (
            'kroj_' +
            Date.now() +
            '_' +
            idCounter +
            '_' +
            Math.random()
                .toString(36)
                .slice(2, 8)
        );
    }


    function ensureSourceId(p) {

        if (
            !p.dataset.krojSourceId
        ) {

            p.dataset.krojSourceId =
                makeId();
        }


        return p.dataset.krojSourceId;
    }


    function findTranslation(
        editor,
        sourceId
    ) {

        return editor.querySelector(
            `p[data-kroj-translation-for="${CSS.escape(sourceId)}"]`
        );
    }


    // =========================================================
    // 본문 번역
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


        if (
            p.dataset.krojTranslation === '1'
        ) {

            return;
        }


        const text =
            getText(p);


        if (!text) {

            return;
        }


        if (
            !hasKorean(text)
        ) {

            return;
        }


        const sourceId =
            ensureSourceId(p);


        let translation =
            findTranslation(
                editor,
                sourceId
            );


        if (
            translation &&
            translation.dataset.krojSource === text
        ) {

            return;
        }


        if (translation) {

            translation.remove();

            translation = null;
        }


        console.log(
            '[한→일] 본문 번역 요청:',
            text
        );


        try {

            const japanese =
                await translate(text);


            if (
                !p.isConnected
            ) {

                return;
            }


            const currentText =
                getText(p);


            if (
                currentText !== text
            ) {

                console.log(
                    '[한→일] 번역 중 원문 변경 → 적용 안 함'
                );

                return;
            }


            const existing =
                findTranslation(
                    editor,
                    sourceId
                );


            if (existing) {

                return;
            }


            const jp =
                document.createElement(
                    'p'
                );


            jp.textContent =
                japanese;


            jp.dataset.krojTranslation =
                '1';


            jp.dataset.krojTranslationFor =
                sourceId;


            jp.dataset.krojSource =
                text;


            p.after(jp);


            console.log(
                '[한→일] 본문 번역 완료:',
                text,
                '→',
                japanese
            );


        } catch (error) {

            console.error(
                '[한→일] 본문 번역 실패:',
                error
            );
        }
    }


    // =========================================================
    // 본문 Enter
    // =========================================================

    function connectEnter(editor) {

        editor.addEventListener(
            'keydown',
            event => {

                if (
                    event.key !== 'Enter' ||
                    event.shiftKey
                ) {

                    return;
                }


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
                    node.nodeType === Node.TEXT_NODE
                ) {

                    node =
                        node.parentElement;
                }


                const p =
                    node?.closest?.('p');


                if (
                    !p ||
                    !editor.contains(p)
                ) {

                    return;
                }


                const text =
                    getText(p);


                if (!text) {

                    return;
                }


                event.preventDefault();


                const newP =
                    document.createElement(
                        'p'
                    );


                newP.innerHTML =
                    '<br>';


                p.after(newP);


                const range =
                    document.createRange();


                range.selectNodeContents(
                    newP
                );


                range.collapse(true);


                selection.removeAllRanges();

                selection.addRange(range);


                translateParagraph(
                    editor,
                    p
                );

            },
            true
        );
    }


    // =========================================================
    // 본문 Blur
    // =========================================================

    function connectBlur(editor) {

        editor.addEventListener(
            'blur',
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


                setTimeout(
                    () => {

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
    // 본문 Input
    // =========================================================

    function connectInput(editor) {

        editor.addEventListener(
            'input',
            () => {

                // 입력 중에는 번역하지 않음.
                // Enter / blur에서 처리.

            },
            true
        );
    }


    // =========================================================
    // 본문 연결
    // =========================================================

    function connectBody(editor) {

        if (
            editor.dataset.krojConnected === '1'
        ) {

            return;
        }


        editor.dataset.krojConnected =
            '1';


        connectEnter(editor);

        connectBlur(editor);

        connectInput(editor);


        console.log(
            '[한→일] 본문 연결 완료'
        );
    }


    function scanBody() {

        document
            .querySelectorAll(
                BODY_SELECTOR
            )
            .forEach(
                connectBody
            );
    }


    // =========================================================
    // 제목 / 댓글 상태
    // =========================================================

    const normalStates =
        new WeakMap();


    function getNormalState(element) {

        let state =
            normalStates.get(element);


        if (!state) {

            state = {

                timer: null,

                running: false,

                original: '',

                translation: '',

                internal: false

            };


            normalStates.set(
                element,
                state
            );
        }


        return state;
    }


    // =========================================================
    // 제목 / 댓글 번역문 제거
    // =========================================================

    function removeInlineTranslation(
        element
    ) {

        const state =
            getNormalState(element);


        if (
            !state.original ||
            !state.translation
        ) {

            return element.value;
        }


        const current =
            element.value;


        // -----------------------------------------------------
        // 댓글
        //
        // 원문
        // 번역문
        // -----------------------------------------------------

        if (
            element instanceof HTMLTextAreaElement
        ) {

            const suffix =
                '\n' +
                state.translation;


            if (
                current.endsWith(
                    suffix
                )
            ) {

                return current.slice(
                    0,
                    -suffix.length
                );
            }
        }


        // -----------------------------------------------------
        // 제목
        //
        // 원문 / 번역문
        // -----------------------------------------------------

        const suffix =
            SEPARATOR +
            state.translation;


        if (
            current.endsWith(
                suffix
            )
        ) {

            return current.slice(
                0,
                -suffix.length
            );
        }


        // -----------------------------------------------------
        // 예외적인 경우
        // -----------------------------------------------------

        const index =
            current.lastIndexOf(
                state.translation
            );


        if (
            index >= 0
        ) {

            let before =
                current.slice(
                    0,
                    index
                );


            if (
                element instanceof HTMLTextAreaElement
            ) {

                if (
                    before.endsWith('\n')
                ) {

                    before =
                        before.slice(
                            0,
                            -1
                        );
                }

            } else {

                if (
                    before.endsWith(
                        SEPARATOR
                    )
                ) {

                    before =
                        before.slice(
                            0,
                            -SEPARATOR.length
                        );
                }
            }


            const after =
                current.slice(
                    index +
                    state.translation.length
                );


            return (
                before +
                after
            );
        }


        return current;
    }


    // =========================================================
    // 제목 번역
    // =========================================================

    async function translateTitle(
        input
    ) {

        const state =
            getNormalState(input);


        if (
            state.running
        ) {

            return;
        }


        let text =
            input.value;


        // 기존 번역 제거

        if (
            state.original &&
            state.translation
        ) {

            text =
                removeInlineTranslation(
                    input
                );
        }


        const trimmed =
            text.trim();


        if (
            !trimmed ||
            !hasKorean(trimmed)
        ) {

            return;
        }


        state.original =
            trimmed;


        state.running =
            true;


        try {

            const japanese =
                await translate(
                    trimmed
                );


            const current =
                state.translation
                    ? removeInlineTranslation(input).trim()
                    : input.value.trim();


            if (
                current !== trimmed
            ) {

                return;
            }


            let result =
                trimmed +
                SEPARATOR +
                japanese;


            // 제목 maxlength 대응

            if (
                result.length > 256
            ) {

                const prefix =
                    trimmed +
                    SEPARATOR;


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


            state.translation =
                japanese;


            state.internal =
                true;


            try {

                input.value =
                    result;


                /*
                 * 커서는 원문 끝.
                 */

                const position =
                    trimmed.length;


                input.setSelectionRange(
                    position,
                    position
                );

            } finally {

                state.internal =
                    false;
            }


            console.log(
                '[한→일 제목]',
                trimmed,
                '→',
                japanese
            );


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
            getNormalState(textarea);


        if (
            state.running
        ) {

            return;
        }


        let text =
            textarea.value;


        // 기존 일본어 번역 제거

        if (
            state.original &&
            state.translation
        ) {

            text =
                removeInlineTranslation(
                    textarea
                );
        }


        const trimmed =
            text.trim();


        if (
            !trimmed ||
            !hasKorean(trimmed)
        ) {

            return;
        }


        state.original =
            trimmed;


        state.running =
            true;


        try {

            const japanese =
                await translate(
                    trimmed
                );


            const current =
                state.translation
                    ? removeInlineTranslation(textarea).trim()
                    : textarea.value.trim();


            if (
                current !== trimmed
            ) {

                return;
            }


            state.translation =
                japanese;


            /*
             * ★ 댓글은 구분자 없이 줄바꿈
             *
             * 한국어
             * 日本語
             */

            const result =
                trimmed +
                '\n' +
                japanese;


            state.internal =
                true;


            try {

                textarea.value =
                    result;


                /*
                 * 커서는 한국어 원문 끝.
                 */

                const position =
                    trimmed.length;


                textarea.setSelectionRange(
                    position,
                    position
                );

            } finally {

                state.internal =
                    false;
            }


            console.log(
                '[한→일 댓글]',
                trimmed,
                '→',
                japanese
            );


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
    // 제목 / 댓글 Input
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
                target instanceof HTMLInputElement &&
                target.matches(
                    TITLE_SELECTOR
                )
            ) {

                const state =
                    getNormalState(target);


                if (
                    state.internal
                ) {

                    return;
                }


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
                target instanceof HTMLTextAreaElement &&
                target.matches(
                    REPLY_SELECTOR
                )
            ) {

                const state =
                    getNormalState(target);


                if (
                    state.internal
                ) {

                    return;
                }


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
    // 시작
    // =========================================================

    scanBody();


    const observer =
        new MutationObserver(
            () => {

                scanBody();

            }
        );


    observer.observe(
        document.body,
        {
            childList: true,
            subtree: true
        }
    );


    console.log(
        '[아카라이브 한→일] v12.1 활성화'
    );

})();
