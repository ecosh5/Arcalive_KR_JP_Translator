// ==UserScript==
// @name         아카라이브 한→일 작성 자동번역 (API 키 불필요)
// @namespace    arca.kroj.writer
// @version      11.0.0
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

    // 한국어 판별
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
    // 한국어 → 일본어
    // API KEY 필요 없음
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

                        if (!result.trim()) {
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
                            '번역 요청 시간이 초과되었습니다.'
                        )
                    );
                }
            });
        });
    }

    // =========================================================
    // ID
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

        if (!p.dataset.krojSourceId) {
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

        // 자동 생성된 일본어 문장은 번역하지 않음
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

        // 한국어가 없는 문장은 번역하지 않음
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

            // 번역하는 동안 원문이 수정되었으면 적용하지 않음
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

            // 다른 번역이 이미 생성됐는지 확인
            const existing =
                findTranslation(
                    editor,
                    sourceId
                );

            if (existing) {
                return;
            }

            // =================================================
            // 일본어 문단 생성
            // =================================================

            const jp =
                document.createElement('p');

            jp.textContent =
                japanese;

            jp.dataset.krojTranslation =
                '1';

            jp.dataset.krojTranslationFor =
                sourceId;

            jp.dataset.krojSource =
                text;

            // 원문 바로 뒤
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
    // Enter
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

                // 새 문단
                const newP =
                    document.createElement('p');

                newP.innerHTML =
                    '<br>';

                p.after(newP);

                // 새 문단으로 커서 이동
                const range =
                    document.createRange();

                range.selectNodeContents(
                    newP
                );

                range.collapse(true);

                selection.removeAllRanges();

                selection.addRange(range);

                // 방금 입력한 문장 번역
                translateParagraph(
                    editor,
                    p
                );
            },
            true
        );
    }

    // =========================================================
    // Blur
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

                        // 다시 본문으로 들어온 경우 무시
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
    // Input
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
                lastText: ''
            };

            normalStates.set(
                element,
                state
            );
        }

        return state;
    }

    // =========================================================
    // 제목
    // =========================================================

    async function translateTitle(input) {

        const state =
            getNormalState(input);

        if (state.running) {
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
            state.lastText === text
        ) {
            return;
        }

        state.running =
            true;

        try {

            const japanese =
                await translate(text);

            if (
                input.value.trim() !== text
            ) {
                return;
            }

            let result =
                `${text} / ${japanese}`;

            if (
                result.length > 256
            ) {

                const prefix =
                    `${text} / `;

                result =
                    prefix +
                    japanese.slice(
                        0,
                        Math.max(
                            0,
                            256 - prefix.length
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
    // 댓글
    // =========================================================

    async function translateReply(textarea) {

        const state =
            getNormalState(textarea);

        if (state.running) {
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
            state.lastText === text
        ) {
            return;
        }

        state.running =
            true;

        try {

            const japanese =
                await translate(text);

            if (
                textarea.value.trim() !== text
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
    // 제목 / 댓글 감지
    // =========================================================

    document.addEventListener(
        'input',
        event => {

            const target =
                event.target;

            // 제목
            if (
                target instanceof HTMLInputElement &&
                target.matches(TITLE_SELECTOR)
            ) {

                const state =
                    getNormalState(target);

                if (state.timer) {
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

            // 댓글
            if (
                target instanceof HTMLTextAreaElement &&
                target.matches(REPLY_SELECTOR)
            ) {

                const state =
                    getNormalState(target);

                if (state.timer) {
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
        '[아카라이브 한→일] v11.0 API 키 불필요 버전 활성화'
    );

})();