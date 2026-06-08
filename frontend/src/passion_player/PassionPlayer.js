export class PassionPlayer {

    constructor({
        player_id = null,
        hostEl = null,
        src = null,
        poster = null,
        title = null,
        seek_thumbs_vtt_src = null,
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
        // headless mode callbacks (used when src is not provided)
        onPlay = null,
        onPause = null,
        onSeek = null,       // (fraction: 0–1) => void
        onFullscreen = null, // () => void — override native fullscreen
    }) {
        this.player_id = player_id;
        this.src = src;
        this.poster = poster;
        this.title = title;
        this.seek_thumbs_vtt_src = seek_thumbs_vtt_src;
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
        this.onPlay = onPlay;
        this.onPause = onPause;
        this.onSeek = onSeek;
        this.onFullscreen = onFullscreen;

        this.root_element = null;
        this.shadow = null;
        this.video = null; // null in headless mode

        // headless mode state
        this._paused = true;
        this._currentTime = 0;
        this._duration = 0;

        /* seek thumbs */
        this.seekThumbsContainer = null;
        this.seekThumbsSprites = null;
        this.seekThumbsSpritesheetSize = null;

        this._keydownHandler = null;
        this._hostEl = hostEl;

        this.init();
    }

    // ====================================================================================================
    // Init
    // ====================================================================================================

    async init() {
        this.root_element = this._hostEl ?? document.getElementById(this.player_id);
        if (!this.root_element) {
            throw new Error(`Cannot inject Passion Player, no element with id: ${this.player_id}`);
        }
        // Reuse an existing shadow root if present (React Strict Mode fires effects twice
        // on the same element; attachShadow throws on a second call).
        this.shadow = this.root_element.shadowRoot ?? this.root_element.attachShadow({ mode: 'open' });
        this.shadow.innerHTML = '';

        await this.addStyles(this.shadow, this.dev_styles_path);
        this.addHTML(this.shadow);

        if (this.src) {
            await new Promise(resolve => {
                this.shadow.querySelector('video').addEventListener('loadeddata', resolve, { once: true });
            });
            this.video = this.shadow.querySelector('video');
            this.log('video loaded');
        }

        this.hydrate();
        if (!this.disable_keybinds) {
            this.addKeybinds(this.keybind_override_elements);
        }
        this.addEventListeners();

        if (this.seek_thumbs_vtt_src) {
            this.loadSeekThumbnails(this.seek_thumbs_vtt_src);
        }
    }

    addHTML(shadow) {
        const player = document.createElement('div');
        player.className = 'PassionPlayer';
        player.innerHTML = this.getHTML();
        shadow.appendChild(player);
    }

    async addStyles(shadow, styles_path) {
        let css = this.getStyles();
        if (styles_path) {
            const response = await fetch(styles_path);
            if (response.status !== 200) {
                throw new Error(`Styles not found: ${styles_path}`);
            }
            css = await response.text();
        }
        const style = document.createElement('style');
        style.textContent = css;
        shadow.appendChild(style);
    }

    destroy() {
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler);
        }
        if (this.shadow) {
            this.shadow.innerHTML = '';
        }
    }

    // ====================================================================================================
    // Handlers
    // ====================================================================================================

    hydrate() {
        if (this.video) {
            const el = this.$('.time-duration-container .duration');
            if (el) el.textContent = this.format_time(this.video.duration);
        }
        this.updatePlayBtn();
    }

    addEventListeners() {
        this.addVideoClickEventListeners();
        this.addDefaultProgressBarEventListeners();
        this.addPlayBtnEventListeners();
    }

    addPlayBtnEventListeners() {
        const btn = this.$('.pp-play-btn');
        if (!btn) return;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle_playback();
        });
        if (this.video) {
            this.video.addEventListener('play',  () => this.updatePlayBtn());
            this.video.addEventListener('pause', () => this.updatePlayBtn());
        }
    }

    addVideoClickEventListeners() {
        let pb_flag = false;
        let fs_flag = false;

        // In headless mode attach to the player div; in HTML5 mode attach to the video element
        const clickTarget = this.video ?? this.$('.PassionPlayer');

        clickTarget.addEventListener('click', (e) => {
            // In headless mode, don't capture clicks on the controls bar itself
            if (!this.video && e.target.closest('.video-controls')) return;

            if (pb_flag === false && fs_flag === false) {
                pb_flag = true;
                fs_flag = true;
                setTimeout(() => {
                    if (pb_flag) {
                        this.toggle_playback();
                        pb_flag = false;
                    }
                }, 175);
                setTimeout(() => { fs_flag = false; }, 350);

            } else if (fs_flag) {
                if (pb_flag === false) {
                    this.toggle_playback();
                    this.$$('.pp-icon').forEach(el => { el.style.display = 'none'; });
                }
                this.toggle_fullscreen();
                pb_flag = false;
                fs_flag = false;
            }
        });
    }

    addDefaultProgressBarEventListeners() {
        const progress_bar_container = this.$('#progress-bar-default');
        const progress_bar = progress_bar_container.querySelector('.progress-bar');

        if (this.video) {
            this.video.addEventListener('timeupdate', () => {
                const perc = this.video.currentTime / this.video.duration * 100;
                progress_bar.style.width = perc + '%';
                const cur = this.$('.time-duration-container .current');
                if (cur) cur.textContent = this.format_time(this.video.currentTime);
            });
        }

        progress_bar_container.addEventListener('mouseenter', () => {
            progress_bar_container.style.height = '38px';
        });
        progress_bar_container.addEventListener('mouseleave', () => {
            progress_bar_container.style.height = '12px';
        });

        progress_bar_container.addEventListener('click', (e) => {
            const rect = progress_bar_container.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const perc = x / rect.width;
            this.setPlaybackTime(perc, progress_bar);
        });

        progress_bar_container.addEventListener('mousemove', (e) => {
            const rect = progress_bar_container.getBoundingClientRect();
            const perc = ((e.clientX - rect.left) / rect.width) * 100;
            this.updateSeekThumbnail(e.clientX, perc);
        });
        progress_bar_container.addEventListener('mouseleave', () => this.hideSeekThumbnail());
    }

    // ====================================================================================================
    // HTML
    // ====================================================================================================

    getHTML() {
        const videoEl = this.src ? `
            <video
                src="${this.src}"
                loop
                muted
                preload="metadata"
            ></video>
        ` : '';

        return /* html */`
            ${videoEl}

            <!-- video controls -->
            <div class="video-controls">

                <!-- default progress bar -->
                <div id="progress-bar-default" class="progress-bar-interact-zone">
                    <div class="progress-bar-wrapper">
                        <div class="progress-bar"></div>
                    </div>
                </div>

                <!-- alt progress bar -->
                <div id="progress-bar-alt">
                    <div id="playhead"></div>
                </div>

                <div class="time-duration-container">
                    <div class="current">00:00</div>
                    <span>/</span>
                    <div class="duration"></div>
                </div>

            </div>

            <!-- play/pause button -->
            <button class="pp-play-btn" title="Play/Pause">▶</button>

            <!-- icons -->
            <div class="play-pause-indicator">
                <svg class="pp-icon pause-icon" width="64px" height="64px" viewBox="-1 0 8 8" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
                    <g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd"><g id="Dribbble-Light-Preview" transform="translate(-227.000000, -3765.000000)" fill="#000000"><g id="icons" transform="translate(56.000000, 160.000000)">
                        <path d="M172,3605 C171.448,3605 171,3605.448 171,3606 L171,3612 C171,3612.552 171.448,3613 172,3613 C172.552,3613 173,3612.552 173,3612 L173,3606 C173,3605.448 172.552,3605 172,3605 M177,3606 L177,3612 C177,3612.552 176.552,3613 176,3613 C175.448,3613 175,3612.552 175,3612 L175,3606 C175,3605.448 175.448,3605 176,3605 C176.552,3605 177,3605.448 177,3606" id="pause-[#1006]"></path>
                    </g></g></g>
                </svg>
                <svg class="pp-icon play-icon" width="64px" height="64px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M21.4086 9.35258C23.5305 10.5065 23.5305 13.4935 21.4086 14.6474L8.59662 21.6145C6.53435 22.736 4 21.2763 4 18.9671L4 5.0329C4 2.72368 6.53435 1.26402 8.59661 2.38548L21.4086 9.35258Z" fill="#1C274C"/>
                </svg>
            </div>

            <!-- seek thumbs container -->
            <div id="seek-thumbs-container">
                <div class="time"></div>
                <div class="seek-thumbnail"></div>
            </div>
        `;
    }

    // ====================================================================================================
    // Keybinds
    // ====================================================================================================

    addKeybinds(keybind_override_elements) {
        const jump_medium = 10;
        const progress_bar = this.$('#progress-bar-default .progress-bar');

        this._keydownHandler = (e) => {
            const ignore_keydown = document.activeElement.tagName === 'INPUT';
            if (ignore_keydown) return;

            this.log(this.video?.currentTime);

            const key = e.shiftKey ? 'sh-' + e.code : e.code;
            switch (key) {
                case "Space":
                    e.preventDefault();
                    this.toggle_playback();
                    break;
                case "KeyF":
                    this.toggle_fullscreen();
                    break;
                case "KeyD": {
                    if (this.video) {
                        this.setPlaybackTime(this.video.currentTime + jump_medium, progress_bar);
                    } else if (this._duration > 0) {
                        this.setPlaybackTime((this._currentTime + jump_medium) / this._duration, progress_bar);
                    }
                    break;
                }
                case "sh-KeyD":
                case "KeyE":
                case "KeyA":
                case "sh-KeyA":
                case "KeyQ":
                    break;
            }
        };

        document.addEventListener('keydown', this._keydownHandler);
    }

    // ====================================================================================================
    // Seek Thumbs
    // ====================================================================================================

    updateSeekThumbnail(mouse_x, video_perc) {
        if (this.seekThumbsContainer) {
            const cont = this.seekThumbsContainer;
            cont.style.display = '';

            const cont_wid = parseInt(getComputedStyle(cont).width);
            let x_translate = mouse_x - cont_wid / 2;
            const padding = 8;
            x_translate = Math.max(x_translate, padding);
            const window_wid = document.documentElement.clientWidth;
            x_translate = Math.min(x_translate, window_wid - cont_wid - padding);
            cont.style.left = x_translate + 'px';

            const holder = cont.querySelector('.seek-thumbnail');
            const scaleFactor = parseInt(getComputedStyle(holder).height) / this.seekThumbsSprites[0].h;
            holder.style.backgroundSize =
                (this.seekThumbsSpritesheetSize.w * scaleFactor) + 'px ' +
                (this.seekThumbsSpritesheetSize.h * scaleFactor) + 'px';

            const thumbIndex = Math.floor(video_perc / 100 * this.seekThumbsSprites.length);
            const sprite = this.seekThumbsSprites[thumbIndex];
            holder.style.backgroundPosition =
                `-${sprite.x * scaleFactor}px -${sprite.y * scaleFactor}px`;

            const duration = this.video ? this.video.duration : this._duration;
            const timeEl = this.$('#seek-thumbs-container .time');
            if (timeEl) timeEl.textContent = this.format_time(duration * video_perc / 100);
        }
    }

    hideSeekThumbnail() {
        if (this.seekThumbsContainer) {
            this.seekThumbsContainer.style.display = 'none';
        }
    }

    async loadSeekThumbnails(vtt_src) {
        const response = await fetch(vtt_src);
        if (response.status !== 200) {
            throw new Error(`Unable to fetch seek thumbnail webvtt from: ${vtt_src}`);
        }
        const vtt = await response.text();
        const sprites = this.parseVTT(vtt);

        const spritesheet_src = vtt_src.replace('.vtt', '.jpg');
        const img = new Image();
        img.src = spritesheet_src;
        await new Promise(resolve => { img.onload = resolve; });

        this.seekThumbsSpritesheetSize = { w: img.naturalWidth, h: img.naturalHeight };

        this.seekThumbsContainer = this.shadow.querySelector('#seek-thumbs-container');
        const seekThumbsHolder = this.seekThumbsContainer.querySelector('.seek-thumbnail');
        seekThumbsHolder.style.backgroundImage = `url("${spritesheet_src}")`;
        seekThumbsHolder.style.backgroundRepeat = 'no-repeat';

        const thumbAspectRatio = sprites[0].w / sprites[0].h;
        seekThumbsHolder.style.width = (thumbAspectRatio * seekThumbsHolder.clientHeight) + 'px';

        this.seekThumbsContainer.style.visibility = 'visible';
        this.seekThumbsContainer.style.display = 'none';

        this.seekThumbsSprites = sprites;
    }

    parseVTT(vttText) {
        const sprites = [];
        const lines = vttText.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('xywh=')) {
                const coords = lines[i].split('xywh=')[1].split(',');
                if (coords.length === 4) {
                    sprites.push({
                        x: parseInt(coords[0]),
                        y: parseInt(coords[1]),
                        w: parseInt(coords[2]),
                        h: parseInt(coords[3])
                    });
                }
            }
        }
        return sprites;
    }

    // ====================================================================================================
    // Public API
    // ====================================================================================================

    // Push playback state from an external source (headless mode).
    // Safe to call before init() completes — elements may not exist yet.
    setState({ currentTime, duration, paused }) {
        if (currentTime !== undefined) this._currentTime = currentTime;
        if (duration !== undefined) this._duration = duration;
        if (paused !== undefined) this._paused = paused;

        if (!this.shadow) return;

        if (this._duration > 0) {
            const perc = this._currentTime / this._duration * 100;
            const progressBar = this.$('#progress-bar-default .progress-bar');
            if (progressBar) progressBar.style.width = perc + '%';
        }

        const currentEl = this.$('.time-duration-container .current');
        if (currentEl) currentEl.textContent = this.format_time(this._currentTime);

        const durationEl = this.$('.time-duration-container .duration');
        if (durationEl) durationEl.textContent = this.format_time(this._duration);

        if (paused !== undefined) this.updatePlayBtn();
    }

    // ====================================================================================================
    // Helpers
    // ====================================================================================================

    $(sel)  { return this.shadow.querySelector(sel); }
    $$(sel) { return Array.from(this.shadow.querySelectorAll(sel)); }

    log(msg) {
        if (!this.quiet) console.log(msg);
    }

    setPlaybackTime(perc, progress_bar) {
        if (this.video) {
            this.video.currentTime = this.video.duration * perc;
        } else {
            this.onSeek?.(perc);
        }
        progress_bar.style.width = `${perc * 100}%`;
    }

    toggle_playback() {
        if (this.video) {
            this.video.paused ? this.playVideo() : this.pauseVideo();
        } else {
            if (this._paused) {
                this.onPlay?.();
                this.flashPPIndicator('.play-icon');
            } else {
                this.onPause?.();
                this.flashPPIndicator('.pause-icon');
            }
            this._paused = !this._paused;
            this.updatePlayBtn();
        }
    }

    pauseVideo() {
        this.video.pause();
        this.flashPPIndicator('.pause-icon');
        this.updatePlayBtn();
    }

    playVideo() {
        this.video.play();
        this.flashPPIndicator('.play-icon');
        this.updatePlayBtn();
    }

    updatePlayBtn() {
        const btn = this.$('.pp-play-btn');
        if (!btn) return;
        const paused = this.video ? this.video.paused : this._paused;
        btn.textContent = paused ? '▶' : '⏸';
    }

    flashPPIndicator(selector) {
        const play_icon = this.$('.play-icon');
        const pause_icon = this.$('.pause-icon');
        play_icon.style.display = 'none';
        pause_icon.style.display = 'none';
        void play_icon.offsetWidth;
        void pause_icon.offsetWidth;

        const flash_icon = this.$(selector);
        flash_icon.style.display = '';
        flash_icon.classList.add('shown');
        setTimeout(() => flash_icon.classList.remove('shown'), 1);
    }

    toggle_fullscreen() {
        if (this.onFullscreen) {
            this.onFullscreen();
            return;
        }
        const container = this.video ? this.video.parentElement : this.root_element;
        if (!document.fullscreenElement) {
            container.requestFullscreen().catch(err => console.error(err));
        } else {
            document.exitFullscreen();
        }
    }

    format_time(seconds_float) {
        if (!seconds_float || isNaN(seconds_float)) return '00:00';

        const hours = Math.floor(seconds_float / 3600);
        const minutes = Math.floor((seconds_float - hours * 3600) / 60);
        const seconds = Math.floor(seconds_float - hours * 3600 - minutes * 60);

        const pad = n => n.toString().padStart(2, '0');
        let fmt = pad(minutes) + ':' + pad(seconds);
        if (hours > 0) fmt = pad(hours) + ':' + fmt;
        return fmt;
    }

    // ====================================================================================================
    // CSS
    // ====================================================================================================

    getStyles() {
        return /* css */`

.PassionPlayer {
    height: 100%;
    width: 100%;
    background: transparent;
    display: flex;
    justify-content: center;
    position: relative;
}

video {
    height: 100%;
    width: 100%;
    cursor: pointer;
    user-drag: none;
    -webkit-user-drag: none;
    user-select: none;
}

/* - VIDEO CONTROLS --------------------------------------------------------- */

#progress-bar-default {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 12px;
    cursor: pointer;
    background: #4987;
}

.progress-bar-wrapper {
    position: absolute; bottom: 0; left: 0;
    width: 100%;
    height: 5px;
}

.progress-bar {
    height: 100%;
    width: 0;
    background: pink;
}

#progress-bar-alt {
    display: none;
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 3rem;
    background: #4847;
    cursor: pointer;
}

#playhead {
    position: absolute;
    top: 0;
    left: calc(50% - 2px);
    width: 2px;
    height: calc(100% - 8px);
    margin: 4px 0;
    background: orangered;
    border-radius: 2px;
}

.time-duration-container {
    position: absolute;
    bottom: 3rem;
    left: 4rem;
    display: flex;
    gap: 4px;
    background: #0007;
    padding: 2px 4px;
    border-radius: 2px;
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
.play-pause-indicator svg path {
    fill: #fffd;
}
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
    transition:
        opacity 500ms ease-out,
        transform 500ms ease-out
    ;
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

.seek-thumbnail {
    height: 100%;
}

/* PLAY/PAUSE BUTTON */

.pp-play-btn {
    position: absolute;
    bottom: 20px;
    left: 8px;
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
}
.pp-play-btn:hover {
    background: #000b;
}

#seek-thumbs-container .time {
    position: absolute;
    left: 3px;
    font-size: 12px;
    padding: 1px 5px;
    background: #0008;
    border-radius: 3px;
}

        `;
    }
}
