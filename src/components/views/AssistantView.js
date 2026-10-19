import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { PROFILE_NAMES } from './profiles.js';

export class AssistantView extends LitElement {
    static styles = css`
        :host {
            height: 100%;
            display: flex;
            flex-direction: column;
        }

        * {
            font-family: var(--font);
            cursor: default;
        }

        /* ── Response area ── */

        .transcript-wrap {
            position: relative;
            flex: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
        }

        .response-container {
            flex: 1;
            overflow-y: auto;
            font-size: var(--response-font-size, 15px);
            line-height: var(--line-height);
            background: var(--bg-app);
            padding: var(--space-sm) var(--space-md);
            scroll-behavior: auto;
            user-select: text;
            cursor: text;
            color: var(--text-primary);
            display: flex;
            flex-direction: column;
            gap: var(--space-md);
            /* room under the last card for the Analyze Screen button */
            padding-bottom: 56px;
        }

        .answer-card {
            flex-shrink: 0;
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            background: var(--bg-surface);
            padding: var(--space-sm) var(--space-md);
        }

        .answer-card.focused {
            border-color: var(--border-strong);
        }

        /* A card with code shows the explanation on the left and the code on the right, each scrolling on its own */
        .answer-body.split {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
            gap: var(--space-md);
        }

        .answer-body.split > .answer-col {
            max-height: 70vh;
            overflow-y: auto;
            min-width: 0;
        }

        .answer-body.split > .answer-col.code pre:first-child {
            margin-top: 0;
        }

        .answer-body.split > .answer-col.code pre code {
            font-size: 0.75em;
        }

        /* A narrow overlay stacks the explanation above the code, and the card scrolls as one */
        @media (max-width: 760px) {
            .answer-body.split {
                grid-template-columns: minmax(0, 1fr);
            }
            .answer-body.split > .answer-col {
                max-height: none;
                overflow-y: visible;
            }
        }

        .answer-label {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            font-family: var(--font-mono);
            margin-bottom: var(--space-xs);
            user-select: none;
            cursor: default;
        }

        .placeholder {
            color: var(--text-primary);
            padding: var(--space-sm) 0;
        }

        .jump-latest {
            position: absolute;
            right: calc(var(--space-md) + 48px);
            bottom: var(--space-md);
            z-index: 2;
            border: 1px solid var(--border);
            background: var(--bg-elevated);
            color: var(--text-primary);
            border-radius: 100px;
            padding: var(--space-xs) var(--space-md);
            font-size: var(--font-size-xs);
            font-family: var(--font);
            cursor: pointer;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
        }

        .jump-latest:hover {
            border-color: var(--accent);
        }

        .jump-latest[hidden] {
            display: none;
        }

        .response-container * {
            user-select: text;
            cursor: text;
        }

        .response-container a {
            cursor: pointer;
        }

        .response-container [data-word] {
            display: inline-block;
        }

        /* ── Markdown ── */

        .response-container h1,
        .response-container h2,
        .response-container h3,
        .response-container h4,
        .response-container h5,
        .response-container h6 {
            margin: 1em 0 0.5em 0;
            color: var(--text-primary);
            font-weight: var(--font-weight-semibold);
        }

        .response-container h1 {
            font-size: 1.5em;
        }
        .response-container h2 {
            font-size: 1.3em;
        }
        .response-container h3 {
            font-size: 1.15em;
        }
        .response-container h4 {
            font-size: 1.05em;
        }
        .response-container h5,
        .response-container h6 {
            font-size: 1em;
        }

        .response-container p {
            margin: 0.6em 0;
            color: var(--text-primary);
        }

        .response-container ul,
        .response-container ol {
            margin: 0.6em 0;
            padding-left: 1.5em;
            color: var(--text-primary);
        }

        .response-container li {
            margin: 0.3em 0;
        }

        .response-container blockquote {
            margin: 0.8em 0;
            padding: 0.5em 1em;
            border-left: 2px solid var(--border-strong);
            background: var(--bg-surface);
            border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
        }

        .response-container code {
            background: var(--bg-elevated);
            padding: 0.15em 0.4em;
            border-radius: var(--radius-sm);
            font-family: var(--font-mono);
            font-size: 0.85em;
        }

        .response-container pre {
            /* Fixed dark editor background so the token colours below stay readable in every theme */
            background: #1e1e1e;
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: var(--space-md);
            overflow-x: auto;
            margin: 0.8em 0;
        }

        .response-container pre code {
            display: block;
            background: none;
            padding: 0;
            font-size: 0.85em;
            line-height: 1.55;
            white-space: pre;
            tab-size: 4;
            color: #d4d4d4;
        }

        /* Section labels such as **Question**: / **Answer**: / **Why**: start their own paragraph */
        .answer-body p > strong:first-child {
            color: var(--accent);
            font-size: 0.75em;
            letter-spacing: 0.06em;
            text-transform: uppercase;
        }

        /* highlight.js tokens (the global theme does not reach this shadow root) */
        .response-container .hljs-keyword,
        .response-container .hljs-literal,
        .response-container .hljs-symbol {
            color: #569cd6;
        }
        .response-container .hljs-built_in,
        .response-container .hljs-type,
        .response-container .hljs-title.class_ {
            color: #4ec9b0;
        }
        .response-container .hljs-title,
        .response-container .hljs-title.function_ {
            color: #dcdcaa;
        }
        .response-container .hljs-string,
        .response-container .hljs-regexp {
            color: #ce9178;
        }
        .response-container .hljs-number {
            color: #b5cea8;
        }
        .response-container .hljs-comment,
        .response-container .hljs-quote {
            color: #6a9955;
            font-style: italic;
        }
        .response-container .hljs-variable,
        .response-container .hljs-params,
        .response-container .hljs-attr,
        .response-container .hljs-property {
            color: #9cdcfe;
        }
        .response-container .hljs-meta,
        .response-container .hljs-doctag {
            color: #c586c0;
        }

        .response-container a {
            color: var(--accent);
            text-decoration: underline;
            text-underline-offset: 2px;
        }

        .response-container strong,
        .response-container b {
            font-weight: var(--font-weight-semibold);
        }

        .response-container hr {
            border: none;
            border-top: 1px solid var(--border);
            margin: 1.5em 0;
        }

        .response-container table {
            border-collapse: collapse;
            width: 100%;
            margin: 0.8em 0;
        }

        .response-container th,
        .response-container td {
            border: 1px solid var(--border);
            padding: var(--space-sm);
            text-align: left;
        }

        .response-container th {
            background: var(--bg-surface);
            font-weight: var(--font-weight-semibold);
        }

        .response-container::-webkit-scrollbar {
            width: 6px;
        }

        .response-container::-webkit-scrollbar-track {
            background: transparent;
        }

        .response-container::-webkit-scrollbar-thumb {
            background: var(--border-strong);
            border-radius: 3px;
        }

        .response-container::-webkit-scrollbar-thumb:hover {
            background: #444444;
        }

        /* ── Bottom input bar ── */

        .input-bar {
            display: flex;
            align-items: center;
            gap: var(--space-sm);
            padding: var(--space-md);
            background: var(--bg-app);
        }

        .input-bar-inner {
            display: flex;
            align-items: center;
            flex: 1;
            background: var(--bg-elevated);
            border: 1px solid var(--border);
            border-radius: 100px;
            padding: 0 var(--space-md);
            height: 32px;
            transition: border-color var(--transition);
        }

        .input-bar-inner:focus-within {
            border-color: var(--accent);
        }

        .input-bar-inner input {
            flex: 1;
            background: none;
            color: var(--text-primary);
            border: none;
            padding: 0;
            font-size: var(--font-size-sm);
            font-family: var(--font);
            height: 100%;
            outline: none;
        }

        .input-bar-inner input::placeholder {
            color: var(--text-muted);
        }

        /* Always on screen at the bottom right, over the answers */
        .analyze-btn {
            position: absolute;
            right: var(--space-md);
            bottom: var(--space-md);
            z-index: 3;
            background: var(--bg-elevated);
            border: 1px solid var(--border);
            color: var(--text-primary);
            cursor: pointer;
            padding: 0;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition:
                border-color 0.4s ease,
                background var(--transition);
            flex-shrink: 0;
            overflow: hidden;
        }

        .analyze-btn:hover:not(.analyzing) {
            border-color: var(--accent);
            background: var(--bg-surface);
        }

        .analyze-btn.analyzing {
            cursor: default;
            border-color: transparent;
        }

        .analyze-btn-content {
            display: flex;
            align-items: center;
            gap: 4px;
            transition: opacity 0.4s ease;
            z-index: 1;
            position: relative;
        }

        .analyze-btn.analyzing .analyze-btn-content {
            opacity: 0;
        }

        .analyze-canvas {
            position: absolute;
            inset: -1px;
            width: calc(100% + 2px);
            height: calc(100% + 2px);
            pointer-events: none;
        }
    `;

