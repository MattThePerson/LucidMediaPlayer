// ── Filter presets ───────────────────────────────────────────────────────────

const _CSS_FILTERS = [
    { name: 'None',      filter: '' },
    { name: 'Warm',      filter: 'sepia(0.3) saturate(1.2) brightness(1.05)' },
    { name: 'Cold',      filter: 'hue-rotate(195deg) saturate(0.85) brightness(0.95)' },
    { name: 'Vivid',     filter: 'saturate(1.6) contrast(1.1)' },
    { name: 'Cinematic', filter: 'contrast(1.15) brightness(0.88) sepia(0.12)' },
    { name: 'B&W',       filter: 'grayscale(1)' },
    { name: 'Soft',      filter: 'brightness(1.08) contrast(0.88) saturate(0.85)' },
];

const _MPV_PRESETS = [
    { name: 'None',      vf: '' },
    { name: 'Sharpen',   vf: 'lavfi=[unsharp=lx=3:ly=3:la=0.8]' },
    { name: 'Denoise',   vf: 'lavfi=[hqdn3d]' },
    { name: 'Vivid',     vf: 'lavfi=[eq=saturation=1.5:contrast=1.1]' },
    { name: 'Cinematic', vf: 'lavfi=[eq=contrast=1.15:brightness=-0.05]' },
    { name: 'B&W',       vf: 'lavfi=[hue=s=0]' },
];

// ── Keybind Engine ──────────────────────────────────────────────────────────

const _KEY_NAME_MAP = {
    'leftarrow': 'ArrowLeft', 'rightarrow': 'ArrowRight',
    'uparrow': 'ArrowUp', 'downarrow': 'ArrowDown',
    'space': 'Space', 'home': 'Home', 'end': 'End',
    'pageup': 'PageUp', 'pagedown': 'PageDown',
    'escape': 'Escape', 'enter': 'Enter', 'tab': 'Tab',
    'backspace': 'Backspace', 'delete': 'Delete',
    'f1':'F1','f2':'F2','f3':'F3','f4':'F4','f5':'F5','f6':'F6',
    'f7':'F7','f8':'F8','f9':'F9','f10':'F10','f11':'F11','f12':'F12',
};

function _tokenToCode(token) {
    const t = token.toLowerCase();
    const mapped = _KEY_NAME_MAP[t];
    if (mapped) return mapped;
    if (t.length === 1) {
        if (t >= '0' && t <= '9') return 'Digit' + t;
        return 'Key' + t.toUpperCase();
    }
    return t[0].toUpperCase() + t.slice(1);
}

function _parseKey(keyStr) {
    const parts = keyStr.split('-');
    const mods = { ctrl: false, shift: false, alt: false, meta: false };
    const nonMods = [];
    for (const part of parts) {
        const p = part.toLowerCase();
        if (p === 'ctrl' || p === 'control') { mods.ctrl = true; continue; }
        if (p === 'shift') { mods.shift = true; continue; }
        if (p === 'alt') { mods.alt = true; continue; }
        if (p === 'meta' || p === 'cmd') { mods.meta = true; continue; }
        nonMods.push(part);
    }
    return { mods, code: nonMods.length > 0 ? _tokenToCode(nonMods[nonMods.length - 1]) : '', nonModCount: nonMods.length };
}

function _modsMatch(ruleMods, e) {
    return ruleMods.ctrl === e.ctrlKey && ruleMods.shift === e.shiftKey &&
           ruleMods.alt === e.altKey && ruleMods.meta === e.metaKey;
}

function _buildRuleMap(dict) {
    const map = new Map();
    const add = (code, rule) => {
        if (!map.has(code)) map.set(code, []);
        map.get(code).push(rule);
    };

    for (const [action, value] of Object.entries(dict)) {
        for (const v of (Array.isArray(value) ? value : [value])) {
            if (v === '__digits__') {
                add('__DIGIT__', { code: '__DIGIT__', mods: { ctrl:false, shift:false, alt:false, meta:false }, type: 'digit', action, pairAction: null });
                continue;
            }
            if (v.includes('{')) {
                const prefix = v.split('{')[0].replace(/\+$/, '');
                const { mods } = _parseKey(prefix || 'ctrl');
                mods.ctrl = true;
                add('__CTRL_DIGIT__', { code: '__CTRL_DIGIT__', mods, type: 'pattern', action, pairAction: null });
                continue;
            }
            if (v.endsWith('[hold]')) {
                const { mods, code, nonModCount } = _parseKey(v.slice(0, -6));
                if (!code || nonModCount > 1) continue;
                add(code, { code, mods, type: 'hold', action, pairAction: null });
                continue;
            }
            // double-tap: "r+r"
            const dtm = v.match(/^(.+)\+\1$/);
            if (dtm) {
                const { mods, code, nonModCount } = _parseKey(dtm[1]);
                if (!code || nonModCount > 1) continue;
                add(code, { code, mods, type: 'doubletap', action, pairAction: null });
                continue;
            }
            const { mods, code, nonModCount } = _parseKey(v);
            if (!code || nonModCount > 1) continue; // skip chords
            add(code, { code, mods, type: 'simple', action, pairAction: null });
        }
    }

    // Link doubletap <-> simple pairs and hold -> simple pairs
    for (const rules of map.values()) {
        const sameModsMatch = (a, b) =>
            a.code === b.code && a.mods.ctrl === b.mods.ctrl &&
            a.mods.shift === b.mods.shift && a.mods.alt === b.mods.alt;
        for (const dt of rules.filter(r => r.type === 'doubletap')) {
            const s = rules.find(r => r.type === 'simple' && sameModsMatch(r, dt));
            if (s) { dt.pairAction = s.action; s.pairAction = dt.action; }
        }
        for (const h of rules.filter(r => r.type === 'hold')) {
            const s = rules.find(r => r.type === 'simple' && sameModsMatch(r, h));
            if (s) h.pairAction = s.action;
        }
    }
    return map;
}

class KeybindEngine {
    constructor(dict, dispatch) {
        this._dispatch = dispatch;
        this._ruleMap = _buildRuleMap(dict);
        this._dtState = null;
        this._holdState = null;
        this._kd = (e) => this._onKeydown(e);
        this._ku = (e) => this._onKeyup(e);
        document.addEventListener('keydown', this._kd);
        document.addEventListener('keyup', this._ku);
    }

    destroy() {
        document.removeEventListener('keydown', this._kd);
        document.removeEventListener('keyup', this._ku);
        if (this._dtState) { clearTimeout(this._dtState.timer); this._dtState = null; }
        if (this._holdState) { clearTimeout(this._holdState.timer); this._holdState = null; }
    }

    _match(e) {
        const candidates = [...(this._ruleMap.get(e.code) ?? [])];
        if (/^Digit\d$/.test(e.code)) {
            candidates.push(...(this._ruleMap.get('__DIGIT__') ?? []));
            candidates.push(...(this._ruleMap.get('__CTRL_DIGIT__') ?? []));
        }
        for (const rule of candidates) {
            if (_modsMatch(rule.mods, e)) {
                const digit = (rule.type === 'digit' || rule.type === 'pattern')
                    ? parseInt(e.code.slice(-1), 10) : null;
                return { rule, digit };
            }
        }
        return null;
    }

    _onKeydown(e) {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
        const result = this._match(e);
        if (!result) return;
        e.preventDefault();
        const { rule, digit } = result;

        const allForCode = [
            ...(this._ruleMap.get(rule.code) ?? []),
            ...(/^Digit\d$/.test(rule.code) ? [
                ...(this._ruleMap.get('__DIGIT__') ?? []),
                ...(this._ruleMap.get('__CTRL_DIGIT__') ?? []),
            ] : []),
        ];
        const holdRule = allForCode.find(r => r.type === 'hold' && _modsMatch(r.mods, e));
        const dtRule = allForCode.find(r => r.type === 'doubletap' && _modsMatch(r.mods, e));

        if (holdRule) {
            if (this._holdState) return;
            this._holdState = {
                code: rule.code, fired: false,
                tapAction: holdRule.pairAction,
                timer: setTimeout(() => {
                    if (this._holdState) { this._holdState.fired = true; this._dispatch(holdRule.action, {}); }
                }, 750),
            };
            return;
        }

        if (dtRule) {
            if (this._dtState && this._dtState.code === rule.code &&
                this._dtState.mods.ctrl === e.ctrlKey && this._dtState.mods.shift === e.shiftKey) {
                clearTimeout(this._dtState.timer);
                this._dtState = null;
                this._dispatch(dtRule.action, {});
                return;
            }
            if (dtRule.pairAction) this._dispatch(dtRule.pairAction, {});
            this._dtState = {
                code: rule.code,
                mods: { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey },
                timer: setTimeout(() => { this._dtState = null; }, 500),
            };
            return;
        }

        this._dispatch(rule.action, { digit });
    }

