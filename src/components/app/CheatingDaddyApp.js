import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { MainView } from '../views/MainView.js';
import { CustomizeView } from '../views/CustomizeView.js';
import { HelpView } from '../views/HelpView.js';
import { HistoryView } from '../views/HistoryView.js';
import { AssistantView } from '../views/AssistantView.js';
import { OnboardingView } from '../views/OnboardingView.js';
import { AICustomizeView } from '../views/AICustomizeView.js';
import { FeedbackView } from '../views/FeedbackView.js';

// Older cards are dropped past this many, so a long meeting doesn't keep growing the overlay.
const MAX_ANSWER_CARDS = 100;

export class CheatingDaddyApp extends LitElement {
    static styles = css`
        * {
            box-sizing: border-box;
            font-family: var(--font);
            margin: 0;
            padding: 0;
            cursor: default;
            user-select: none;
        }

        :host {
            display: block;
            width: 100%;
            height: 100vh;
            background: var(--bg-app);
            color: var(--text-primary);
        }

        :host([stealth]) {
            background: transparent;
        }

        /* ── Full app shell: top bar + sidebar/content ── */

        .app-shell {
            display: flex;
            height: 100vh;
            overflow: hidden;
        }

        /* The live overlay is resized from its edges; the top bar below them still drags it around */
        .resize-handle {
            position: fixed;
            z-index: 1000;
            -webkit-app-region: no-drag;
        }
        .resize-handle.left,
        .resize-handle.right {
            top: 36px;
            bottom: 0;
            width: 5px;
            cursor: ew-resize;
        }
        .resize-handle.left {
            left: 0;
        }
        .resize-handle.right {
            right: 0;
        }
        .resize-handle.bottom {
            left: 0;
            right: 0;
            bottom: 0;
            height: 5px;
            cursor: ns-resize;
        }
        .resize-handle.bottom-left,
        .resize-handle.bottom-right {
            bottom: 0;
            width: 12px;
            height: 12px;
        }
        .resize-handle.bottom-left {
            left: 0;
            cursor: nesw-resize;
        }
        .resize-handle.bottom-right {
            right: 0;
            cursor: nwse-resize;
        }

        .top-drag-bar {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 9999;
            display: flex;
            align-items: center;
            height: 38px;
            background: transparent;
        }

        .drag-region {
            flex: 1;
            height: 100%;
            -webkit-app-region: drag;
        }

        .top-drag-bar.hidden {
            display: none;
        }

        .traffic-lights {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 0 var(--space-md);
            height: 100%;
            -webkit-app-region: no-drag;
        }

        .traffic-light {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            border: none;
            cursor: pointer;
            padding: 0;
            transition: opacity 0.15s ease;
        }

        .traffic-light:hover {
            opacity: 0.8;
        }

        .traffic-light.close {
            background: #ff5f57;
        }

        .traffic-light.minimize {
            background: #febc2e;
        }

        .traffic-light.maximize {
            background: #28c840;
        }

        .sidebar {
            width: var(--sidebar-width);
            min-width: var(--sidebar-width);
            background: var(--bg-surface);
            border-right: 1px solid var(--border);
            display: flex;
            flex-direction: column;
            padding: 42px 0 var(--space-md) 0;
            transition:
                width var(--transition),
                min-width var(--transition),
                opacity var(--transition);
        }

        .sidebar.hidden {
            width: 0;
            min-width: 0;
            padding: 0;
            overflow: hidden;
            border-right: none;
            opacity: 0;
        }

        .app-shell.stealth-hidden,
        .fullscreen.stealth-hidden {
            visibility: hidden;
        }

        .sidebar-brand {
            padding: var(--space-sm) var(--space-lg);
            padding-top: var(--space-md);
            margin-bottom: var(--space-lg);
        }

        .sidebar-brand h1 {
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
            letter-spacing: -0.01em;
        }

        .sidebar-nav {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: var(--space-xs);
            padding: 0 var(--space-sm);
            -webkit-app-region: no-drag;
        }

        .nav-item {
            display: flex;
            align-items: center;
            gap: var(--space-sm);
            padding: var(--space-sm) var(--space-md);
            border-radius: var(--radius-md);
            color: var(--text-secondary);
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-medium);
            cursor: pointer;
            transition:
                color var(--transition),
                background var(--transition);
            border: none;
            background: none;
            width: 100%;
            text-align: left;
        }

        .nav-item:hover {
            color: var(--text-primary);
            background: var(--bg-hover);
        }

        .nav-item.active {
            color: var(--text-primary);
            background: var(--bg-elevated);
        }

        .nav-item svg {
            width: 20px;
            height: 20px;
            flex-shrink: 0;
        }

        .sidebar-footer {
            padding: var(--space-sm);
            margin-top: var(--space-sm);
            -webkit-app-region: no-drag;
        }

        .update-btn {
            display: flex;
            align-items: center;
            gap: var(--space-sm);
            width: 100%;
            padding: var(--space-sm) var(--space-md);
            border-radius: var(--radius-md);
            border: 1px solid rgba(239, 68, 68, 0.2);
            background: rgba(239, 68, 68, 0.08);
            color: var(--danger);
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-medium);
            cursor: pointer;
            text-align: left;
            transition:
                background var(--transition),
                border-color var(--transition);
            animation: update-wobble 5s ease-in-out infinite;
        }

        .update-btn:hover {
            background: rgba(239, 68, 68, 0.14);
            border-color: rgba(239, 68, 68, 0.35);
        }

        @keyframes update-wobble {
            0%,
            90%,
            100% {
                transform: rotate(0deg);
            }
            92% {
                transform: rotate(-2deg);
            }
            94% {
                transform: rotate(2deg);
            }
            96% {
                transform: rotate(-1.5deg);
            }
            98% {
                transform: rotate(1.5deg);
            }
        }

        .update-btn svg {
            width: 20px;
            height: 20px;
            flex-shrink: 0;
        }

        .version-text {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            padding: var(--space-xs) var(--space-md);
        }

        /* ── Main content area ── */

        .content {
            flex: 1;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            background: var(--bg-app);
        }

        /* Live mode top bar */
        .live-bar {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 var(--space-md);
            background: var(--bg-surface);
            border-bottom: 1px solid var(--border);
            height: 36px;
            -webkit-app-region: drag;
        }

        .live-bar-left {
            display: flex;
            align-items: center;
            -webkit-app-region: no-drag;
            z-index: 1;
        }

        .live-bar-back {
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-muted);
            cursor: pointer;
            background: none;
            border: none;
            padding: var(--space-xs);
            border-radius: var(--radius-sm);
            transition: color var(--transition);
        }

        .live-bar-back:hover {
            color: var(--text-primary);
        }

        .live-bar-back svg {
            width: 14px;
            height: 14px;
        }

        .live-bar-center {
            position: absolute;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            align-items: center;
            gap: var(--space-sm);
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            font-weight: var(--font-weight-medium);
            white-space: nowrap;
            pointer-events: none;
        }

        .live-bar-mode.coding {
            color: var(--accent);
        }

        /* Main answers and follow-up answers are two screens; the tabs show which one is open */
        .screen-tabs {
            display: flex;
            gap: 2px;
            pointer-events: auto;
            -webkit-app-region: no-drag;
        }

        .screen-tab {
            background: none;
            border: 1px solid transparent;
            border-radius: 100px;
            color: var(--text-muted);
            font: inherit;
            padding: 1px var(--space-sm);
            cursor: pointer;
        }

        .screen-tab.active {
            color: var(--text-primary);
            border-color: var(--border-strong);
            background: var(--bg-elevated);
        }

        .screen-new {
            margin-left: 4px;
            color: var(--accent);
        }

        .live-bar-right {
            display: flex;
            align-items: center;
            gap: var(--space-md);
            -webkit-app-region: no-drag;
            z-index: 1;
        }

        .live-bar-text {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            font-family: var(--font-mono);
            white-space: nowrap;
        }

        /* A narrow overlay keeps the tabs and [hide], and drops the status and the clock */
        @media (max-width: 600px) {
            .live-bar-text.optional {
                display: none;
            }
        }

        .live-bar-text.clickable {
            cursor: pointer;
            transition: color var(--transition);
        }

        .live-bar-text.clickable:hover {
            color: var(--text-primary);
        }

        /* Content inner */
        .content-inner {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
        }

        .content-inner.live {
            overflow: hidden;
            display: flex;
            flex-direction: column;
            position: relative;
        }

        /* The overlay is see-through, so the answers are hidden (still mounted) while the Context panel is open */
        .content-inner.context-open > assistant-view {
            visibility: hidden;
        }

        /* The meeting context, editable during the meeting; the answers stay mounted underneath */
        .context-panel {
            position: absolute;
            inset: 0;
            z-index: 5;
            display: flex;
            flex-direction: column;
            gap: var(--space-xs);
            padding: var(--space-sm) var(--space-md);
            background: var(--bg-app);
        }

        .context-panel textarea {
            flex: 1;
            resize: none;
            background: var(--bg-elevated);
            color: var(--text-primary);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: var(--space-sm);
            font-family: var(--font-mono);
            font-size: var(--font-size-xs);
            line-height: 1.5;
            outline: none;
        }

        .context-panel textarea:focus {
            border-color: var(--accent);
        }

        .context-help {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
        }

        /* Onboarding fills everything */
        .fullscreen {
            position: fixed;
            inset: 0;
            z-index: 100;
            background: var(--bg-app);
        }

        ::-webkit-scrollbar {
            width: 6px;
            height: 6px;
        }

        ::-webkit-scrollbar-track {
            background: transparent;
        }

        ::-webkit-scrollbar-thumb {
            background: var(--border-strong);
            border-radius: 3px;
        }

        ::-webkit-scrollbar-thumb:hover {
            background: #444444;
        }
    `;

