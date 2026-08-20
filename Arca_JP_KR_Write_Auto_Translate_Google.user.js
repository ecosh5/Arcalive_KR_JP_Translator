// ==UserScript==
// @name         아카라이브 일→한 작성 자동번역
// @namespace    arca.kroj.writer.jatok
// @version      13.0.0
// @description  아카라이브 제목/본문 자동 번역 + 댓글 / 입력 시 일본어→한국어 번역
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

    const SEPARATOR = ' / ';

    const JAPANESE =
        /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;


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


    function hasJapanese(text) {
        return JAPANESE.test(text);
    }


    // =========================================================
    // Google Translate
    // 일본어 → 한국어
    // =========================================================

    function translate(text) {

        return new Promise((resolve, reject) => {

            const url =
                'https://translate.googleapis.com/translate_a/single' +
                '?client=gtx' +
                '&sl=ja' +
                '&tl=ko' +
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


        // 자동 생성된 한국어 문장은 번역하지 않음

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
            !hasJapanese(text)
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


        // 같은 원문으로 이미 번역되어 있으면 종료

        if (
            translation &&
            translation.dataset.krojSource === text
        ) {

            return;
        }


        // 원문이 수정된 경우 기존 번역 삭제

        if (translation) {

            translation.remove();

            translation = null;
        }


        console.log(
            '[일→한] 본문 번역 요청:',
            text
        );


        try {

            const korean =
                await translate(text);


            if (
                !p.isConnected
            ) {

                return;
            }


            const currentText =
                getText(p);


            // 번역 중 원문 변경

            if (
                currentText !== text
            ) {

                console.log(
                    '[일→한] 번역 중 원문 변경 → 적용 안 함'
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


            const ko =
                document.createElement('p');


            ko.textContent =
                korean;


            ko.dataset.krojTranslation =
                '1';


            ko.dataset.krojTranslationFor =
                sourceId;


            ko.dataset.krojSource =
                text;


            p.after(ko);


            console.log(
                '[일→한] 본문 번역 완료:',
                text,
                '→',
                korean
            );


        } catch (error) {

            console.error(
                '[일→한] 본문 번역 실패:',
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
                    document.createElement('p');


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
                    event.target.closest?.('p');


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
            '[일→한] 본문 연결 완료'
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

                internal: false,

                revision: 0

            };


            normalStates.set(
                element,
                state
            );
        }


        return state;
    }


    // =========================================================
    // 제목 번역문 제거
    // =========================================================

    function removeTitleTranslation(input) {

        const state =
            getNormalState(input);


        if (
            !state.original ||
            !state.translation
        ) {

            return input.value;
        }


        const suffix =
            SEPARATOR +
            state.translation;


        if (
            input.value.endsWith(suffix)
        ) {

            return input.value.slice(
                0,
                -suffix.length
            );
        }


        return input.value;
    }


    // =========================================================
    // 제목 번역
    // =========================================================

    async function translateTitle(input) {

        const state =
            getNormalState(input);


        if (
            state.running
        ) {

            return;
        }


        let text =
            input.value;


        if (
            state.original &&
            state.translation
        ) {

            text =
                removeTitleTranslation(
                    input
                );
        }


        const trimmed =
            text.trim();


        if (
            !trimmed ||
            !hasJapanese(trimmed)
        ) {

            return;
        }


        state.original =
            trimmed;


        const revision =
            ++state.revision;


        state.running =
            true;


        try {

            const korean =
                await translate(
                    trimmed
                );


            if (
                revision !==
                state.revision
            ) {

                return;
            }


            const current =
                removeTitleTranslation(
                    input
                ).trim();


            if (
                current !== trimmed
            ) {

                return;
            }


            let result =
                trimmed +
                SEPARATOR +
                korean;


            if (
                result.length > 256
            ) {

                const prefix =
                    trimmed +
                    SEPARATOR;


                result =
                    prefix +
                    korean.slice(
                        0,
                        Math.max(
                            0,
                            256 -
                            prefix.length
                        )
                    );
            }


            state.translation =
                korean;


            state.internal =
                true;


            try {

                input.value =
                    result;


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


        } catch (error) {

            console.error(
                '[일→한 제목]',
                error
            );

        } finally {

            state.running =
                false;
        }
    }


    // =========================================================
    // 댓글
    //
    // 자동 번역하지 않음.
    //
    // 일본어/
    //
    // 를 입력하면
    //
    // 일본어
    // 한국어
    //
    // 로 변경
    // =========================================================

    async function translateReplyBySlash(
        textarea
    ) {

        const state =
            getNormalState(textarea);


        if (
            state.running
        ) {

            return;
        }


        let value =
            textarea.value;


        // 반드시 마지막 문자가 / 이어야 함

        if (
            !value.endsWith('/')
        ) {

            return;
        }


        // / 제거

        const original =
            value
                .slice(
                    0,
                    -1
                )
                .trim();


        if (
            !original
        ) {

            return;
        }


        // 일본어가 없으면 무시

        if (
            !hasJapanese(original)
        ) {

            return;
        }


        /*
         * 기존 번역이 붙어 있는 상태에서
         * 다시 /를 입력한 경우:
         *
         * 일본어
         * 한국어
         * /
         *
         * 가 될 수 있으므로
         * 기존 번역을 제거한다.
         */

        let japanese =
            original;


        if (
            state.original &&
            state.translation
        ) {

            const oldSuffix =
                '\n' +
                state.translation;


            if (
                japanese.endsWith(
                    oldSuffix
                )
            ) {

                japanese =
                    japanese.slice(
                        0,
                        -oldSuffix.length
                    ).trim();
            }
        }


        /*
         * 혹시 이전 번역 상태가 없더라도
         * 마지막 줄이 한국어이고
         * 그 위에 일본어가 있는 경우
         * 마지막 줄을 번역문으로 간주하지 않음.
         *
         * 여기서는 사용자가 직접 /를 누른
         * 순간의 내용만 번역 대상으로 삼는다.
         */


        const revision =
            ++state.revision;


        state.running =
            true;


        state.original =
            japanese;


        try {

            /*
             * 번역 시작 전에 /를 제거하고
             * 현재 원문만 남긴다.
             */

            state.internal =
                true;

            try {

                textarea.value =
                    japanese;

            } finally {

                state.internal =
                    false;
            }


            const korean =
                await translate(
                    japanese
                );


            /*
             * 번역 요청 이후 사용자가
             * 다시 수정했다면 폐기
             */

            if (
                revision !==
                state.revision
            ) {

                return;
            }


            /*
             * 현재 textarea가
             * 번역 요청 당시의 일본어와
             * 정확히 같은지 확인
             */

            if (
                textarea.value.trim() !==
                japanese
            ) {

                return;
            }


            state.translation =
                korean;


            const result =
                japanese +
                '\n' +
                korean;


            state.internal =
                true;


            try {

                textarea.value =
                    result;


                /*
                 * 커서는 일본어 끝
                 */

                const position =
                    japanese.length;


                textarea.setSelectionRange(
                    position,
                    position
                );

            } finally {

                state.internal =
                    false;
            }


            console.log(
                '[일→한 댓글]',
                japanese,
                '→',
                korean
            );


        } catch (error) {

            console.error(
                '[일→한 댓글]',
                error
            );

        } finally {

            state.running =
                false;
        }
    }


    // =========================================================
    // 댓글 입력 감지
    //
    // ★ 댓글은 /가 있을 때만 실행
    // =========================================================

    document.addEventListener(
        'input',
        event => {

            const target =
                event.target;


            // =================================================
            // 제목
            // =================================================

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


            // =================================================
            // 댓글
            // =================================================

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


                /*
                 * 댓글은 자동 번역하지 않는다.
                 *
                 * 마지막에 /가 입력된 경우에만
                 * 번역을 시작한다.
                 */

                if (
                    !target.value.endsWith('/')
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


                            translateReplyBySlash(
                                target
                            );

                        },
                        100
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
        '[아카라이브 일→한] v13.0 활성화'
    );

})();