    _onKeyup(e) {
        if (!this._holdState || this._holdState.code !== e.code) return;
        clearTimeout(this._holdState.timer);
        const { fired, tapAction } = this._holdState;
        this._holdState = null;
        if (!fired && tapAction) this._dispatch(tapAction, {});
    }
}

// ── PassionPlayer ────────────────────────────────────────────────────────────

export class PassionPlayer {
    constructor({
        player_id = null,
        hostEl = null,
        src = null,
        poster = null,
        title = null,
        subtitles_srt_src = null,
        autoplay = true,
        mute = false,
        preload = 'auto',
        markers_get = null,
        markers_post = null,
        keybind_override_elements = null,
        styles = null,
        quiet = true,
        disable_keybinds = false,
        controlsOverlayKey = 't',
        // headless callbacks
        onPlay = null,
        onPause = null,
        onSeek = null,
        onFullscreen = null,
        onVolumeChange = null,
        onUIVisible = null,
        onSubtitleChange = null,
        onAddSubtitleFile = null,
        onFrameStep = null,
        onSpeedChange = null,
        onMpvFilterChange = null,
        onCssFilterChange = null,
        onThumbnailSizeChange = null,
        thumbnailSize = 1.0,
    }) {
        this.player_id = player_id;
        this.src = src;
        this.poster = poster;
        this.title = title;
        this.subtitles_srt_src = subtitles_srt_src;
        this.autoplay = autoplay;
        this.mute = mute;
        this.preload = preload;
        this.markers_get = markers_get;
        this.markers_post = markers_post;
        this.keybind_override_elements = keybind_override_elements;
        this.dev_styles_path = styles;
        this.quiet = quiet;
        this.disable_keybinds = disable_keybinds;
        this._controlsOverlayKey = controlsOverlayKey;
        this.onPlay = onPlay;
        this.onPause = onPause;
        this.onSeek = onSeek;
        this.onFullscreen = onFullscreen;
        this.onVolumeChange = onVolumeChange;
        this.onUIVisible = onUIVisible;
        this.onSubtitleChange = onSubtitleChange;
        this.onAddSubtitleFile = onAddSubtitleFile;
        this.onFrameStep = onFrameStep;
        this.onSpeedChange = onSpeedChange;
        this.onMpvFilterChange = onMpvFilterChange;
        this.onCssFilterChange = onCssFilterChange;
        this.onThumbnailSizeChange = onThumbnailSizeChange;

        this.root_element = null;
        this.shadow = null;
        this.video = null;

        // headless playback state
        this._paused = true;
        this._currentTime = 0;
        this._duration = 0;
        this._volume = 100;
        this._muted = false;
        this._playbackSpeed = 1.0;

        // subtitle state
        this._subtitleText = '';
        this._subtitleTracks = [];
        this._activeSid = 0;
        this._subtitleMenuOpen = false;

        // seek thumbs
        this.seekThumbsContainer = null;
        this.seekThumbsSprites = null;
        this.seekThumbsSpritesheetSize = null;

        this._clickToTogglePlayback = true;
        this._keybindEngine = null;
        this._keydownHandler = null; // kept for compat
        this._hostEl = hostEl;
        this._destroyed = false;
        this._hideTimer = null;
        this._rafId = null;
        this._rafLastTs = 0;
        this._controlsVisible = false;
        this._keybindOverlayVisible = false;
        this._filenameText = title ?? '';

        // OSD timers
        this._osdTimer = null;
        this._seekOsdTimer = null;
        this._volumeOsdTimer = null;

        // markers & playheads
        this._markers = [];
        this._markerCounter = 0;
        this._playheads = [{ id: 1, time: 0 }];
        this._playheadCounter = 1;
        this._activePlayheadIndex = 0;

        // filters
        this._cssFilterIndex = 0;
        this._mpvPresetIndex = 0;

        // thumbnail size (multiplier, base = 200px)
        this._thumbSizeMultiplier = thumbnailSize;
        this._lastRenderedDuration = 0;

        // drag-seek state
        this._seekDragging = false;
        this._seekDragMoveHandler = null;
        this._seekDragUpHandler = null;

        this._init();
    }

    // ====================================================================================================
    // Init
    // ====================================================================================================

    async _init() {
        this.root_element = this._hostEl ?? document.getElementById(this.player_id);
        if (!this.root_element) throw new Error(`PassionPlayer: no element #${this.player_id}`);
        this.shadow = this.root_element.shadowRoot ?? this.root_element.attachShadow({ mode: 'open' });
        this.shadow.innerHTML = '';

        await this._addStyles(this.shadow, this.dev_styles_path);
        if (this._destroyed) return;
        this._addHTML(this.shadow);

        if (this.src) {
            await new Promise((resolve) => {
                this.shadow.querySelector('video').addEventListener('loadeddata', resolve, { once: true });
            });
            this.video = this.shadow.querySelector('video');
            this.log('video loaded');
        }

        this._hydrate();
        if (!this.disable_keybinds && !this._keybindEngine) this.addKeybinds();
        this._initEventListeners();
    }

    _addHTML(shadow) {
        const player = document.createElement('div');
        player.className = 'PassionPlayer';
        player.innerHTML = this.getHTML();
        shadow.appendChild(player);
    }

    async _addStyles(shadow, styles_path) {
        let css = this._getStyles();
        if (styles_path) {
            const r = await fetch(styles_path);
            if (r.status !== 200) throw new Error(`Styles not found: ${styles_path}`);
            css = await r.text();
        }
        const style = document.createElement('style');
        style.textContent = css;
        shadow.appendChild(style);
    }

    destroy() {
        this._destroyed = true;
        this._stopRaf();
        this.onUIVisible?.(false);
        clearTimeout(this._hideTimer);
        clearTimeout(this._osdTimer);
        clearTimeout(this._seekOsdTimer);
        clearTimeout(this._volumeOsdTimer);
        this._keybindEngine?.destroy();
        this._keybindEngine = null;
        if (this._seekDragMoveHandler) {
            document.removeEventListener('mousemove', this._seekDragMoveHandler);
            document.removeEventListener('mouseup', this._seekDragUpHandler);
        }
        if (this.shadow) this.shadow.innerHTML = '';
    }

    // ====================================================================================================
    // Handlers
    // ====================================================================================================

    _hydrate() {
        if (this.video) {
            const el = this.$('.time-duration-container .duration');
            if (el) el.textContent = this._formatTime(this.video.duration);
        }
        this.updatePlayBtn();
        const fn = this.$('.pp-filename');
        if (fn && this._filenameText) fn.textContent = this._filenameText;
    }

    _initEventListeners() {
        this._addVideoClickEventListeners();
        this._addDefaultProgressBarEventListeners();
        this._addPlayBtnEventListeners();
        this._addVolumeEventListeners();
        this._addFullscreenBtnEventListeners();
        this._addSubtitleEventListeners();
        this._addScrollEventListeners();
        this._initControlsAutoHide();
    }

    _addPlayBtnEventListeners() {
        const btn = this.$('.pp-play-btn');
        if (!btn) return;
        btn.addEventListener('click', (e) => { e.stopPropagation(); this.togglePlayback(); });
        if (this.video) {
            this.video.addEventListener('play', () => this.updatePlayBtn());
            this.video.addEventListener('pause', () => this.updatePlayBtn());
        }
    }