    static properties = {
        currentView: { type: String },
        statusText: { type: String },
        startTime: { type: Number },
        isRecording: { type: Boolean },
        sessionActive: { type: Boolean },
        selectedProfile: { type: String },
        selectedLanguage: { type: String },
        responses: { type: Array },
        activeScreen: { state: true },
        codingMode: { state: true },
        _unseen: { state: true },
        selectedScreenshotInterval: { type: String },
        _contextOpen: { state: true },
        _meetingContext: { state: true },
        selectedImageQuality: { type: String },
        layoutMode: { type: String },
        _viewInstances: { type: Object, state: true },
        _isClickThrough: { state: true },
        _stealthHidden: { state: true },
        _awaitingNewResponse: { state: true },
        shouldAnimateResponse: { type: Boolean },
        _storageLoaded: { state: true },
        _updateAvailable: { state: true },
        _whisperDownloading: { state: true },
    };

    constructor() {
        super();
        this.currentView = 'main';
        this.statusText = '';
        this.startTime = null;
        this.isRecording = false;
        this.sessionActive = false;
        this.selectedProfile = 'interview';
        this.selectedLanguage = 'en-US';
        this.selectedScreenshotInterval = '5';
        this.selectedImageQuality = 'medium';
        this.layoutMode = 'normal';
        this.responses = [];
        this.activeScreen = 'main';
        this.codingMode = false;
        this._viewInstances = new Map();
        this._isClickThrough = false;
        this._stealthHidden = false;
        this._awaitingNewResponse = false;
        this._currentResponseIsComplete = true;
        this.shouldAnimateResponse = false;
        this._storageLoaded = false;
        this._timerInterval = null;
        this._updateAvailable = false;
        this._whisperDownloading = false;
        this._localVersion = '';
        this._sessionController = null;
        // Cards live in parallel arrays: text (responses), turn id, screen ('main' or 'side') and label.
        this._answerTurnIds = [];
        this._answerLanes = [];
        this._answerLabels = [];
        this._answerSequences = {};
        this._pendingAnswerEvents = new Map();
        this._answerFlushTimer = null;
        // Each screen remembers its focused card, how many new cards arrived while it was hidden, and how
        // many old cards were dropped (so card numbers stay stable).
        this._screenFocus = { main: null, side: null };
        this._unseen = { main: 0, side: 0 };
        this._trimmed = { main: 0, side: 0 };
        this._screenViewCache = null;

        this._loadFromStorage();
        this._checkForUpdates();
    }