    static properties = {
        responses: { type: Array },
        labels: { type: Array },
        screen: { type: String },
        currentResponseIndex: { type: Number },
        selectedProfile: { type: String },
        onSendText: { type: Function },
        shouldAnimateResponse: { type: Boolean },
        isAnalyzing: { type: Boolean, state: true },
        // The message box stays hidden until the user types into the overlay.
        _inputOpen: { type: Boolean, state: true },
        _showJumpToLatest: { type: Boolean, state: true },
    };

    constructor() {
        super();
        // The cards of the screen on show ('main' or 'side'); the app root picks them.
        this.responses = [];
        this.labels = [];
        this.screen = 'main';
        this.currentResponseIndex = -1;
        this.selectedProfile = 'interview';
        this.onSendText = () => {};
        this._inputOpen = false;
        this.isAnalyzing = false;
        this._animFrame = null;
        this._showJumpToLatest = false;
        this._cardCount = 0;
        this._latestObserver = null;
        this._analyzeTimeout = null;
        this._renderedContent = new WeakMap();
        this._markdownCache = new Map();
        this._visibleStart = -1;
        this._visibleEnd = -1;
        // Each screen keeps its own scroll position, so switching back returns to the same line.
        this._renderedScreen = null;
        this._scrollTops = { main: 0, side: 0 };
        // The new card being kept at the top of the view while it streams in, or -1.
        this._pinnedCard = -1;
    }