    _addFullscreenBtnEventListeners() {
        const btn = this.$('.pp-fullscreen-btn');
        if (!btn) return;
        btn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleFullscreen(); });
    }

    _addVolumeEventListeners() {
        const slider = this.$('.pp-volume-slider');
        if (!slider) return;
        slider.addEventListener('input', (e) => {
            e.stopPropagation();
            const vol = Number(e.target.value);
            this._volume = vol;
            this.onVolumeChange?.(this._muted ? 0 : vol);
            this.updateVolumeIcon(this._muted ? 0 : vol);
        });
        slider.addEventListener('click', (e) => e.stopPropagation());
        slider.addEventListener('mousedown', (e) => e.stopPropagation());
    }

    _addVideoClickEventListeners() {
        let pb_flag = false;
        let fs_flag = false;
        let pb_timer = null;
        const clickTarget = this.video ?? this.$('.PassionPlayer');

        clickTarget.addEventListener('click', (e) => {
            if (!this.video && e.target.closest('.controls-bar')) return;
            if (!this.video && e.target.closest('#progress-bar-default')) return;
            if (!this.video && e.target.closest('.pp-keybinds-overlay')) return;
            if (pb_flag === false && fs_flag === false) {
                pb_flag = true;
                fs_flag = true;
                pb_timer = setTimeout(() => {
                    if (pb_flag) {
                        if (this._clickToTogglePlayback) this.togglePlayback();
                        pb_flag = false;
                    }
                }, 175);
                setTimeout(() => { fs_flag = false; }, 350);
            } else if (fs_flag) {
                clearTimeout(pb_timer);
                pb_timer = null;
                this.$$('.pp-icon').forEach(el => { el.style.display = 'none'; });
                this.toggleFullscreen();
                pb_flag = false;
                fs_flag = false;
            }
        });
    }

    _addDefaultProgressBarEventListeners() {
        const zone = this.$('#progress-bar-default');
        const bar = zone.querySelector('.progress-bar');

        if (this.video) {
            this.video.addEventListener('timeupdate', () => {
                const perc = (this.video.currentTime / this.video.duration) * 100;
                bar.style.width = perc + '%';
                const cur = this.$('.time-duration-container .current');
                if (cur) cur.textContent = this._formatTime(this.video.currentTime);
            });
        }

        zone.addEventListener('mouseenter', () => { zone.style.height = '38px'; });
        zone.addEventListener('mouseleave', () => { zone.style.height = '12px'; });

        // drag-seek: mousedown starts, document mousemove continues, mouseup ends
        zone.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            this._seekDragging = true;
            this._doProgressSeek(e, zone, bar);
        });

        this._seekDragMoveHandler = (e) => {
            if (!this._seekDragging) return;
            this._doProgressSeek(e, zone, bar);
        };
        this._seekDragUpHandler = () => { this._seekDragging = false; };
        document.addEventListener('mousemove', this._seekDragMoveHandler);
        document.addEventListener('mouseup', this._seekDragUpHandler);

        // scroll on progress bar: Ctrl+Shift = thumb size; else seek ±1s
        zone.addEventListener('wheel', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.ctrlKey && e.shiftKey) {
                this._adjustThumbSize(e.deltaY > 0 ? -0.1 : 0.1);
                return;
            }
            const delta = e.deltaY > 0 ? -1 : 1;
            let newFrac;
            if (this.video) {
                const nt = Math.max(0, Math.min(this.video.duration, this.video.currentTime + delta));
                newFrac = nt / this.video.duration;
            } else if (this._duration > 0) {
                const nt = Math.max(0, Math.min(this._duration, this._currentTime + delta));
                newFrac = nt / this._duration;
            } else return;
            this.setPlaybackTime(newFrac, bar);
            this._showSeekOSD();
        }, { passive: false });

        zone.addEventListener('mousemove', (e) => {
            const rect = zone.getBoundingClientRect();
            const perc = ((e.clientX - rect.left) / rect.width) * 100;
            this._updateSeekThumbnail(e.clientX, perc);
        });
        zone.addEventListener('mouseleave', () => this._hideSeekThumbnail());
    }

    _doProgressSeek(e, zone, bar) {
        const rect = zone.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        this.setPlaybackTime(frac, bar);
    }

    _addScrollEventListeners() {
        const playerDiv = this.$('.PassionPlayer');
        if (!playerDiv) return;
        playerDiv.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.ctrlKey && e.shiftKey) {
                this._adjustThumbSize(e.deltaY > 0 ? -0.1 : 0.1);
                return;
            }
            this._changeVolume(e.deltaY > 0 ? -5 : 5);
        }, { passive: false });
    }

    _initControlsAutoHide() {
        const playerDiv = this.$('.PassionPlayer');
        if (!playerDiv) return;
        this._resetHideTimer();
        playerDiv.addEventListener('mousemove', () => this._resetHideTimer());
        playerDiv.addEventListener('mouseleave', () => {
            clearTimeout(this._hideTimer);
            const isPaused = this.video ? this.video.paused : this._paused;
            if (!isPaused) this._hideControls();
        });
        playerDiv.addEventListener('mouseenter', () => this._resetHideTimer());
    }

    _resetHideTimer() {
        this._showControls();
        clearTimeout(this._hideTimer);
        const isPaused = this.video ? this.video.paused : this._paused;
        if (!isPaused) {
            this._hideTimer = setTimeout(() => this._hideControls(), 2000);
        }
    }

    _showControls() {
        const controls = this.$('.controls-bar');
        const progress = this.$('#progress-bar-default');
        const player = this.$('.PassionPlayer');
        const filename = this.$('.pp-filename');
        if (controls) { controls.style.transitionDuration = '0ms'; controls.style.opacity = '1'; }
        if (progress) { progress.style.transitionDuration = '0ms'; progress.style.opacity = '1'; }
        if (filename) { filename.style.transitionDuration = '0ms'; filename.style.opacity = '1'; }
        if (player) player.style.cursor = '';
        this._controlsVisible = true;
        this.onUIVisible?.(true);
    }

    _hideControls() {
        const controls = this.$('.controls-bar');
        const progress = this.$('#progress-bar-default');
        const player = this.$('.PassionPlayer');
        const filename = this.$('.pp-filename');
        if (controls) { controls.style.transitionDuration = '500ms'; controls.style.opacity = '0'; }
        if (progress) { progress.style.transitionDuration = '500ms'; progress.style.opacity = '0.2'; }
        if (filename) { filename.style.transitionDuration = '500ms'; filename.style.opacity = '0'; }
        if (player) player.style.cursor = 'none';
        this._controlsVisible = false;
        this._closeSubtitleMenu();
        this.onUIVisible?.(false);
    }

    // ====================================================================================================
    // HTML
    // ====================================================================================================

    getHTML() {
        const videoEl = this.src ? `<video src="${this.src}" loop muted preload="metadata"></video>` : '';
        return /* html */ `
            ${videoEl}

            <div class="pp-filename"></div>

            <div id="progress-bar-default" class="progress-bar-interact-zone">
                <div class="pp-markers-layer"></div>
                <div class="progress-bar-wrapper">
                    <div class="progress-bar"></div>
                </div>
            </div>

            <div class="pp-seek-osd"><div class="pp-seek-osd-fill"></div></div>

            <div class="pp-subtitle-overlay">
                <div class="pp-subtitle-text" style="display:none"></div>
            </div>

            <div class="controls-bar">
                <div class="controls-left">
                    <button class="pp-play-btn" title="Play/Pause">▶</button>
                    <div class="pp-volume-control">
                        <span class="pp-volume-icon">🔊</span>
                        <input class="pp-volume-slider" type="range" min="0" max="100" value="100" title="Volume" />
                    </div>
                    <div class="time-duration-container">
                        <div class="current">00:00</div>
                        <span>/</span>
                        <div class="duration">00:00</div>
                    </div>
                </div>
                <div class="controls-right">
                    <div class="pp-subtitle-control">
                        <button class="pp-subtitle-btn" title="Subtitles">CC</button>
                        <div class="pp-subtitle-menu" style="display:none"></div>
                    </div>
                    <button class="pp-fullscreen-btn" title="Toggle Fullscreen">⛶</button>
                </div>
            </div>

            <div class="pp-osd-message"></div>

            <div class="pp-volume-osd">
                <span class="pp-volume-osd-label"></span>
                <div class="pp-volume-osd-fill"></div>
            </div>

            <div class="play-pause-indicator">
                <svg class="pp-icon pause-icon" width="64px" height="64px" viewBox="-1 0 8 8" version="1.1" xmlns="http://www.w3.org/2000/svg">
                    <g fill="none" fill-rule="evenodd"><g transform="translate(-227 -3765)" fill="#000"><g transform="translate(56 160)">
                        <path d="M172,3605 C171.448,3605 171,3605.448 171,3606 L171,3612 C171,3612.552 171.448,3613 172,3613 C172.552,3613 173,3612.552 173,3612 L173,3606 C173,3605.448 172.552,3605 172,3605 M177,3606 L177,3612 C177,3612.552 176.552,3613 176,3613 C175.448,3613 175,3612.552 175,3612 L175,3606 C175,3605.448 175.448,3605 176,3605 C176.552,3605 177,3605.448 177,3606"/>
                    </g></g></g>
                </svg>
                <svg class="pp-icon play-icon" width="64px" height="64px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M21.4086 9.35258C23.5305 10.5065 23.5305 13.4935 21.4086 14.6474L8.59662 21.6145C6.53435 22.736 4 21.2763 4 18.9671L4 5.0329C4 2.72368 6.53435 1.26402 8.59661 2.38548L21.4086 9.35258Z" fill="#1C274C"/>
                </svg>
            </div>

            <div id="seek-thumbs-container">
                <div class="time"></div>
                <div class="seek-thumbnail"></div>
            </div>

            <div class="pp-keybinds-overlay">
                ${this._buildKeybindOverlayHTML()}
            </div>
        `;
    }

    _buildKeybindOverlayHTML() {
        const keyLabel = (k) => `<span class="pp-kbd">${k}</span>`;
        const keys = (arr) => arr.map(keyLabel).join('');
        const row = (ks, desc) => `<div class="pp-keybinds-row"><div class="pp-keybinds-keys">${keys(ks)}</div><div class="pp-keybinds-desc">${desc}</div></div>`;
        const group = (title, rows) => `<div class="pp-keybinds-group"><div class="pp-keybinds-group-title">${title}</div>${rows}</div>`;

        const overlayKey = (this._controlsOverlayKey || 't').toUpperCase();

        return `<div class="pp-keybinds-content">
            <h2>Keyboard Shortcuts</h2>
            ${group('Seek', [
                row(['A','←','J'], 'Back 7s'),
                row(['Shift+A','Shift+←'], 'Back 2s'),
                row(['Q'], 'Back 45s'),
                row(['D','→','L'], 'Forward 7s'),
                row(['Shift+D','Shift+→'], 'Forward 2s'),
                row(['E'], 'Forward 45s'),
                row(['1–9'], 'Jump to 10%–90%'),
                row(['0'], 'Jump to start'),
                row(['Home'], 'Back to start'),
            ].join(''))}
            ${group('Playback', [
                row(['S','Space','K'], 'Play / Pause'),
                row(['F'], 'Toggle fullscreen'),
                row(['X'], 'Frame forward'),
                row(['Z'], 'Frame back'),
                row(['Shift+X'], 'Speed +0.25×'),
                row(['Shift+Z'], 'Speed −0.25×'),
            ].join(''))}
            ${group('Volume', [
                row(['Shift+W','↑'], 'Volume +5%'),
                row(['Shift+S','↓'], 'Volume −5%'),
                row(['W','M'], 'Toggle mute'),
            ].join(''))}
            ${group('Markers', [
                row(['R'], 'Add marker at current position'),
                row(['R', 'R'], 'Remove nearest marker'),
                row(['Shift+E'], 'Jump to next marker'),
                row(['Shift+Q'], 'Jump to previous marker'),
            ].join(''))}
            ${group('Playheads', [
                row(['C'], 'Add playhead at current position'),
                row(['C', '(hold)'], 'Delete nearest playhead'),
                row(['Ctrl+N'], 'Cycle to next playhead'),
                row(['Ctrl+Shift+N'], 'Cycle to previous playhead'),
            ].join(''))}
            ${group('Filters', [
                row(['G'], 'Cycle CSS filter (HTML5 mode)'),
                row(['H'], 'Cycle mpv video preset →'),
                row(['Shift+H'], 'Cycle mpv video preset ←'),
                row(['Ctrl+Shift+Scroll'], 'Adjust seek thumbnail size'),
            ].join(''))}
            ${group('Interface', [
                row([overlayKey], 'Toggle this overlay'),
            ].join(''))}
            <p class="pp-keybinds-dismiss">Press <kbd>${overlayKey}</kbd> to close</p>
        </div>`;
    }

    // ====================================================================================================
    // Keybinds
    // ====================================================================================================

    addKeybinds() {
        const overlayKey = this._controlsOverlayKey || 't';
        const KEYBINDS = {
            'back-7s':               ['a', 'leftArrow', 'j'],
            'back-2s':               ['shift-a', 'shift-leftArrow'],
            'back-45s':              'q',
            'forward-7s':            ['d', 'rightArrow', 'l'],
            'forward-2s':            ['shift-d', 'shift-rightArrow'],
            'forward-45s':           'e',
            'togglePlayback':        ['s', 'space', 'k'],
            'toggleFullscreen':      'f',
            'cycleCssFilter':        'g',
            'cycleMpvPreset':        'h',
            'cycleMpvPresetBack':    'shift-h',
            'volumeUp':              ['shift-w', 'upArrow'],
            'volumeDown':            ['shift-s', 'downArrow'],
            'toggleMute':            ['w', 'm'],
            'forward-1frame':        'x',
            'back-1frame':           'z',
            'increasePlaybackSpeed': 'shift-x',
            'decreasePlaybackSpeed': 'shift-z',
            'seek-pct':              '__digits__',
            'seekToStart':           'home',
            'toggleKeybindsOverlay': overlayKey,
            // Phase 2:
            'addMarker':             'r',
            'removeMarker':          'r+r',
            'cycleMarkerNext':       'shift-e',
            'cycleMarkerPrev':       'shift-q',
            'spawnNewPlayhead':      'c',
            'deleteCurrentPlayhead': 'c[hold]',
            'cyclePlayheadNext':     'ctrl-n',
            'cyclePlayheadPrev':     'ctrl-shift-n',
            'addLoopPoint':          'v',
            'removeLoopPoint':       'v+v',
            'toggleLooping':         'shift-v',
        };

        this._keybindEngine = new KeybindEngine(KEYBINDS, (action, extras) => this._handleAction(action, extras));
    }

    _handleAction(action, { digit } = {}) {
        const dur = this.video ? this.video.duration : this._duration;
        const cur = this.video ? this.video.currentTime : this._currentTime;
        const pb = this.shadow?.querySelector('#progress-bar-default .progress-bar');

        const seekDelta = (s) => {
            if (!dur || !pb) return;
            const frac = Math.max(0, Math.min(1, (cur + s) / dur));
            this.setPlaybackTime(frac, pb);
            this.showOSD(s > 0 ? `Forward ${Math.abs(s)}s` : `Back ${Math.abs(s)}s`);
            this._showSeekOSD();
        };

        switch (action) {
            case 'togglePlayback':        this.togglePlayback(); break;
            case 'toggleFullscreen':      this.toggleFullscreen(); break;
            case 'back-7s':               seekDelta(-7);  break;
            case 'back-2s':               seekDelta(-2);  break;
            case 'back-45s':              seekDelta(-45); break;
            case 'forward-7s':            seekDelta(7);   break;
            case 'forward-2s':            seekDelta(2);   break;
            case 'forward-45s':           seekDelta(45);  break;
            case 'seekToStart':
                if (pb) { this.setPlaybackTime(0, pb); this.showOSD('Back to start'); this._showSeekOSD(); }
                break;
            case 'seek-pct': {
                if (!pb || !dur) break;
                const frac = ((digit ?? 0) * 10) / 100;
                this.setPlaybackTime(frac, pb);
                this.showOSD(`${(digit ?? 0) * 10}%`);
                this._showSeekOSD();
                break;
            }
            case 'volumeUp':              this._changeVolume(+5);  break;
            case 'volumeDown':            this._changeVolume(-5);  break;
            case 'toggleMute':            this._toggleMute();      break;
            case 'forward-1frame':        this._frameStep(+1);     break;
            case 'back-1frame':           this._frameStep(-1);     break;
            case 'increasePlaybackSpeed': this._changeSpeed(+0.25); break;
            case 'decreasePlaybackSpeed': this._changeSpeed(-0.25); break;
            case 'toggleKeybindsOverlay': this._toggleKeybindsOverlay(); break;
            case 'cycleCssFilter':        this._cycleCssFilter(+1);  break;
            case 'cycleMpvPreset':        this._cycleMpvPreset(+1);  break;
            case 'cycleMpvPresetBack':    this._cycleMpvPreset(-1);  break;
            case 'addMarker':             this._addMarker();          break;
            case 'removeMarker':          this._removeNearestMarker(); break;
            case 'cycleMarkerNext':       this._cycleMarker(+1);      break;
            case 'cycleMarkerPrev':       this._cycleMarker(-1);      break;
            case 'spawnNewPlayhead':      this._spawnPlayhead();      break;
            case 'deleteCurrentPlayhead': this._deleteCurrentPlayhead(); break;
            case 'cyclePlayheadNext':     this._cyclePlayhead(+1);    break;
            case 'cyclePlayheadPrev':     this._cyclePlayhead(-1);    break;
            // silent no-ops (future)
            case 'addLoopPoint': case 'removeLoopPoint': case 'toggleLooping':
                break;
        }
    }

    _changeVolume(delta) {
        const newVol = Math.max(0, Math.min(100, this._volume + delta));
        this._volume = newVol;
        if (this._muted && delta > 0) this._muted = false;
        const effectiveVol = this._muted ? 0 : newVol;
        this.onVolumeChange?.(effectiveVol);
        if (this.video) this.video.volume = effectiveVol / 100;
        this.updateVolumeIcon(effectiveVol);
        const slider = this.$('.pp-volume-slider');
        if (slider) slider.value = newVol;
        this.showOSD(this._muted ? 'Muted' : `Volume: ${Math.round(newVol)}%`);
        this._showVolumeOSD(effectiveVol);
    }

    _toggleMute() {
        this._muted = !this._muted;
        const vol = this._muted ? 0 : this._volume;
        this.onVolumeChange?.(vol);
        if (this.video) this.video.muted = this._muted;
        this.updateVolumeIcon(vol);
        this.showOSD(this._muted ? 'Muted' : 'Unmuted');
        this._showVolumeOSD(vol);
    }

    _frameStep(dir) {
        if (this.onFrameStep) {
            this.onFrameStep(dir);
        }
        // HTML5: no native single-frame step without knowing FPS
        this.showOSD(dir > 0 ? 'Frame forward' : 'Frame back');
    }

    _changeSpeed(delta) {
        this._playbackSpeed = Math.max(0.1, Math.min(5.0, parseFloat((this._playbackSpeed + delta).toFixed(2))));
        if (this.onSpeedChange) {
            this.onSpeedChange(this._playbackSpeed);
        } else if (this.video) {
            this.video.playbackRate = this._playbackSpeed;
        }
        this.showOSD(`Speed: ${this._playbackSpeed.toFixed(2)}×`);
    }

    _toggleKeybindsOverlay() {
        this._keybindOverlayVisible = !this._keybindOverlayVisible;
        const overlay = this.$('.pp-keybinds-overlay');
        if (overlay) overlay.style.display = this._keybindOverlayVisible ? 'flex' : 'none';
    }

    // ── CSS / mpv filters ────────────────────────────────────────────────────

    _cycleCssFilter(dir) {
        this._cssFilterIndex = (this._cssFilterIndex + dir + _CSS_FILTERS.length) % _CSS_FILTERS.length;
        const preset = _CSS_FILTERS[this._cssFilterIndex];
        if (this.video) this.video.style.filter = preset.filter;
        this.onCssFilterChange?.(preset.filter, preset.name);
        this.showOSD(`Filter: ${preset.name}`);
    }

    _cycleMpvPreset(dir) {
        this._mpvPresetIndex = (this._mpvPresetIndex + dir + _MPV_PRESETS.length) % _MPV_PRESETS.length;
        const preset = _MPV_PRESETS[this._mpvPresetIndex];
        this.onMpvFilterChange?.(preset.vf, preset.name);
        this.showOSD(`mpv: ${preset.name}`);
    }

    // ── Markers ──────────────────────────────────────────────────────────────

    _addMarker() {
        const time = this.video ? this.video.currentTime : this._currentTime;
        const n = ++this._markerCounter;
        this._markers.push({ id: n, time, name: `Marker ${n}` });
        this._markers.sort((a, b) => a.time - b.time);
        this._renderMarkers();
        this.showOSD(`Marker ${n} added`);
    }

    _removeNearestMarker() {
        if (!this._markers.length) { this.showOSD('No markers'); return; }
        const cur = this.video ? this.video.currentTime : this._currentTime;
        let nearest = null, minDist = Infinity;
        for (const m of this._markers) {
            const d = Math.abs(m.time - cur);
            if (d < minDist) { minDist = d; nearest = m; }
        }
        if (nearest) {
            this._markers = this._markers.filter(m => m.id !== nearest.id);
            this._renderMarkers();
            this.showOSD(`${nearest.name} removed`);
        }
    }

    _renderMarkers() {
        const layer = this.$('.pp-markers-layer');
        if (!layer) return;
        layer.querySelectorAll('.pp-marker').forEach(el => el.remove());
        const dur = this.video ? this.video.duration : this._duration;
        if (!dur) return;
        for (const m of this._markers) {
            const el = document.createElement('div');
            el.className = 'pp-marker';
            el.style.left = (m.time / dur * 100) + '%';
            const label = document.createElement('span');
            label.className = 'pp-marker-label';
            label.textContent = m.name;
            el.appendChild(label);
            layer.appendChild(el);
        }
    }

    _cycleMarker(dir) {
        if (!this._markers.length) { this.showOSD('No markers'); return; }
        const cur = this.video ? this.video.currentTime : this._currentTime;
        let target;
        if (dir > 0) {
            target = this._markers.find(m => m.time > cur + 0.1) ?? this._markers[0];
        } else {
            target = [...this._markers].reverse().find(m => m.time < cur - 0.1) ?? this._markers[this._markers.length - 1];
        }
        const dur = this.video ? this.video.duration : this._duration;
        if (!dur) return;
        const pb = this.$('#progress-bar-default .progress-bar');
        this.setPlaybackTime(target.time / dur, pb);
        this.showOSD(target.name);
        this._showSeekOSD();
    }

    // ── Playheads ────────────────────────────────────────────────────────────

    _spawnPlayhead() {
        if (this._playheads.length >= 10) { this.showOSD('Max 9 playheads'); return; } // 1 roaming + 9 static
        const time = this.video ? this.video.currentTime : this._currentTime;
        this._playheads.push({ id: ++this._playheadCounter, time });
        this._activePlayheadIndex = this._playheads.length - 1;
        this._renderPlayheads();
        this.showOSD(`+Playhead (${this._playheads.length - 1})`);
    }

    _deleteCurrentPlayhead() {
        const idx = this._activePlayheadIndex;
        if (idx === 0 || this._playheads.length <= 1) { this.showOSD('No playhead to delete'); return; }
        this._playheads.splice(idx, 1);
        // Move to last static playhead (or roaming if none left)
        this._activePlayheadIndex = Math.max(0, this._playheads.length - 1);
        const ph = this._playheads[this._activePlayheadIndex];
        const dur = this.video ? this.video.duration : this._duration;
        if (dur > 0 && this._activePlayheadIndex > 0) {
            const pb = this.$('#progress-bar-default .progress-bar');
            this.setPlaybackTime(ph.time / dur, pb);
            this._showSeekOSD();
        }
        this._renderPlayheads();
        this.showOSD('Playhead removed');
    }

    _cyclePlayhead(dir) {
        const count = this._playheads.length - 1; // static playheads only (skip roaming at 0)
        if (count === 0) { this.showOSD('No playheads set — press C'); return; }
        const current = Math.max(1, this._activePlayheadIndex);
        this._activePlayheadIndex = ((current - 1 + dir + count) % count) + 1;
        const ph = this._playheads[this._activePlayheadIndex];
        const dur = this.video ? this.video.duration : this._duration;
        if (!dur) return;
        const pb = this.$('#progress-bar-default .progress-bar');
        this.setPlaybackTime(ph.time / dur, pb);
        this._showSeekOSD();
    }

    _renderPlayheads() {
        const layer = this.$('.pp-markers-layer');
        if (!layer) return;
        layer.querySelectorAll('.pp-playhead').forEach(el => el.remove());
        const dur = this.video ? this.video.duration : this._duration;
        if (!dur) return;
        for (let i = 0; i < this._playheads.length; i++) {
            const el = document.createElement('div');
            el.className = 'pp-playhead';
            if (i === 0) el.dataset.roaming = '';
            el.style.left = (this._playheads[i].time / dur * 100) + '%';
            layer.appendChild(el);
        }
    }

    // ── Thumbnail size ───────────────────────────────────────────────────────

    _adjustThumbSize(delta) {
        const next = Math.round((this._thumbSizeMultiplier + delta) * 10) / 10;
        this.setThumbnailSize(next);
        this.showOSD(`Thumb: ${Math.round(this._thumbSizeMultiplier * 100)}%`);
    }

    _updateThumbSize() {
        const cont = this.$('#seek-thumbs-container');
        if (!cont) return;
        const newH = Math.round(200 * this._thumbSizeMultiplier);
        cont.style.height = newH + 'px';
        if (this.seekThumbsSprites) {
            const holder = cont.querySelector('.seek-thumbnail');
            if (holder) holder.style.width = (this.seekThumbsSprites[0].w / this.seekThumbsSprites[0].h * newH) + 'px';
        }
    }

    // ====================================================================================================
    // OSD
    // ====================================================================================================

    showOSD(text) {
        if (!this.shadow) return;
        const el = this.$('.pp-osd-message');
        if (!el) return;
        el.textContent = text;
        el.style.opacity = '1';
        clearTimeout(this._osdTimer);
        this._osdTimer = setTimeout(() => { el.style.opacity = '0'; }, 1800);
    }

    _showSeekOSD() {
        if (!this.shadow || this._controlsVisible) return;
        const osd = this.$('.pp-seek-osd');
        const fill = this.$('.pp-seek-osd-fill');
        if (!osd || !fill) return;
        const dur = this.video ? this.video.duration : this._duration;
        const cur = this.video ? this.video.currentTime : this._currentTime;
        if (dur > 0) fill.style.width = (cur / dur * 100) + '%';
        osd.style.opacity = '1';
        clearTimeout(this._seekOsdTimer);
        this._seekOsdTimer = setTimeout(() => { osd.style.opacity = '0'; }, 1500);
    }

    _showVolumeOSD(vol) {
        if (!this.shadow || this._controlsVisible) return;
        const osd = this.$('.pp-volume-osd');
        const fill = this.$('.pp-volume-osd-fill');
        const label = this.$('.pp-volume-osd-label');
        if (!osd || !fill) return;
        fill.style.height = vol + '%';
        if (label) label.textContent = Math.round(vol) + '%';
        osd.style.opacity = '1';
        clearTimeout(this._volumeOsdTimer);
        this._volumeOsdTimer = setTimeout(() => { osd.style.opacity = '0'; }, 1500);
    }

    // ====================================================================================================
    // Seek Thumbs
    // ====================================================================================================

    _updateSeekThumbnail(mouse_x, video_perc) {
        if (!this.seekThumbsContainer) return;
        const cont = this.seekThumbsContainer;
        cont.style.display = '';
        const cont_wid = parseInt(getComputedStyle(cont).width);
        let x_translate = mouse_x - cont_wid / 2;
        const padding = 8;
        x_translate = Math.max(x_translate, padding);
        x_translate = Math.min(x_translate, document.documentElement.clientWidth - cont_wid - padding);
        cont.style.left = x_translate + 'px';
        const holder = cont.querySelector('.seek-thumbnail');
        const scaleFactor = parseInt(getComputedStyle(holder).height) / this.seekThumbsSprites[0].h;
        holder.style.backgroundSize = `${this.seekThumbsSpritesheetSize.w * scaleFactor}px ${this.seekThumbsSpritesheetSize.h * scaleFactor}px`;
        const thumbIndex = Math.floor((video_perc / 100) * this.seekThumbsSprites.length);
        const sprite = this.seekThumbsSprites[Math.min(thumbIndex, this.seekThumbsSprites.length - 1)];
        holder.style.backgroundPosition = `-${sprite.x * scaleFactor}px -${sprite.y * scaleFactor}px`;
        const duration = this.video ? this.video.duration : this._duration;
        const timeEl = this.$('#seek-thumbs-container .time');
        if (timeEl) timeEl.textContent = this._formatTime((duration * video_perc) / 100);
    }

    _hideSeekThumbnail() {
        if (this.seekThumbsContainer) this.seekThumbsContainer.style.display = 'none';
    }

    setSeekThumbs(vttContent, spritesheetDataURL) {
        const sprites = this._parseVTT(vttContent);
        if (!sprites.length) return;
        this.seekThumbsSprites = null;
        this.seekThumbsContainer = null;
        this.seekThumbsSpritesheetSize = null;
        const img = new Image();
        img.onload = () => {
            const cont = this.shadow?.querySelector('#seek-thumbs-container');
            if (!cont) return;
            const holder = cont.querySelector('.seek-thumbnail');
            this.seekThumbsSpritesheetSize = { w: img.naturalWidth, h: img.naturalHeight };
            holder.style.backgroundImage = `url("${spritesheetDataURL}")`;
            holder.style.backgroundRepeat = 'no-repeat';
            holder.style.width = (sprites[0].w / sprites[0].h * (holder.clientHeight || 200)) + 'px';
            cont.style.visibility = 'visible';
            cont.style.display = 'none';
            this.seekThumbsSprites = sprites;
            this.seekThumbsContainer = cont;
        };
        img.src = spritesheetDataURL;
    }

    _parseVTT(vttText) {
        const sprites = [];
        for (const line of vttText.split('\n')) {
            if (line.includes('xywh=')) {
                const coords = line.split('xywh=')[1].split(',');
                if (coords.length === 4) {
                    sprites.push({ x: parseInt(coords[0]), y: parseInt(coords[1]), w: parseInt(coords[2]), h: parseInt(coords[3]) });
                }
            }
        }
        return sprites;
    }

    // ====================================================================================================
    // Public API
    // ====================================================================================================

    setState({ currentTime, duration, paused, volume, speed, muted } = {}) {
        if (currentTime !== undefined) { this._currentTime = currentTime; this._rafLastTs = performance.now(); }
        if (duration !== undefined) this._duration = duration;
        if (paused !== undefined) {
            this._paused = paused;
            if (!paused) this._ensureRaf(); else this._stopRaf();
            // If an external event paused the video and controls are hidden, show them
            if (this.shadow && paused && !this._controlsVisible) {
                clearTimeout(this._hideTimer);
                this._showControls();
            }
        }
        if (volume !== undefined) this._volume = volume;
        if (muted !== undefined) this._muted = muted;
        if (speed !== undefined) this._playbackSpeed = speed;

        if (!this.shadow) return;

        if (currentTime !== undefined || duration !== undefined) this._updateProgressDisplay();

        const durationEl = this.$('.time-duration-container .duration');
        if (durationEl) durationEl.textContent = this._formatTime(this._duration);

        if (paused !== undefined) this.updatePlayBtn();

        if (volume !== undefined) {
            const slider = this.$('.pp-volume-slider');
            if (slider) slider.value = volume;
            this.updateVolumeIcon(this._muted ? 0 : volume);
        }
    }

    setTitle(title) {
        this._filenameText = title;
        const el = this.$('.pp-filename');
        if (el) el.textContent = title;
    }

    setClickToTogglePlayback(enabled) {
        this._clickToTogglePlayback = enabled;
    }

    setThumbnailSize(mult) {
        this._thumbSizeMultiplier = Math.max(0.4, Math.min(3.0, mult));
        this._updateThumbSize();
        this.onThumbnailSizeChange?.(this._thumbSizeMultiplier);
    }

    getThumbnailSize() { return this._thumbSizeMultiplier; }

    setKeybindsEnabled(enabled) {
        if (enabled && !this._keybindEngine) {
            this.addKeybinds();
        } else if (!enabled && this._keybindEngine) {
            this._keybindEngine.destroy();
            this._keybindEngine = null;
        }
    }

    _stopRaf() {
        if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    }

    _ensureRaf() {
        if (this._rafId || this._paused || this._destroyed || !this.shadow) return;
        this._rafLastTs = performance.now();
        const tick = (ts) => {
            this._rafId = null;
            if (this._paused || this._destroyed) return;
            const delta = Math.min((ts - this._rafLastTs) / 1000, 0.5);
            this._rafLastTs = ts;
            if (this._duration > 0) this._currentTime = Math.min(this._currentTime + delta, this._duration);
            this._updateProgressDisplay();
            this._rafId = requestAnimationFrame(tick);
        };
        this._rafId = requestAnimationFrame(tick);
    }

    _updateProgressDisplay() {
        if (!this.shadow) return;
        if (this._duration > 0) {
            const perc = (this._currentTime / this._duration) * 100;
            const progressBar = this.$('#progress-bar-default .progress-bar');
            if (progressBar) progressBar.style.width = perc + '%';
            // Update roaming playhead (index 0) live
            this._playheads[0].time = this._currentTime;
            const roaming = this.$('.pp-playhead[data-roaming]');
            if (roaming) roaming.style.left = perc + '%';
            // Full re-render only when duration changes
            if (this._duration !== this._lastRenderedDuration) {
                this._lastRenderedDuration = this._duration;
                this._renderMarkers();
                this._renderPlayheads();
            }
        }
        const currentEl = this.$('.time-duration-container .current');
        if (currentEl) currentEl.textContent = this._formatTime(this._currentTime);
    }

    // ====================================================================================================
    // Helpers
    // ====================================================================================================

    $(sel) { return this.shadow.querySelector(sel); }
    $$(sel) { return Array.from(this.shadow.querySelectorAll(sel)); }
    log(msg) { if (!this.quiet) console.log(msg); }

    setPlaybackTime(perc, progress_bar) {
        if (this.video) {
            this.video.currentTime = this.video.duration * perc;
        } else {
            this._currentTime = perc * this._duration;
            this._rafLastTs = performance.now();
            this.onSeek?.(perc);
        }
        if (progress_bar) progress_bar.style.width = `${perc * 100}%`;
    }

    togglePlayback() {
        console.debug(`[PP:togglePlayback] @ ${Date.now()} _paused=${this._paused}`);
        if (this.video) {
            this.video.paused ? this.playVideo() : this.pauseVideo();
        } else {
            if (this._paused) {
                this.onPlay?.();
                this.flashPPIndicator('.play-icon');
                this._resetHideTimer();
            } else {
                this.onPause?.();
                this.flashPPIndicator('.pause-icon');
                clearTimeout(this._hideTimer);
                this._showControls();
            }
            this._paused = !this._paused;
            this.updatePlayBtn();
        }
    }

    pauseVideo() { this.video.pause(); this.flashPPIndicator('.pause-icon'); this.updatePlayBtn(); this._showControls(); }
    playVideo()  { this.video.play();  this.flashPPIndicator('.play-icon');  this.updatePlayBtn(); }

    updatePlayBtn() {
        const btn = this.$('.pp-play-btn');
        if (!btn) return;
        const paused = this.video ? this.video.paused : this._paused;
        btn.textContent = paused ? '▶' : '⏸';
    }

    updateVolumeIcon(vol) {
        const icon = this.$('.pp-volume-icon');
        if (!icon) return;
        if (vol === 0) icon.textContent = '🔇';
        else if (vol < 50) icon.textContent = '🔉';
        else icon.textContent = '🔊';
    }

    flashPPIndicator(selector) {
        ['.play-icon', '.pause-icon'].forEach(sel => {
            const el = this.$(sel);
            if (!el) return;
            el.classList.remove('shown');
            if (el._hideTimer) { clearTimeout(el._hideTimer); el._hideTimer = null; }
            el.style.display = 'none';
        });
        const flash_icon = this.$(selector);
        if (!flash_icon) return;
        flash_icon.style.display = 'block';
        void flash_icon.offsetWidth;
        flash_icon.classList.add('shown');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                flash_icon.classList.remove('shown');
                flash_icon._hideTimer = setTimeout(() => { flash_icon.style.display = 'none'; }, 500);
            });
        });
    }

    toggleFullscreen() {
        if (this.onFullscreen) { this.onFullscreen(); return; }
        const container = this.video ? this.video.parentElement : this.root_element;
        if (!document.fullscreenElement) container.requestFullscreen().catch(console.error);
        else document.exitFullscreen();
    }

    // ====================================================================================================
    // Subtitles
    // ====================================================================================================

    setSubtitleState(text, tracks, activeSid) {
        this._subtitleText = text ?? '';
        this._subtitleTracks = tracks ?? [];
        this._activeSid = activeSid ?? 0;
        const textEl = this.$('.pp-subtitle-text');
        if (textEl) { textEl.textContent = this._subtitleText; textEl.style.display = this._subtitleText ? '' : 'none'; }
        this._updateSubtitleBtn();
        if (this._subtitleMenuOpen) this._updateSubtitleMenu();
    }

    _addSubtitleEventListeners() {
        const btn = this.$('.pp-subtitle-btn');
        if (!btn) return;
        btn.addEventListener('click', (e) => { e.stopPropagation(); this._toggleSubtitleMenu(); });
        const player = this.$('.PassionPlayer');
        if (player) {
            player.addEventListener('click', (e) => {
                if (!e.target.closest('.pp-subtitle-control')) this._closeSubtitleMenu();
            });
        }
    }

    _toggleSubtitleMenu() { this._subtitleMenuOpen ? this._closeSubtitleMenu() : this._openSubtitleMenu(); }

    _openSubtitleMenu() {
        const menu = this.$('.pp-subtitle-menu');
        if (!menu) return;
        this._subtitleMenuOpen = true;
        this._updateSubtitleMenu();
        menu.style.display = '';
    }

    _closeSubtitleMenu() {
        const menu = this.$('.pp-subtitle-menu');
        if (!menu) return;
        this._subtitleMenuOpen = false;
        menu.style.display = 'none';
    }

    _updateSubtitleMenu() {
        const menu = this.$('.pp-subtitle-menu');
        if (!menu) return;
        const subTracks = this._subtitleTracks.filter(t => t.type === 'sub');
        const offActive = this._activeSid === 0;
        let html = `<div class="pp-subtitle-menu-item" data-sid="0"><span class="check">${offActive ? '✓' : ''}</span>Off</div>`;
        for (const track of subTracks) {
            const isActive = track.id === this._activeSid;
            const label = track.title || track.lang || `Track ${track.id}${track.codec ? ' (' + track.codec + ')' : ''}`;
            const extSuffix = track.external && track.externalFilename ? ` [${this._basename(track.externalFilename)}]` : '';
            html += `<div class="pp-subtitle-menu-item" data-sid="${track.id}"><span class="check">${isActive ? '✓' : ''}</span>${label}${extSuffix}</div>`;
        }
        html += `<div class="pp-subtitle-menu-separator"></div>`;
        html += `<div class="pp-subtitle-menu-item pp-subtitle-add" data-action="add"><span class="check"></span>Add subtitle file...</div>`;
        menu.innerHTML = html;
        menu.querySelectorAll('.pp-subtitle-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                if (item.dataset.action === 'add') {
                    this._closeSubtitleMenu();
                    this.onAddSubtitleFile?.();
                } else {
                    const sid = parseInt(item.dataset.sid, 10);
                    this._activeSid = sid;
                    this._closeSubtitleMenu();
                    this._updateSubtitleBtn();
                    this.onSubtitleChange?.(sid);
                }
            });
        });
    }

    _updateSubtitleBtn() {
        const btn = this.$('.pp-subtitle-btn');
        if (!btn) return;
        btn.classList.toggle('active', this._activeSid > 0);
    }

    _basename(path) {
        if (!path) return '';
        return path.split(/[\\/]/).pop();
    }

    _formatTime(seconds_float) {
        if (!seconds_float || isNaN(seconds_float)) return '00:00';
        const hours = Math.floor(seconds_float / 3600);
        const minutes = Math.floor((seconds_float - hours * 3600) / 60);
        const seconds = Math.floor(seconds_float - hours * 3600 - minutes * 60);
        const pad = (n) => n.toString().padStart(2, '0');
        let fmt = pad(minutes) + ':' + pad(seconds);
        if (hours > 0) fmt = pad(hours) + ':' + fmt;
        return fmt;
    }

    // ====================================================================================================
    // CSS
    // ====================================================================================================

    _getStyles() {
        return /* css */ `

.PassionPlayer {
    height: 100%;
    width: 100%;
    background: transparent;
    display: flex;
    justify-content: center;
    position: relative;
    font-family: Nunito, sans-serif;
}

video {
    height: 100%;
    width: 100%;
    cursor: pointer;
    user-drag: none;
    -webkit-user-drag: none;
    user-select: none;
}

/* FILENAME BAR */

.pp-filename {
    position: absolute;
    top: 0;
    left: 0;
    max-width: calc(100% - 20px);
    padding: 5px 10px;
    background: rgba(0,0,0,0.55);
    color: #fff;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
    z-index: 10;
    opacity: 0;
    transition: opacity 500ms ease;
    border-radius: 0 0 6px 0;
}

/* PROGRESS BAR */

#progress-bar-default {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 12px;
    cursor: pointer;
    transition: opacity 500ms ease;
}

.progress-bar-wrapper {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 5px;
}

.progress-bar {
    height: 100%;
    width: 0;
    background: #e8d5b0;
}

/* CONTROLS BAR */

.controls-bar {
    position: absolute;
    bottom: 28px;
    left: 8px;
    right: 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    pointer-events: none;
    transition: opacity 500ms ease;
}

.controls-left {
    display: flex;
    align-items: center;
    gap: 6px;
    pointer-events: auto;
}

.controls-right {
    display: flex;
    align-items: center;
    gap: 6px;
    pointer-events: auto;
}

.time-duration-container {
    display: flex;
    align-items: center;
    gap: 4px;
    background: #0007;
    border: 1px solid #fff3;
    border-radius: 6px;
    padding: 0 8px;
    height: 36px;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

/* PLAY/PAUSE INDICATOR */

.play-pause-indicator {
    width: fit-content;
    height: fit-content;
    position: absolute;
    top: calc(50% - 24px);
    left: calc(50% - 24px);
    pointer-events: none;
}
.play-pause-indicator svg path { fill: #fffd; }
.pp-icon {
    display: none;
    opacity: 0;
    width: 48px;
    height: 48px;
    padding: 1.4rem;
    background: #0005;
    border-radius: 50%;
    border: 1px solid #fff4;
    transform-origin: center;
    transform: scale(110%);
    transition: opacity 500ms ease-out, transform 500ms ease-out;
}
.pp-icon.shown {
    opacity: 1;
    transform: scale(80%);
    transition: none;
}

/* SEEK THUMBS */

#seek-thumbs-container {
    visibility: hidden;
    position: absolute;
    bottom: 5rem;
    left: 0;
    height: 200px;
    width: fit-content;
    background: #222;
    border: 1px solid #bbb;
    border-radius: 8px;
    overflow: hidden;
}
.seek-thumbnail { height: 100%; }

/* PLAY BUTTON */

.pp-play-btn {
    width: 36px;
    height: 36px;
    background: #0007;
    border: 1px solid #fff3;
    border-radius: 6px;
    color: white;
    font-size: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 150ms;
    flex-shrink: 0;
}
.pp-play-btn:hover { background: #000b; }

/* FULLSCREEN BUTTON */

.pp-fullscreen-btn {
    width: 36px;
    height: 36px;
    background: #0007;
    border: 1px solid #fff3;
    border-radius: 6px;
    color: white;
    font-size: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 150ms;
    flex-shrink: 0;
}
.pp-fullscreen-btn:hover { background: #000b; }

/* VOLUME CONTROL */

.pp-volume-control {
    display: flex;
    align-items: center;
    gap: 4px;
    background: #0007;
    border: 1px solid #fff3;
    border-radius: 6px;
    padding: 0 8px;
    height: 36px;
}
.pp-volume-icon {
    font-size: 14px;
    line-height: 1;
    cursor: default;
    user-select: none;
}
.pp-volume-slider {
    -webkit-appearance: none;
    appearance: none;
    width: 72px;
    height: 4px;
    border-radius: 2px;
    background: #fff5;
    outline: none;
    cursor: pointer;
}
.pp-volume-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #fff;
    cursor: pointer;
}
.pp-volume-slider::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #fff;
    cursor: pointer;
    border: none;
}

/* SEEK THUMB TIME */

#seek-thumbs-container .time {
    position: absolute;
    left: 3px;
    font-size: 12px;
    padding: 1px 5px;
    background: #0008;
    border-radius: 3px;
    color: #fff;
}

/* SUBTITLE OVERLAY */

.pp-subtitle-overlay {
    position: absolute;
    bottom: 60px;
    left: 0;
    right: 0;
    display: flex;
    justify-content: center;
    align-items: flex-end;
    pointer-events: none;
}
.pp-subtitle-text {
    background: rgba(0,0,0,0.75);
    color: #fff;
    font-size: 18px;
    line-height: 1.4;
    padding: 4px 14px;
    border-radius: 4px;
    max-width: 80%;
    text-align: center;
    white-space: pre-line;
}

/* SUBTITLE BUTTON */

.pp-subtitle-control { position: relative; }
.pp-subtitle-btn {
    width: 36px;
    height: 36px;
    background: #0007;
    border: 1px solid #fff3;
    border-radius: 6px;
    color: #fff8;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 150ms, color 150ms;
    flex-shrink: 0;
    letter-spacing: -0.5px;
    font-family: inherit;
}
.pp-subtitle-btn:hover { background: #000b; color: #fff; }
.pp-subtitle-btn.active { color: #fff; border-color: #fff6; }

.pp-subtitle-menu {
    position: absolute;
    bottom: calc(100% + 6px);
    right: 0;
    background: rgba(20,20,20,0.95);
    border: 1px solid rgba(255,255,255,0.18);
    border-radius: 8px;
    min-width: 160px;
    max-width: 300px;
    overflow: hidden;
    z-index: 100;
    backdrop-filter: blur(8px);
}
.pp-subtitle-menu-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    color: #fff;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: background 100ms;
    font-family: inherit;
}
.pp-subtitle-menu-item:hover { background: rgba(255,255,255,0.1); }
.pp-subtitle-menu-item .check { width: 14px; font-size: 12px; flex-shrink: 0; color: #7af; }
.pp-subtitle-menu-separator { height: 1px; background: rgba(255,255,255,0.12); margin: 3px 0; }
.pp-subtitle-add { color: #aaa; }
.pp-subtitle-add:hover { color: #fff; }

/* OSD NOTIFICATION */

.pp-osd-message {
    position: absolute;
    bottom: 90px;
    left: 12px;
    background: rgba(0,0,0,0.65);
    color: #fff;
    font-size: 13px;
    padding: 3px 9px;
    border-radius: 4px;
    opacity: 0;
    transition: opacity 0.2s;
    pointer-events: none;
    z-index: 20;
    white-space: nowrap;
}

/* SEEK OSD FLASH */

.pp-seek-osd {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 52px;
    opacity: 0;
    transition: opacity 0.3s;
    pointer-events: none;
    z-index: 4;
}
.pp-seek-osd-fill {
    position: absolute;
    bottom: 0;
    left: 0;
    height: 100%;
    width: 0%;
    background: rgba(255,255,255,0.18);
    transition: width 0.1s;
}

/* VOLUME OSD */

.pp-volume-osd {
    position: absolute;
    right: 20px;
    top: 50%;
    transform: translateY(-50%);
    width: 8px;
    height: 120px;
    background: rgba(255,255,255,0.12);
    border-radius: 4px;
    opacity: 0;
    transition: opacity 0.3s;
    pointer-events: none;
    z-index: 20;
}
.pp-volume-osd-fill {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 0%;
    background: #fff;
    border-radius: 4px;
    transition: height 0.15s;
}
.pp-volume-osd-label {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    color: #fff;
    font-size: 11px;
    white-space: nowrap;
    margin-bottom: 4px;
}

/* MARKERS & PLAYHEADS */

.pp-markers-layer {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 3;
}
.pp-marker {
    position: absolute;
    bottom: 0;
    width: 3px;
    height: 10px;
    background: rgba(80, 150, 255, 0.9);
    transform: translateX(-50%);
    pointer-events: none;
    border-radius: 2px 2px 0 0;
}
.pp-marker-label {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    color: rgba(100, 170, 255, 0.9);
    font-size: 9px;
    white-space: nowrap;
    margin-bottom: 3px;
    pointer-events: none;
    user-select: none;
    line-height: 1;
    font-weight: 500;
}
.pp-playhead {
    position: absolute;
    bottom: 0;
    width: 3px;
    height: 8px;
    background: rgba(235, 228, 215, 0.55);
    transform: translateX(-50%);
    pointer-events: none;
    border-radius: 2px 2px 0 0;
}

/* KEYBINDS OVERLAY */

.pp-keybinds-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0,0,0,0.88);
    z-index: 50;
    display: none;
    align-items: flex-start;
    justify-content: center;
    overflow-y: auto;
    padding: 32px 16px;
}
.pp-keybinds-content {
    color: #fff;
    max-width: 520px;
    width: 100%;
}
.pp-keybinds-content h2 {
    margin: 0 0 20px;
    font-size: 17px;
    font-weight: 600;
    color: #fff;
}
.pp-keybinds-group {
    margin-bottom: 18px;
}
.pp-keybinds-group-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #666;
    margin-bottom: 6px;
    font-weight: 600;
}
.pp-keybinds-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 3px 0;
    font-size: 13px;
}
.pp-keybinds-keys {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
    min-width: 160px;
    flex-wrap: wrap;
    align-items: center;
}
.pp-kbd {
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.18);
    border-radius: 4px;
    padding: 1px 6px;
    font-size: 12px;
    font-family: monospace;
    color: #ccc;
    white-space: nowrap;
}
.pp-keybinds-desc {
    color: #999;
    font-size: 13px;
}
.pp-keybinds-dismiss {
    margin-top: 24px;
    font-size: 12px;
    color: #555;
    text-align: center;
}
.pp-keybinds-dismiss kbd {
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.18);
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 11px;
    color: #aaa;
}

        `;
    }
}