    async _checkForUpdates() {
        try {
            this._localVersion = await cheatingDaddy.getVersion();
            this.requestUpdate();

            const res = await fetch('https://raw.githubusercontent.com/sohzm/cheating-daddy/refs/heads/master/package.json');
            if (!res.ok) return;
            const remote = await res.json();
            const remoteVersion = remote.version;

            const toNum = v => v.split('.').map(Number);
            const [rMaj, rMin, rPatch] = toNum(remoteVersion);
            const [lMaj, lMin, lPatch] = toNum(this._localVersion);

            if (rMaj > lMaj || (rMaj === lMaj && rMin > lMin) || (rMaj === lMaj && rMin === lMin && rPatch > lPatch)) {
                this._updateAvailable = true;
                this.requestUpdate();
            }
        } catch (e) {
            // silently ignore
        }
    }

    async _loadFromStorage() {
        try {
            const [config, prefs] = await Promise.all([cheatingDaddy.storage.getConfig(), cheatingDaddy.storage.getPreferences()]);

            this.currentView = config.onboarded ? 'main' : 'onboarding';
            this.selectedProfile = prefs.selectedProfile || 'interview';
            this.selectedLanguage = prefs.selectedLanguage || 'en-US';
            this.selectedScreenshotInterval = prefs.selectedScreenshotInterval || '5';
            this.selectedImageQuality = prefs.selectedImageQuality || 'medium';
            this.layoutMode = config.layout || 'normal';

            this._storageLoaded = true;
            this.requestUpdate();
        } catch (error) {
            console.error('Error loading from storage:', error);
            this._storageLoaded = true;
            this.requestUpdate();
        }
    }

    connectedCallback() {
        super.connectedCallback();

        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            this._answerEventListener = (_, event) => this.handleAnswerEvent(event);
            ipcRenderer.on('answer-event', this._answerEventListener);
            this._stopMeetingListener = () => this.handleClose();
            ipcRenderer.on('stop-meeting-requested', this._stopMeetingListener);
            ipcRenderer.on('update-status', (_, status) => this.setStatus(status));
            ipcRenderer.on('click-through-toggled', (_, isEnabled) => {
                this._isClickThrough = isEnabled;
            });
            ipcRenderer.on('reconnect-failed', (_, data) => this.addNewResponse(data.message));
            ipcRenderer.on('whisper-downloading', (_, downloading) => {
                this._whisperDownloading = downloading;
            });
            ipcRenderer.on('stealth-hidden-changed', (_, hidden) => {
                this._stealthHidden = Boolean(hidden);
                document.documentElement.classList.toggle('overlay-stealth', Boolean(hidden));
                if (hidden) {
                    this.setAttribute('stealth', '');
                } else {
                    this.removeAttribute('stealth');
                }
                this.requestUpdate();
            });
            ipcRenderer.on('coding-mode-changed', (_, data) => {
                this.codingMode = Boolean(data?.active);
            });
            ipcRenderer.on('switch-answer-screen', (_, screen) => this.switchScreen(screen));
        }