    getProfileNames() {
        return PROFILE_NAMES;
    }

    getPlaceholderText() {
        if (this.screen === 'side') return 'Answers to follow-up questions show up here.';
        if (this.selectedProfile === 'devops') {
            const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
            const [screen, paste, incident] = isMac ? ['⌘↵', '⌘⌥0', '⌘⌥7'] : ['Ctrl+Enter', 'Alt+Shift+0', 'Alt+Shift+7'];
            return `Listening to your DevOps round... ${screen} sends the screen, ${paste} sends copied logs, ${incident} starts a new incident.`;
        }
        const profileNames = this.getProfileNames();
        return `Listening to your ${profileNames[this.selectedProfile] || 'session'}...`;
    }

    renderMarkdown(content) {
        const { escapeHtml, safeMarkdownRenderer } = window.require('./utils/answerFormatting');
        if (typeof window !== 'undefined' && window.marked) {
            try {
                this._markdownRenderer ||= safeMarkdownRenderer(window.marked);
                window.marked.setOptions({
                    breaks: true,
                    gfm: true,
                    sanitize: false,
                    renderer: this._markdownRenderer,
                    langPrefix: 'hljs language-',
                    highlight: (code, lang) => {
                        const hljs = window.hljs;
                        if (!hljs) return code;
                        try {
                            return lang && hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang }).value : hljs.highlightAuto(code).value;
                        } catch (_) {
                            return code;
                        }
                    },
                });
                if (this._markdownCache.has(content)) return this._markdownCache.get(content);
                const rendered = window.marked.parse(content);
                this._markdownCache.set(content, rendered);
                if (this._markdownCache.size > 100) this._markdownCache.delete(this._markdownCache.keys().next().value);
                return rendered;
            } catch (error) {
                console.warn('Error parsing markdown:', error);
                return escapeHtml(content);
            }
        }
        return escapeHtml(content);
    }

    wrapWordsInSpans(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const tagsToSkip = ['PRE'];

        function wrap(node) {
            if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() && !tagsToSkip.includes(node.parentNode.tagName)) {
                const words = node.textContent.split(/(\s+)/);
                const frag = document.createDocumentFragment();
                words.forEach(word => {
                    if (word.trim()) {
                        const span = document.createElement('span');
                        span.setAttribute('data-word', '');
                        span.textContent = word;
                        frag.appendChild(span);
                    } else {
                        frag.appendChild(document.createTextNode(word));
                    }
                });
                node.parentNode.replaceChild(frag, node);
            } else if (node.nodeType === Node.ELEMENT_NODE && !tagsToSkip.includes(node.tagName)) {
                Array.from(node.childNodes).forEach(wrap);
            }
        }
        Array.from(doc.body.childNodes).forEach(wrap);
        return doc.body.innerHTML;
    }

    _emitFocusedIndex(index) {
        this._pinnedCard = -1;
        this.currentResponseIndex = index;
        this.dispatchEvent(
            new CustomEvent('response-index-changed', {
                detail: { index: this.currentResponseIndex },
            })
        );
        this._updateFocusedCard();
        this.requestUpdate();
    }

    navigateToPreviousResponse() {
        if (this.responses.length === 0) return;
        const nextIndex = this.currentResponseIndex > 0 ? this.currentResponseIndex - 1 : this.currentResponseIndex === -1 ? 0 : -1;
        if (nextIndex < 0) return;
        this._emitFocusedIndex(nextIndex);
        this._scrollCardIntoView(nextIndex);
    }

    navigateToNextResponse() {
        if (this.responses.length === 0) return;
        if (this.currentResponseIndex >= this.responses.length - 1) return;
        const nextIndex = this.currentResponseIndex < 0 ? 0 : this.currentResponseIndex + 1;
        this._emitFocusedIndex(nextIndex);
        this._scrollCardIntoView(nextIndex);
    }

    _scrollCardIntoView(index) {
        const card = this.shadowRoot?.querySelector(`[data-answer-index="${index}"]`);
        if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    // Puts the first line of a new answer at the top, so reading starts at its beginning. A new answer is
    // too short to scroll that far at first, so the view follows it until its top reaches the top.
    revealCard(index) {
        this._pinnedCard = index;
        this._followPinnedCard();
    }

    _followPinnedCard() {
        if (this._pinnedCard < 0) return;
        const container = this._getContainer();
        const card = container?.querySelector(`[data-answer-index="${this._pinnedCard}"]`);
        if (!card) return;
        const padding = parseFloat(getComputedStyle(container).paddingTop) || 0;
        const offset = () => card.getBoundingClientRect().top - container.getBoundingClientRect().top - padding;
        container.scrollTop += offset();
        if (Math.abs(offset()) < 2) this._pinnedCard = -1;
    }

    jumpToLatest() {
        if (this.responses.length === 0) return;
        const lastIndex = this.responses.length - 1;
        this._emitFocusedIndex(lastIndex);
        this._scrollCardIntoView(lastIndex);
    }

    scrollResponseUp() {
        this._pinnedCard = -1;
        const container = this.shadowRoot.querySelector('.response-container');
        if (container) {
            const scrollAmount = container.clientHeight * 0.3;
            container.scrollTop = Math.max(0, container.scrollTop - scrollAmount);
        }
    }

    scrollResponseDown() {
        this._pinnedCard = -1;
        const container = this.shadowRoot.querySelector('.response-container');
        if (container) {
            const scrollAmount = container.clientHeight * 0.3;
            container.scrollTop = Math.min(container.scrollHeight - container.clientHeight, container.scrollTop + scrollAmount);
        }
    }

    connectedCallback() {
        super.connectedCallback();
        this._visibilityHandler = () => {
            if (document.hidden) this._stopWaveformAnimation();
            else if (this.isAnalyzing) this._startWaveformAnimation();
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);
        window.addEventListener('keydown', this._openInputOnType);

        if (window.require) {
            const { ipcRenderer } = window.require('electron');

            this.handlePreviousResponse = () => this.navigateToPreviousResponse();
            this.handleNextResponse = () => this.navigateToNextResponse();
            this.handleScrollUp = () => this.scrollResponseUp();
            this.handleScrollDown = () => this.scrollResponseDown();

            ipcRenderer.on('navigate-previous-response', this.handlePreviousResponse);
            ipcRenderer.on('navigate-next-response', this.handleNextResponse);
            ipcRenderer.on('scroll-response-up', this.handleScrollUp);
            ipcRenderer.on('scroll-response-down', this.handleScrollDown);
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._stopWaveformAnimation();
        this._disconnectLatestObserver();
        if (this._visibilityHandler) document.removeEventListener('visibilitychange', this._visibilityHandler);
        window.removeEventListener('keydown', this._openInputOnType);
        if (this._analyzeTimeout) {
            clearTimeout(this._analyzeTimeout);
            this._analyzeTimeout = null;
        }

        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            if (this.handlePreviousResponse) ipcRenderer.removeListener('navigate-previous-response', this.handlePreviousResponse);
            if (this.handleNextResponse) ipcRenderer.removeListener('navigate-next-response', this.handleNextResponse);
            if (this.handleScrollUp) ipcRenderer.removeListener('scroll-response-up', this.handleScrollUp);
            if (this.handleScrollDown) ipcRenderer.removeListener('scroll-response-down', this.handleScrollDown);
        }
    }

    async handleSendText() {
        const textInput = this.shadowRoot.querySelector('#textInput');
        if (textInput && textInput.value.trim()) {
            const message = textInput.value.trim();
            textInput.value = '';
            this._inputOpen = false;
            await this.onSendText(message);
        }
    }

    handleTextKeydown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.handleSendText();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.target.value = '';
            this._inputOpen = false;
        }
    }

    // Typing into the overlay opens the message box with that first key already in it.
    _openInputOnType = async e => {
        if (this._inputOpen || e.isComposing) return;
        // Typing into another field, such as the meeting Context panel, stays there.
        const target = e.composedPath()[0];
        if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)) return;
        const paste = (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'v';
        const printable = e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey;
        if (!paste && !printable) return;
        if (printable) e.preventDefault();
        this._inputOpen = true;
        await this.updateComplete;
        const input = this.shadowRoot.querySelector('#textInput');
        if (!input) return;
        if (printable) input.value = e.key;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    };

    _closeEmptyInput(e) {
        if (!e.target.value.trim()) this._inputOpen = false;
    }

    async handleScreenAnswer() {
        if (this.isAnalyzing) return;
        if (!window.captureManualScreenshot) {
            return;
        }
        this.isAnalyzing = true;
        this._responseCountWhenStarted = this.responses.length;
        if (this._analyzeTimeout) {
            clearTimeout(this._analyzeTimeout);
        }
        try {
            const result = await window.captureManualScreenshot();
            if (!result?.success) {
                this.isAnalyzing = false;
                return;
            }
            this._analyzeTimeout = setTimeout(() => {
                this.isAnalyzing = false;
                this._analyzeTimeout = null;
            }, 20000);
        } catch (error) {
            console.error('Analyze Screen failed:', error);
            this.isAnalyzing = false;
        }
    }

    _startWaveformAnimation() {
        const canvas = this.shadowRoot.querySelector('.analyze-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;

        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const dangerColor = getComputedStyle(this).getPropertyValue('--danger').trim() || '#EF4444';
        const startTime = performance.now();
        const FADE_IN = 0.5; // seconds
        const PARTICLE_SPREAD = 4; // px inward from border
        const PARTICLE_COUNT = 250;

        // Pill perimeter helpers
        const w = rect.width;
        const h = rect.height;
        const r = h / 2; // pill radius = half height
        const straightLen = w - 2 * r;
        const arcLen = Math.PI * r;
        const perimeter = 2 * straightLen + 2 * arcLen;

        // Given a distance along the perimeter, return {x, y, nx, ny} (position + inward normal)
        const pointOnPerimeter = d => {
            d = ((d % perimeter) + perimeter) % perimeter;
            // Top straight: left to right
            if (d < straightLen) {
                return { x: r + d, y: 0, nx: 0, ny: 1 };
            }
            d -= straightLen;
            // Right arc
            if (d < arcLen) {
                const angle = -Math.PI / 2 + (d / arcLen) * Math.PI;
                return {
                    x: w - r + Math.cos(angle) * r,
                    y: r + Math.sin(angle) * r,
                    nx: -Math.cos(angle),
                    ny: -Math.sin(angle),
                };
            }
            d -= arcLen;
            // Bottom straight: right to left
            if (d < straightLen) {
                return { x: w - r - d, y: h, nx: 0, ny: -1 };
            }
            d -= straightLen;
            // Left arc
            const angle = Math.PI / 2 + (d / arcLen) * Math.PI;
            return {
                x: r + Math.cos(angle) * r,
                y: r + Math.sin(angle) * r,
                nx: -Math.cos(angle),
                ny: -Math.sin(angle),
            };
        };

        // Pre-seed random offsets for stable particles
        const seeds = [];
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            seeds.push({ pos: Math.random(), drift: Math.random(), depthSeed: Math.random() });
        }

        const draw = now => {
            const elapsed = (now - startTime) / 1000;
            const fade = Math.min(1, elapsed / FADE_IN);

            ctx.clearRect(0, 0, w, h);

            // ── Particle border ──
            ctx.fillStyle = dangerColor;
            for (let i = 0; i < PARTICLE_COUNT; i++) {
                const s = seeds[i];
                const along = (s.pos + s.drift * elapsed * 0.03) * perimeter;
                const depth = s.depthSeed * PARTICLE_SPREAD;
                const density = 1 - depth / PARTICLE_SPREAD;

                if (Math.random() > density) continue;

                const p = pointOnPerimeter(along);
                const px = p.x + p.nx * depth;
                const py = p.y + p.ny * depth;
                const size = 0.8 + density * 0.6;

                ctx.globalAlpha = fade * density * 0.85;
                ctx.beginPath();
                ctx.arc(px, py, size, 0, Math.PI * 2);
                ctx.fill();
            }

            // ── Waveform ──
            const midY = h / 2;
            const waves = [
                { freq: 3, amp: 0.35, speed: 2.5, opacity: 0.9, width: 1.8 },
                { freq: 5, amp: 0.2, speed: 3.5, opacity: 0.5, width: 1.2 },
                { freq: 7, amp: 0.12, speed: 5, opacity: 0.3, width: 0.8 },
            ];

            for (const wave of waves) {
                ctx.beginPath();
                ctx.strokeStyle = dangerColor;
                ctx.globalAlpha = wave.opacity * fade;
                ctx.lineWidth = wave.width;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                for (let x = 0; x <= w; x++) {
                    const norm = x / w;
                    const envelope = Math.sin(norm * Math.PI);
                    const y = midY + Math.sin(norm * Math.PI * 2 * wave.freq + elapsed * wave.speed) * (midY * wave.amp) * envelope;
                    if (x === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.stroke();
            }

            ctx.globalAlpha = 1;
            this._animFrame = requestAnimationFrame(draw);
        };

        this._animFrame = requestAnimationFrame(draw);
    }

    _stopWaveformAnimation() {
        if (this._animFrame) {
            cancelAnimationFrame(this._animFrame);
            this._animFrame = null;
        }
        const canvas = this.shadowRoot.querySelector('.analyze-canvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    firstUpdated() {
        super.firstUpdated();
        // Scrolling by hand takes over from following a new answer.
        this._getContainer()?.addEventListener('wheel', () => (this._pinnedCard = -1), { passive: true });
        this._syncTranscript();
    }

    willUpdate(changedProperties) {
        if (changedProperties.has('screen') && this._renderedScreen) {
            this._pinnedCard = -1;
            const container = this._getContainer();
            if (container) this._scrollTops[this._renderedScreen] = container.scrollTop;
        }
    }

    updated(changedProperties) {
        super.updated(changedProperties);
        if (['responses', 'labels', 'screen', 'currentResponseIndex'].some(name => changedProperties.has(name))) {
            this._syncTranscript();
        }

        if (changedProperties.has('selectedProfile') && this.responses.length === 0) {
            this._syncTranscript();
        }

        if (changedProperties.has('isAnalyzing')) {
            if (this.isAnalyzing) {
                this._startWaveformAnimation();
            } else {
                this._stopWaveformAnimation();
            }
        }

        if (changedProperties.has('responses') && this.isAnalyzing) {
            if (this.responses.length > this._responseCountWhenStarted) {
                this.isAnalyzing = false;
                if (this._analyzeTimeout) {
                    clearTimeout(this._analyzeTimeout);
                    this._analyzeTimeout = null;
                }
            }
        }
    }

    _getContainer() {
        return this.shadowRoot?.querySelector('#responseContainer');
    }

    _createCard(index) {
        const card = document.createElement('article');
        card.className = 'answer-card';
        card.dataset.answerIndex = String(index);

        const label = document.createElement('div');
        label.className = 'answer-label';

        const body = document.createElement('div');
        body.className = 'answer-body';

        card.appendChild(label);
        card.appendChild(body);
        return card;
    }

    _setCardBody(card, content, label) {
        const labelNode = card.querySelector('.answer-label');
        if (labelNode && labelNode.textContent !== label) labelNode.textContent = label;
        const body = card.querySelector('.answer-body');
        if (!body) return;
        if (this._renderedContent.get(card) === content) return;
        const { splitCodeColumn } = window.require('./utils/answerFormatting');
        const { left, right } = splitCodeColumn(content);
        body.classList.toggle('split', Boolean(right));
        body.innerHTML = right
            ? `<div class="answer-col">${this.renderMarkdown(left)}</div><div class="answer-col code">${this.renderMarkdown(right)}</div>`
            : this.renderMarkdown(content);
        this._renderedContent.set(card, content);
    }

    _updateFocusedCard() {
        const container = this._getContainer();
        if (!container) return;
        container.querySelectorAll('.answer-card').forEach(card => {
            const index = Number(card.dataset.answerIndex);
            card.classList.toggle('focused', index === this.currentResponseIndex);
        });
    }

    _disconnectLatestObserver() {
        if (this._latestObserver) {
            this._latestObserver.disconnect();
            this._latestObserver = null;
        }
    }

    _observeLatest() {
        this._disconnectLatestObserver();
        const container = this._getContainer();
        if (!container || this.responses.length === 0) {
            this._showJumpToLatest = false;
            return;
        }

        const lastCard = container.querySelector(`[data-answer-index="${this.responses.length - 1}"]`);
        if (!lastCard) {
            this._showJumpToLatest = false;
            return;
        }

        this._latestObserver = new IntersectionObserver(
            entries => {
                const entry = entries[0];
                this._showJumpToLatest = !entry.isIntersecting || entry.intersectionRatio < 0.9;
            },
            { root: container, threshold: [0, 0.9, 1] }
        );
        this._latestObserver.observe(lastCard);
    }

    _syncTranscript() {
        const container = this._getContainer();
        if (!container) return;

        const switched = this._renderedScreen !== this.screen;
        const scrollTop = switched ? this._scrollTops[this.screen] || 0 : container.scrollTop;
        this._renderedScreen = this.screen;

        if (this.responses.length === 0) {
            this._disconnectLatestObserver();
            container.innerHTML = '';
            const placeholder = document.createElement('div');
            placeholder.className = 'placeholder';
            placeholder.textContent = this.getPlaceholderText();
            container.appendChild(placeholder);
            this._cardCount = 0;
            this._visibleStart = -1;
            this._visibleEnd = -1;
            this._showJumpToLatest = false;
            container.scrollTop = scrollTop;
            return;
        }

        const { visibleAnswerRange } = window.require('./utils/visibleAnswerRange');
        const range = visibleAnswerRange(this.responses.length, this.currentResponseIndex, 30);
        const rangeChanged = range.start !== this._visibleStart || range.end !== this._visibleEnd;
        if (switched || rangeChanged || container.querySelector('.placeholder')) {
            container.innerHTML = '';
            this._cardCount = 0;
            this._visibleStart = range.start;
            this._visibleEnd = range.end;
        }

        const previousCount = this._cardCount;
        while (this._visibleStart + this._cardCount < this._visibleEnd) {
            const index = this._visibleStart + this._cardCount;
            container.appendChild(this._createCard(index));
            this._cardCount++;
        }

        for (const card of container.querySelectorAll('.answer-card')) {
            const index = Number(card.dataset.answerIndex);
            this._setCardBody(card, this.responses[index], this.labels[index] || `Answer ${index + 1}`);
        }

        this._updateFocusedCard();
        container.scrollTop = scrollTop;
        this._followPinnedCard();
        if (previousCount !== this._cardCount || !this._latestObserver) {
            this._observeLatest();
        }

        if (this.shouldAnimateResponse) {
            this.dispatchEvent(new CustomEvent('response-animation-complete', { bubbles: true, composed: true }));
        }
    }

    render() {
        return html`
            <div class="transcript-wrap">
                <div class="response-container" id="responseContainer"></div>
                <button class="jump-latest" ?hidden=${!this._showJumpToLatest} @click=${() => this.jumpToLatest()} type="button">
                    Jump to latest
                </button>
                <button
                    class="analyze-btn ${this.isAnalyzing ? 'analyzing' : ''}"
                    @click=${this.handleScreenAnswer}
                    title="Analyze Screen (⌘↵)"
                    type="button"
                >
                    <canvas class="analyze-canvas"></canvas>
                    <span class="analyze-btn-content">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24">
                            <path
                                fill="none"
                                stroke="currentColor"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M13 3v7h6l-8 11v-7H5z"
                            />
                        </svg>
                    </span>
                </button>
            </div>

            ${
                this._inputOpen
                    ? html`<div class="input-bar">
                          <div class="input-bar-inner">
                              <input
                                  type="text"
                                  id="textInput"
                                  placeholder="Type a message..."
                                  @keydown=${this.handleTextKeydown}
                                  @blur=${this._closeEmptyInput}
                              />
                          </div>
                      </div>`
                    : ''
            }
        `;
    }
}

customElements.define('assistant-view', AssistantView);