        this._optionHeld = false;
        this._optionUsedAsModifier = false;
        this._isAltEvent = event => event.key === 'Alt' || event.code === 'AltLeft' || event.code === 'AltRight';
        this._onOptionKeyDown = event => {
            if (event.repeat) return;
            if (this._isAltEvent(event)) {
                event.preventDefault();
                this._optionHeld = true;
                this._optionUsedAsModifier = event.ctrlKey || event.metaKey || event.shiftKey;
                return;
            }
            if (this._optionHeld) this._optionUsedAsModifier = true;
        };
        this._onOptionKeyUp = event => {
            if (!this._isAltEvent(event)) return;
            event.preventDefault();
            const tap = this._optionHeld && !this._optionUsedAsModifier;
            this._optionHeld = false;
            this._optionUsedAsModifier = false;
            if (tap) this.handleHideToggle();
        };
        this._onOptionMouseDown = () => {
            if (this._optionHeld) this._optionUsedAsModifier = true;
        };
        window.addEventListener('keydown', this._onOptionKeyDown, true);
        window.addEventListener('keyup', this._onOptionKeyUp, true);
        window.addEventListener('mousedown', this._onOptionMouseDown, true);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._stopTimer();
        if (this._onOptionKeyDown) {
            window.removeEventListener('keydown', this._onOptionKeyDown, true);
            window.removeEventListener('keyup', this._onOptionKeyUp, true);
            window.removeEventListener('mousedown', this._onOptionMouseDown, true);
        }
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            if (this._answerEventListener) ipcRenderer.removeListener('answer-event', this._answerEventListener);
            if (this._stopMeetingListener) ipcRenderer.removeListener('stop-meeting-requested', this._stopMeetingListener);
            ipcRenderer.removeAllListeners('update-status');
            ipcRenderer.removeAllListeners('click-through-toggled');
            ipcRenderer.removeAllListeners('reconnect-failed');
            ipcRenderer.removeAllListeners('whisper-downloading');
            ipcRenderer.removeAllListeners('stealth-hidden-changed');
            ipcRenderer.removeAllListeners('coding-mode-changed');
            ipcRenderer.removeAllListeners('switch-answer-screen');
        }
        if (this._answerFlushTimer) clearTimeout(this._answerFlushTimer);
    }

    // ── Timer ──

    _startTimer() {
        this._stopTimer();
        if (this.startTime) {
            this._timerInterval = setInterval(() => this.requestUpdate(), 1000);
        }
    }

    _stopTimer() {
        if (this._timerInterval) {
            clearInterval(this._timerInterval);
            this._timerInterval = null;
        }
    }

    getElapsedTime() {
        if (!this.startTime) return '0:00';
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        const h = Math.floor(elapsed / 3600);
        const m = Math.floor((elapsed % 3600) / 60);
        const s = elapsed % 60;
        const pad = n => String(n).padStart(2, '0');
        if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
        return `${m}:${pad(s)}`;
    }

    // ── Status & Responses ──

    setStatus(text) {
        this.statusText = text;
        if (text.includes('Ready') || text.includes('Listening') || text.includes('Error')) {
            this._currentResponseIsComplete = true;
        }
    }

    addNewResponse(response) {
        const { createTurnId } = window.require('./utils/answerEvents');
        this._applyAnswerEvent({
            turnId: createTurnId('notice'),
            event: 'complete',
            text: String(response),
            sequence: 0,
            lane: 'main',
            label: 'Notice',
        });
    }

    _applyAnswerEvent(event) {
        if (!event?.turnId) return;
        const { applyAnswerEvent } = window.require('./utils/answerEvents');
        const state = {
            responses: this.responses,
            turnIds: this._answerTurnIds,
            lanes: this._answerLanes,
            labels: this._answerLabels,
            sequences: this._answerSequences,
        };
        const next = applyAnswerEvent(state, event);
        if (next === state) return;
        const isNew = next.turnIds.length > state.turnIds.length;
        // A question re-asked with more words can move its card to the other screen; treat that like a new card.
        const position = next.turnIds.indexOf(event.turnId);
        const moved = !isNew && next.lanes[position] !== state.lanes[position];
        let { responses, turnIds, lanes, labels } = next;
        const removed = responses.length - MAX_ANSWER_CARDS;
        if (removed > 0) {
            const trimmed = { ...this._trimmed };
            for (let index = 0; index < removed; index++) {
                trimmed[lanes[index]]++;
                delete next.sequences[turnIds[index]];
            }
            this._trimmed = trimmed;
            [responses, turnIds, lanes, labels] = [responses, turnIds, lanes, labels].map(list => list.slice(removed));
        }
        this.responses = responses;
        this._answerTurnIds = turnIds;
        this._answerLanes = lanes;
        this._answerLabels = labels;
        this._answerSequences = next.sequences;
        const index = turnIds.indexOf(event.turnId);
        if ((isNew || moved) && index >= 0) this._placeNewCard(event.turnId, lanes[index], event.focus !== false);
        this._awaitingNewResponse = false;
        this.requestUpdate();
    }

    // A new answer opens its screen and becomes that screen's focused card, so a follow-up answer jumps to
    // the follow-up screen. A card marked focus:false (a step changed by a follow-up) leaves the user's place alone.
    _placeNewCard(turnId, lane, focus) {
        if (!focus) {
            if (lane !== this.activeScreen) this._unseen = { ...this._unseen, [lane]: this._unseen[lane] + 1 };
            return;
        }
        this._screenFocus = { ...this._screenFocus, [lane]: turnId };
        this.switchScreen(lane);
        this._revealCard(turnId);
    }

    async _toggleMeetingContext() {
        if (!this._contextOpen) this._meetingContext = (await cheatingDaddy.storage.getPreferences()).meetingContext || '';
        this._contextOpen = !this._contextOpen;
    }

    // Saved shortly after typing stops; main reads it on every answer.
    _saveMeetingContext(value) {
        this._meetingContext = value;
        clearTimeout(this._meetingContextTimer);
        this._meetingContextTimer = setTimeout(() => cheatingDaddy.storage.updatePreference('meetingContext', value), 400);
    }

    switchScreen(screen) {
        if ((screen !== 'main' && screen !== 'side') || screen === this.activeScreen) return;
        this.activeScreen = screen;
        this._unseen = { ...this._unseen, [screen]: 0 };
    }

    async _revealCard(turnId) {
        await this.updateComplete;
        const view = this.shadowRoot?.querySelector('assistant-view');
        if (!view) return;
        await view.updateComplete;
        const index = this._screenView(this.activeScreen).turnIds.indexOf(turnId);
        if (index >= 0) view.revealCard(index);
    }

    // The cards of one screen, with numbered labels, memoised so a re-render with no card changes passes the same arrays.
    _screenView(screen) {
        const key = [this.responses, this._answerLanes, this._answerLabels, screen, this._screenFocus[screen], this._trimmed[screen]];
        if (this._screenViewCache?.key.every((part, index) => part === key[index])) return this._screenViewCache.view;
        const view = { responses: [], labels: [], turnIds: [], focusIndex: -1 };
        this._answerLanes.forEach((lane, index) => {
            if (lane !== screen) return;
            const number = this._trimmed[screen] + view.responses.length + 1;
            const label = this._answerLabels[index];
            view.responses.push(this.responses[index]);
            view.labels.push(label ? `${number}. ${label}` : `Answer ${number}`);
            view.turnIds.push(this._answerTurnIds[index]);
        });
        view.focusIndex = view.turnIds.indexOf(this._screenFocus[screen]);
        this._screenViewCache = { key, view };
        return view;
    }

    handleAnswerEvent(event) {
        if (event.event === 'start') {
            this._applyAnswerEvent(event);
            return;
        }
        this._pendingAnswerEvents.set(event.turnId, event);
        if (event.event === 'complete' || event.event === 'interrupted') {
            this._flushAnswerEvents();
            return;
        }
        if (!this._answerFlushTimer) this._answerFlushTimer = setTimeout(() => this._flushAnswerEvents(), 40);
    }

    _flushAnswerEvents() {
        if (this._answerFlushTimer) clearTimeout(this._answerFlushTimer);
        this._answerFlushTimer = null;
        const events = [...this._pendingAnswerEvents.values()];
        this._pendingAnswerEvents.clear();
        for (const event of events) this._applyAnswerEvent(event);
    }

    // ── Navigation ──

    navigate(view) {
        this.currentView = view;
        this.requestUpdate();
    }

    async handleClose() {
        if (this.currentView === 'assistant') {
            if (this._sessionController) await this._sessionController.stop();
            else await this._stopMeetingResources();
            this.sessionActive = false;
            this._stopTimer();
            this.currentView = 'main';
        } else {
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                await ipcRenderer.invoke('quit-application');
            }
        }
    }

    async _handleMinimize() {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('window-minimize');
        }
    }

    async handleHideToggle() {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('toggle-window-visibility');
        }
    }

    // ── Session start ──

    _ensureSessionController() {
        if (this._sessionController) return this._sessionController;
        const { SessionController } = window.require('./utils/sessionController');
        this._sessionController = new SessionController({
            startProvider: async (generation, options) => this._startProvider(options),
            startCapture: async () => {
                const capture = await cheatingDaddy.startCapture(this.selectedScreenshotInterval, this.selectedImageQuality);
                if (!capture.success) throw new Error(capture.error || 'Audio capture failed');
                return capture;
            },
            stopProvider: async () => {
                if (!window.require) return;
                const { ipcRenderer } = window.require('electron');
                await ipcRenderer.invoke('close-session');
            },
            stopCapture: async () => cheatingDaddy.stopCapture(),
            onStateChange: state => {
                this.isRecording = state === 'active';
                this.requestUpdate();
            },
        });
        return this._sessionController;
    }

    async _startProvider({ providerMode, preferences }) {
        if (providerMode === 'cloud') {
            const creds = await cheatingDaddy.storage.getCredentials();
            if (!creds.cloudToken?.trim()) throw new Error('Cloud token is required');
            if (!(await cheatingDaddy.initializeCloud(this.selectedProfile))) throw new Error('Cloud connection failed');
            return 'cloud';
        }
        if (providerMode === 'local') {
            if (!(await cheatingDaddy.initializeLocal(this.selectedProfile))) throw new Error('Local AI failed to start');
            return 'local';
        }
        const apiKey = await cheatingDaddy.storage.getApiKey();
        if (!apiKey) throw new Error('Gemini API key is required');
        if (!(await cheatingDaddy.initializeGemini(this.selectedProfile, this.selectedLanguage))) throw new Error('Gemini failed to connect');
        return 'byok';
    }

    async _stopMeetingResources() {
        await cheatingDaddy.stopCapture();
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('close-session');
        }
    }

    async handleStart() {
        const prefs = await cheatingDaddy.storage.getPreferences();
        const providerMode = prefs.providerMode || 'cloud';
        const result = await this._ensureSessionController().start({ providerMode, preferences: prefs });
        if (!result.success) {
            this.setStatus(result.error || 'Meeting failed to start');
            const mainView = this.shadowRoot.querySelector('main-view');
            mainView?.triggerApiKeyError?.();
            return;
        }
        this.responses = [];
        this._answerTurnIds = [];
        this._answerLanes = [];
        this._answerLabels = [];
        this._answerSequences = {};
        this._pendingAnswerEvents.clear();
        this._screenFocus = { main: null, side: null };
        this._unseen = { main: 0, side: 0 };
        this._trimmed = { main: 0, side: 0 };
        this.activeScreen = 'main';
        this._contextOpen = false;
        this.codingMode = false;
        this.startTime = Date.now();
        this.sessionActive = true;
        this.currentView = 'assistant';
        this._startTimer();
    }

    async handleAPIKeyHelp() {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('open-external', 'https://cheatingdaddy.com/help/api-key');
        }
    }

    async handleGroqAPIKeyHelp() {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('open-external', 'https://console.groq.com/keys');
        }
    }

    // ── Settings handlers ──

    async handleProfileChange(profile) {
        this.selectedProfile = profile;
        await cheatingDaddy.storage.updatePreference('selectedProfile', profile);
    }

    async handleLanguageChange(language) {
        this.selectedLanguage = language;
        await cheatingDaddy.storage.updatePreference('selectedLanguage', language);
    }

    async handleScreenshotIntervalChange(interval) {
        this.selectedScreenshotInterval = interval;
        await cheatingDaddy.storage.updatePreference('selectedScreenshotInterval', interval);
    }

    async handleImageQualityChange(quality) {
        this.selectedImageQuality = quality;
        await cheatingDaddy.storage.updatePreference('selectedImageQuality', quality);
    }

    async handleLayoutModeChange(layoutMode) {
        this.layoutMode = layoutMode;
        await cheatingDaddy.storage.updateConfig('layout', layoutMode);
        if (window.require) {
            try {
                const { ipcRenderer } = window.require('electron');
                await ipcRenderer.invoke('update-sizes');
            } catch (error) {
                console.error('Failed to update sizes:', error);
            }
        }
        this.requestUpdate();
    }

    async handleExternalLinkClick(url) {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('open-external', url);
        }
    }

    async handleSendText(message) {
        const result = await window.cheatingDaddy.sendTextMessage(message);
        if (!result.success) {
            this.setStatus('Error sending message: ' + result.error);
        } else {
            this.setStatus('Message sent...');
            this._awaitingNewResponse = true;
        }
        return result;
    }

    handleResponseIndexChanged(e) {
        const turnId = this._screenView(this.activeScreen).turnIds[e.detail.index] ?? null;
        this._screenFocus = { ...this._screenFocus, [this.activeScreen]: turnId };
        this.shouldAnimateResponse = false;
        this.requestUpdate();
    }

    handleOnboardingComplete() {
        this.currentView = 'main';
    }

    updated(changedProperties) {
        super.updated(changedProperties);

        // Coding mode widens the live overlay so the explanation and the code fit side by side. DevOps answers
        // often carry a query or a command too, so DevOps mode stays wide the whole session.
        const wide = this.codingMode || this.selectedProfile === 'devops';
        if (changedProperties.has('currentView') && window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.send('view-changed', this.currentView);
            if (this.currentView === 'assistant' && wide) ipcRenderer.send('coding-layout', true);
        }

        if (
            changedProperties.has('codingMode') &&
            changedProperties.get('codingMode') !== undefined &&
            this.currentView === 'assistant' &&
            window.require
        ) {
            window.require('electron').ipcRenderer.send('coding-layout', wide);
        }
    }

    // ── Helpers ──

    _isLiveMode() {
        return this.currentView === 'assistant';
    }

    // ── Render ──

    renderCurrentView() {
        switch (this.currentView) {
            case 'onboarding':
                return html`
                    <onboarding-view .onComplete=${() => this.handleOnboardingComplete()} .onClose=${() => this.handleClose()}></onboarding-view>
                `;

            case 'main':
                return html`
                    <main-view
                        .selectedProfile=${this.selectedProfile}
                        .onProfileChange=${p => this.handleProfileChange(p)}
                        .onStart=${() => this.handleStart()}
                        .onExternalLink=${url => this.handleExternalLinkClick(url)}
                        .whisperDownloading=${this._whisperDownloading}
                    ></main-view>
                `;

            case 'ai-customize':
                return html`
                    <ai-customize-view
                        .selectedProfile=${this.selectedProfile}
                        .onProfileChange=${p => this.handleProfileChange(p)}
                    ></ai-customize-view>
                `;

            case 'customize':
                return html`
                    <customize-view
                        .selectedProfile=${this.selectedProfile}
                        .selectedLanguage=${this.selectedLanguage}
                        .selectedScreenshotInterval=${this.selectedScreenshotInterval}
                        .selectedImageQuality=${this.selectedImageQuality}
                        .layoutMode=${this.layoutMode}
                        .onProfileChange=${p => this.handleProfileChange(p)}
                        .onLanguageChange=${l => this.handleLanguageChange(l)}
                        .onScreenshotIntervalChange=${i => this.handleScreenshotIntervalChange(i)}
                        .onImageQualityChange=${q => this.handleImageQualityChange(q)}
                        .onLayoutModeChange=${lm => this.handleLayoutModeChange(lm)}
                    ></customize-view>
                `;

            case 'feedback':
                return html`<feedback-view></feedback-view>`;

            case 'help':
                return html`<help-view .onExternalLinkClick=${url => this.handleExternalLinkClick(url)}></help-view>`;

            case 'history':
                return html`<history-view></history-view>`;

            case 'assistant': {
                const screen = this._screenView(this.activeScreen);
                return html`
                    <assistant-view
                        .responses=${screen.responses}
                        .labels=${screen.labels}
                        .screen=${this.activeScreen}
                        .currentResponseIndex=${screen.focusIndex}
                        .selectedProfile=${this.selectedProfile}
                        .onSendText=${msg => this.handleSendText(msg)}
                        .shouldAnimateResponse=${this.shouldAnimateResponse}
                        @response-index-changed=${this.handleResponseIndexChanged}
                        @response-animation-complete=${() => {
                            this.shouldAnimateResponse = false;
                            this._currentResponseIsComplete = true;
                            this.requestUpdate();
                        }}
                    ></assistant-view>
                `;
            }

            default:
                return html`<div>Unknown view: ${this.currentView}</div>`;
        }
    }

    renderSidebar() {
        const items = [
            {
                id: 'main',
                label: 'Home',
                icon: html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
                        <path
                            d="m19 8.71l-5.333-4.148a2.666 2.666 0 0 0-3.274 0L5.059 8.71a2.67 2.67 0 0 0-1.029 2.105v7.2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.2c0-.823-.38-1.6-1.03-2.105"
                        />
                        <path d="M16 15c-2.21 1.333-5.792 1.333-8 0" />
                    </g>
                </svg>`,
            },
            {
                id: 'ai-customize',
                label: 'AI Customization',
                icon: html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                    <path
                        fill="none"
                        stroke="currentColor"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M13 3v7h6l-8 11v-7H5z"
                    />
                </svg>`,
            },
            {
                id: 'history',
                label: 'History',
                icon: html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
                        <path
                            d="M10 20.777a9 9 0 0 1-2.48-.969M14 3.223a9.003 9.003 0 0 1 0 17.554m-9.421-3.684a9 9 0 0 1-1.227-2.592M3.124 10.5c.16-.95.468-1.85.9-2.675l.169-.305m2.714-2.941A9 9 0 0 1 10 3.223"
                        />
                        <path d="M12 8v4l3 3" />
                    </g>
                </svg>`,
            },
            {
                id: 'customize',
                label: 'Settings',
                icon: html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
                        <path
                            d="M19.875 6.27A2.23 2.23 0 0 1 21 8.218v7.284c0 .809-.443 1.555-1.158 1.948l-6.75 4.27a2.27 2.27 0 0 1-2.184 0l-6.75-4.27A2.23 2.23 0 0 1 3 15.502V8.217c0-.809.443-1.554 1.158-1.947l6.75-3.98a2.33 2.33 0 0 1 2.25 0l6.75 3.98z"
                        />
                        <path d="M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0" />
                    </g>
                </svg>`,
            },
            {
                id: 'feedback',
                label: 'Feedback',
                icon: html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
                        <path d="M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-5l-5 3v-3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zM9.5 9h.01m4.99 0h.01" />
                        <path d="M9.5 13a3.5 3.5 0 0 0 5 0" />
                    </g>
                </svg>`,
            },
            {
                id: 'help',
                label: 'Help',
                icon: html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
                        <path d="M12 3c7.2 0 9 1.8 9 9s-1.8 9-9 9s-9-1.8-9-9s1.8-9 9-9m0 13v.01" />
                        <path d="M12 13a2 2 0 0 0 .914-3.782a1.98 1.98 0 0 0-2.414.483" />
                    </g>
                </svg>`,
            },
        ];

        return html`
            <div class="sidebar ${this._isLiveMode() ? 'hidden' : ''}">
                <div class="sidebar-brand">
                    <h1>Cheating Daddy</h1>
                </div>
                <nav class="sidebar-nav">
                    ${items.map(
                        item => html`
                            <button
                                class="nav-item ${this.currentView === item.id ? 'active' : ''}"
                                @click=${() => this.navigate(item.id)}
                                title=${item.label}
                            >
                                ${item.icon} ${item.label}
                            </button>
                        `
                    )}
                </nav>
                <div class="sidebar-footer">
                    ${
                        this._updateAvailable
                            ? html`
                                  <button class="update-btn" @click=${() => this.handleExternalLinkClick('https://cheatingdaddy.com/download')}>
                                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                                          <path
                                              fill="none"
                                              stroke="currentColor"
                                              stroke-linecap="round"
                                              stroke-linejoin="round"
                                              stroke-width="2"
                                              d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 11l5 5l5-5m-5-7v12"
                                          />
                                      </svg>
                                      Update available
                                  </button>
                              `
                            : html` <div class="version-text">v${this._localVersion}</div> `
                    }
                </div>
            </div>
        `;
    }

    renderLiveBar() {
        if (!this._isLiveMode()) return '';

        const profileLabels = {
            interview: 'Interview',
            coding: 'Coding Round',
            lld: 'LLD Interview',
            hld: 'HLD Interview',
            devops: 'DevOps',
            sales: 'Sales Call',
            meeting: 'Tech Meeting',
            presentation: 'Presentation',
            negotiation: 'Negotiation',
            exam: 'Exam',
        };

        return html`
            <div class="live-bar">
                <div class="live-bar-left">
                    <button class="live-bar-back" @click=${() => this.handleClose()} title="End session">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                            <path
                                fill-rule="evenodd"
                                d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.832 10l3.938 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z"
                                clip-rule="evenodd"
                            />
                        </svg>
                    </button>
                </div>
                <div class="live-bar-center">
                    <span class="live-bar-mode ${this.codingMode ? 'coding' : ''}">
                        ${this.codingMode ? 'Coding' : profileLabels[this.selectedProfile] || 'Session'}
                    </span>
                    <span class="screen-tabs">
                        ${[
                            ['main', 'Main'],
                            ['side', 'Follow-ups'],
                        ].map(
                            ([screen, name]) => html`
                                <button
                                    class="screen-tab ${screen === this.activeScreen && !this._contextOpen ? 'active' : ''}"
                                    @click=${() => {
                                        this._contextOpen = false;
                                        this.switchScreen(screen);
                                    }}
                                >
                                    ${name}${this._unseen[screen] ? html`<span class="screen-new">${this._unseen[screen]} new</span>` : ''}
                                </button>
                            `
                        )}
                        ${
                            this.selectedProfile === 'meeting'
                                ? html`<button class="screen-tab ${this._contextOpen ? 'active' : ''}" @click=${() => this._toggleMeetingContext()}>
                                      Context
                                  </button>`
                                : ''
                        }
                    </span>
                </div>
                <div class="live-bar-right">
                    ${this.statusText ? html`<span class="live-bar-text optional">${this.statusText}</span>` : ''}
                    <span class="live-bar-text optional">${this.getElapsedTime()}</span>
                    ${this._isClickThrough ? html`<span class="live-bar-text">[click through]</span>` : ''}
                    <span class="live-bar-text clickable" @click=${() => this.handleHideToggle()}>[hide]</span>
                </div>
            </div>
        `;
    }

    render() {
        // Onboarding is fullscreen, no sidebar
        if (this.currentView === 'onboarding') {
            return html` <div class="fullscreen ${this._stealthHidden ? 'stealth-hidden' : ''}">${this.renderCurrentView()}</div> `;
        }

        const isLive = this._isLiveMode();

        return html`
            <div class="app-shell ${this._stealthHidden ? 'stealth-hidden' : ''}">
                <div class="top-drag-bar ${isLive ? 'hidden' : ''}">
                    <div class="traffic-lights">
                        <button class="traffic-light close" @click=${() => this.handleClose()} title="Close"></button>
                        <button class="traffic-light minimize" @click=${() => this._handleMinimize()} title="Minimize"></button>
                        <button class="traffic-light maximize" title="Maximize"></button>
                    </div>
                    <div class="drag-region"></div>
                </div>
                ${this.renderSidebar()}
                <div class="content">
                    ${isLive ? this.renderLiveBar() : ''}
                    <div class="content-inner ${isLive ? 'live' : ''} ${isLive && this._contextOpen ? 'context-open' : ''}">
                        ${this.renderCurrentView()}
                        ${
                            isLive && this._contextOpen
                                ? html`<div class="context-panel">
                                      <textarea
                                          .value=${this._meetingContext}
                                          placeholder="What the meeting is about: tickets, changes, test results, log markers..."
                                          @input=${e => this._saveMeetingContext(e.target.value)}
                                      ></textarea>
                                      <div class="context-help">Saved as you type. The next answer uses it.</div>
                                  </div>`
                                : ''
                        }
                    </div>
                </div>
                ${
                    isLive
                        ? ['left', 'right', 'bottom', 'bottom-left', 'bottom-right'].map(
                              edge => html`<div class="resize-handle ${edge}" @pointerdown=${e => this._startResize(e, edge)}></div>`
                          )
                        : ''
                }
            </div>
        `;
    }

    // Main moves the window; screen coordinates stay right while the window changes under the pointer.
    _startResize(event, edge) {
        if (!window.require || event.button !== 0) return;
        event.preventDefault();
        const { ipcRenderer } = window.require('electron');
        const handle = event.currentTarget;
        handle.setPointerCapture(event.pointerId);
        const startX = event.screenX;
        const startY = event.screenY;
        let frame = 0;
        let last = null;
        const move = moveEvent => {
            last = { edge, dx: moveEvent.screenX - startX, dy: moveEvent.screenY - startY };
            frame ||= requestAnimationFrame(() => {
                frame = 0;
                ipcRenderer.send('overlay-resize', last);
            });
        };
        const end = () => {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', end);
            handle.removeEventListener('pointercancel', end);
            cancelAnimationFrame(frame);
            if (last) ipcRenderer.send('overlay-resize', last);
            ipcRenderer.send('overlay-resize-end');
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
        ipcRenderer.send('overlay-resize-start');
    }
}

customElements.define('cheating-daddy-app', CheatingDaddyApp);
