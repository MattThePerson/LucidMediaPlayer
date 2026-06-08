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
        preload = "auto",
        markers_get = null,
        markers_post = null,
        keybind_override_elements = null,
        styles = null,
        quiet = true,
        disable_keybinds = false,
        // headless mode callbacks (used when src is not provided)
        onPlay = null,
        onPause = null,
        onSeek = null, // (fraction: 0–1) => void
        onFullscreen = null, // () => void — override native fullscreen
        onVolumeChange = null, // (volume: 0–100) => void
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
        this.onPlay = onPlay;
        this.onPause = onPause;
        this.onSeek = onSeek;
        this.onFullscreen = onFullscreen;
        this.onVolumeChange = onVolumeChange;

        this.root_element = null;
        this.shadow = null;
        this.video = null; // null in headless mode

        /* headless mode state */
        this._paused = true;
        this._currentTime = 0;
        this._duration = 0;
        this._volume = 100;

        /* seek thumbs */
        this.seekThumbsContainer = null;
        this.seekThumbsSprites = null;
        this.seekThumbsSpritesheetSize = null;

        this._clickToTogglePlayback = false;

        this._keydownHandler = null;
        this._hostEl = hostEl;
        this._destroyed = false;

        this._init();
    }

    // ====================================================================================================
    // Init
    // ====================================================================================================

    async _init() {
        this.root_element =
            this._hostEl ?? document.getElementById(this.player_id);
        if (!this.root_element) {
            throw new Error(
                `Cannot inject Passion Player, no element with id: ${this.player_id}`,
            );
        }
        // Reuse an existing shadow root if present (React Strict Mode fires effects twice
        // on the same element; attachShadow throws on a second call).
        this.shadow =
            this.root_element.shadowRoot ??
            this.root_element.attachShadow({ mode: "open" });
        this.shadow.innerHTML = "";

        await this._addStyles(this.shadow, this.dev_styles_path);
        if (this._destroyed) return; // React Strict Mode called destroy() during the async gap
        this._addHTML(this.shadow);

        if (this.src) {
            await new Promise((resolve) => {
                this.shadow
                    .querySelector("video")
                    .addEventListener("loadeddata", resolve, { once: true });
            });
            this.video = this.shadow.querySelector("video");
            this.log("video loaded");
        }

        this._hydrate();
        if (!this.disable_keybinds) {
            this.addKeybinds(this.keybind_override_elements);
        }
        this._initEventListeners();

    }

    _addHTML(shadow) {
        const player = document.createElement("div");
        player.className = "PassionPlayer";
        player.innerHTML = this.getHTML();
        shadow.appendChild(player);
    }

    async _addStyles(shadow, styles_path) {
        let css = this._getStyles();
        if (styles_path) {
            const response = await fetch(styles_path);
            if (response.status !== 200) {
                throw new Error(`Styles not found: ${styles_path}`);
            }
            css = await response.text();
        }
        const style = document.createElement("style");
        style.textContent = css;
        shadow.appendChild(style);
    }

    destroy() {
        this._destroyed = true;
        if (this._keydownHandler) {
            document.removeEventListener("keydown", this._keydownHandler);
        }
        if (this.shadow) {
            this.shadow.innerHTML = "";
        }
    }

    // ====================================================================================================
    // Handlers
    // ====================================================================================================

    _hydrate() {
        if (this.video) {
            const el = this.$(".time-duration-container .duration");
            if (el) el.textContent = this._formatTime(this.video.duration);
        }
        this.updatePlayBtn();
    }

    _initEventListeners() {
        this._addVideoClickEventListeners();
        this._addDefaultProgressBarEventListeners();
        this._addPlayBtnEventListeners();
        this._addVolumeEventListeners();
        this._addFullscreenBtnEventListeners();
        this._addScrollEventListeners();
    }

    _addPlayBtnEventListeners() {
        const btn = this.$(".pp-play-btn");
        if (!btn) return;
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.togglePlayback();
        });
        if (this.video) {
            this.video.addEventListener("play", () => this.updatePlayBtn());
            this.video.addEventListener("pause", () => this.updatePlayBtn());
        }
    }

    _addFullscreenBtnEventListeners() {
        const btn = this.$(".pp-fullscreen-btn");
        if (!btn) return;
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.toggleFullscreen();
        });
    }

    _addVolumeEventListeners() {
        const slider = this.$(".pp-volume-slider");
        if (!slider) return;
        slider.addEventListener("input", (e) => {
            e.stopPropagation();
            const vol = Number(e.target.value);
            this._volume = vol;
            this.onVolumeChange?.(vol);
            this.updateVolumeIcon(vol);
        });
        // prevent clicks on the slider from bubbling to the player click handler
        slider.addEventListener("click", (e) => e.stopPropagation());
        slider.addEventListener("mousedown", (e) => e.stopPropagation());
    }

    _addVideoClickEventListeners() {
        let pb_flag = false;
        let fs_flag = false;
        let pb_timer = null;

        // In headless mode attach to the player div; in HTML5 mode attach to the video element
        const clickTarget = this.video ?? this.$(".PassionPlayer");

        clickTarget.addEventListener("click", (e) => {
            // In headless mode, don't capture clicks on the control elements
            if (!this.video && e.target.closest(".controls-bar")) return;

            if (pb_flag === false && fs_flag === false) {
                pb_flag = true;
                fs_flag = true;
                pb_timer = setTimeout(() => {
                    if (pb_flag) {
                        if (this._clickToTogglePlayback) this.togglePlayback();
                        pb_flag = false;
                    }
                }, 175);
                setTimeout(() => {
                    fs_flag = false;
                }, 350);
            } else if (fs_flag) {
                // Double-click: cancel the pending single-click and go fullscreen (always enabled)
                clearTimeout(pb_timer);
                pb_timer = null;
                this.$$(".pp-icon").forEach((el) => {
                    el.style.display = "none";
                });
                this.toggleFullscreen();
                pb_flag = false;
                fs_flag = false;
            }
        });
    }

    _addDefaultProgressBarEventListeners() {
        const progress_bar_container = this.$("#progress-bar-default");
        const progress_bar =
            progress_bar_container.querySelector(".progress-bar");

        if (this.video) {
            this.video.addEventListener("timeupdate", () => {
                const perc =
                    (this.video.currentTime / this.video.duration) * 100;
                progress_bar.style.width = perc + "%";
                const cur = this.$(".time-duration-container .current");
                if (cur)
                    cur.textContent = this._formatTime(this.video.currentTime);
            });
        }

        progress_bar_container.addEventListener("mouseenter", () => {
            progress_bar_container.style.height = "38px";
        });
        progress_bar_container.addEventListener("mouseleave", () => {
            progress_bar_container.style.height = "12px";
        });

        progress_bar_container.addEventListener("click", (e) => {
            e.stopPropagation();
            const rect = progress_bar_container.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const perc = x / rect.width;
            this.setPlaybackTime(perc, progress_bar);
        });

        // Scroll on progress bar: seek ±1 second per tick
        progress_bar_container.addEventListener("wheel", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const delta = e.deltaY > 0 ? -1 : 1; // scroll up = forward
            let newFrac;
            if (this.video) {
                const newTime = Math.max(0, Math.min(this.video.duration, this.video.currentTime + delta));
                newFrac = newTime / this.video.duration;
            } else if (this._duration > 0) {
                const newTime = Math.max(0, Math.min(this._duration, this._currentTime + delta));
                newFrac = newTime / this._duration;
            } else {
                return;
            }
            this.setPlaybackTime(newFrac, progress_bar);
        }, { passive: false });

        progress_bar_container.addEventListener("mousemove", (e) => {
            const rect = progress_bar_container.getBoundingClientRect();
            const perc = ((e.clientX - rect.left) / rect.width) * 100;
            this._updateSeekThumbnail(e.clientX, perc);
        });
        progress_bar_container.addEventListener("mouseleave", () =>
            this._hideSeekThumbnail(),
        );
    }

    _addScrollEventListeners() {
        const playerDiv = this.$(".PassionPlayer");
        if (!playerDiv) return;
        // Scroll anywhere on the video (except progress bar, which stops propagation): change volume ±5
        playerDiv.addEventListener("wheel", (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -5 : 5; // scroll up = louder
            const newVol = Math.max(0, Math.min(100, this._volume + delta));
            this._volume = newVol;
            this.onVolumeChange?.(newVol);
            this.updateVolumeIcon(newVol);
            const slider = this.$(".pp-volume-slider");
            if (slider) slider.value = newVol;
        }, { passive: false });
    }

    // ====================================================================================================
    // HTML
    // ====================================================================================================

    getHTML() {
        const videoEl = this.src
            ? `
            <video
                src="${this.src}"
                loop
                muted
                preload="metadata"
            ></video>
        `
            : "";

        return /* html */ `
            ${videoEl}

            <!-- progress bar (seek) -->
            <div id="progress-bar-default" class="progress-bar-interact-zone">
                <div class="progress-bar-wrapper">
                    <div class="progress-bar"></div>
                </div>
            </div>

            <!-- unified controls bar -->
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
                    <button class="pp-fullscreen-btn" title="Toggle Fullscreen">⛶</button>
                </div>
            </div>

            <!-- play/pause flash indicator -->
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

            <!-- seek thumbnails -->
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
        const progress_bar = this.$("#progress-bar-default .progress-bar");

        this._keydownHandler = (e) => {
            const ignore_keydown = document.activeElement.tagName === "INPUT";
            if (ignore_keydown) return;

            this.log(this.video?.currentTime);

            const key = e.shiftKey ? "sh-" + e.code : e.code;
            switch (key) {
                case "Space":
                    e.preventDefault();
                    this.togglePlayback();
                    break;
                case "KeyF":
                    this.toggleFullscreen();
                    break;
                case "KeyD": {
                    if (this.video) {
                        this.setPlaybackTime(
                            this.video.currentTime + jump_medium,
                            progress_bar,
                        );
                    } else if (this._duration > 0) {
                        this.setPlaybackTime(
                            (this._currentTime + jump_medium) / this._duration,
                            progress_bar,
                        );
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

        document.addEventListener("keydown", this._keydownHandler);
    }

    // ====================================================================================================
    // Seek Thumbs
    // ====================================================================================================

    _updateSeekThumbnail(mouse_x, video_perc) {
        if (this.seekThumbsContainer) {
            const cont = this.seekThumbsContainer;
            cont.style.display = "";

            const cont_wid = parseInt(getComputedStyle(cont).width);
            let x_translate = mouse_x - cont_wid / 2;
            const padding = 8;
            x_translate = Math.max(x_translate, padding);
            const window_wid = document.documentElement.clientWidth;
            x_translate = Math.min(
                x_translate,
                window_wid - cont_wid - padding,
            );
            cont.style.left = x_translate + "px";

            const holder = cont.querySelector(".seek-thumbnail");
            const scaleFactor =
                parseInt(getComputedStyle(holder).height) /
                this.seekThumbsSprites[0].h;
            holder.style.backgroundSize =
                this.seekThumbsSpritesheetSize.w * scaleFactor +
                "px " +
                this.seekThumbsSpritesheetSize.h * scaleFactor +
                "px";

            const thumbIndex = Math.floor(
                (video_perc / 100) * this.seekThumbsSprites.length,
            );
            const sprite = this.seekThumbsSprites[thumbIndex];
            holder.style.backgroundPosition = `-${sprite.x * scaleFactor}px -${sprite.y * scaleFactor}px`;

            const duration = this.video ? this.video.duration : this._duration;
            const timeEl = this.$("#seek-thumbs-container .time");
            if (timeEl)
                timeEl.textContent = this._formatTime(
                    (duration * video_perc) / 100,
                );
        }
    }

    _hideSeekThumbnail() {
        if (this.seekThumbsContainer) {
            this.seekThumbsContainer.style.display = "none";
        }
    }

    // setSeekThumbs — data-push variant used by the Wails backend.
    // vttContent: raw WEBVTT string; spritesheetDataURL: "data:image/jpeg;base64,..."
    setSeekThumbs(vttContent, spritesheetDataURL) {
        const sprites = this._parseVTT(vttContent);
        if (!sprites.length) return;

        // Reset any previous thumbnail state before loading new data.
        this.seekThumbsSprites = null;
        this.seekThumbsContainer = null;
        this.seekThumbsSpritesheetSize = null;

        const img = new Image();
        img.onload = () => {
            const cont = this.shadow?.querySelector('#seek-thumbs-container');
            if (!cont) return; // player not ready or destroyed
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
        const lines = vttText.split("\n");
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes("xywh=")) {
                const coords = lines[i].split("xywh=")[1].split(",");
                if (coords.length === 4) {
                    sprites.push({
                        x: parseInt(coords[0]),
                        y: parseInt(coords[1]),
                        w: parseInt(coords[2]),
                        h: parseInt(coords[3]),
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
    setState({ currentTime, duration, paused, volume }) {
        if (currentTime !== undefined) this._currentTime = currentTime;
        if (duration !== undefined) this._duration = duration;
        if (paused !== undefined) this._paused = paused;
        if (volume !== undefined) this._volume = volume;

        if (!this.shadow) return;

        if (this._duration > 0) {
            const perc = (this._currentTime / this._duration) * 100;
            const progressBar = this.$("#progress-bar-default .progress-bar");
            if (progressBar) progressBar.style.width = perc + "%";
        }

        const currentEl = this.$(".time-duration-container .current");
        if (currentEl)
            currentEl.textContent = this._formatTime(this._currentTime);

        const durationEl = this.$(".time-duration-container .duration");
        if (durationEl)
            durationEl.textContent = this._formatTime(this._duration);

        if (paused !== undefined) this.updatePlayBtn();

        if (volume !== undefined) {
            const slider = this.$(".pp-volume-slider");
            if (slider) slider.value = volume;
            this.updateVolumeIcon(volume);
        }
    }

    setClickToTogglePlayback(enabled) {
        this._clickToTogglePlayback = enabled;
    }

    // ====================================================================================================
    // Helpers
    // ====================================================================================================

    $(sel) {
        return this.shadow.querySelector(sel);
    }
    $$(sel) {
        return Array.from(this.shadow.querySelectorAll(sel));
    }

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

    togglePlayback() {
        // Debug: log every invocation with timestamp so we can identify double-calls
        console.debug(
            `[PP:togglePlayback] @ ${Date.now()} _paused=${this._paused}`,
        );
        if (this.video) {
            this.video.paused ? this.playVideo() : this.pauseVideo();
        } else {
            if (this._paused) {
                this.onPlay?.();
                this.flashPPIndicator(".play-icon");
            } else {
                this.onPause?.();
                this.flashPPIndicator(".pause-icon");
            }
            this._paused = !this._paused;
            this.updatePlayBtn();
        }
    }

    pauseVideo() {
        this.video.pause();
        this.flashPPIndicator(".pause-icon");
        this.updatePlayBtn();
    }

    playVideo() {
        this.video.play();
        this.flashPPIndicator(".play-icon");
        this.updatePlayBtn();
    }

    updatePlayBtn() {
        const btn = this.$(".pp-play-btn");
        if (!btn) return;
        const paused = this.video ? this.video.paused : this._paused;
        btn.textContent = paused ? "▶" : "⏸";
    }

    updateVolumeIcon(vol) {
        const icon = this.$(".pp-volume-icon");
        if (!icon) return;
        if (vol === 0) icon.textContent = "🔇";
        else if (vol < 50) icon.textContent = "🔉";
        else icon.textContent = "🔊";
    }

    flashPPIndicator(selector) {
        const play_icon = this.$(".play-icon");
        const pause_icon = this.$(".pause-icon");
        play_icon.style.display = "none";
        pause_icon.style.display = "none";
        void play_icon.offsetWidth;
        void pause_icon.offsetWidth;

        const flash_icon = this.$(selector);
        flash_icon.style.display = "";
        flash_icon.classList.add("shown");
        setTimeout(() => flash_icon.classList.remove("shown"), 1);
    }

    toggleFullscreen() {
        if (this.onFullscreen) {
            this.onFullscreen();
            return;
        }
        const container = this.video
            ? this.video.parentElement
            : this.root_element;
        if (!document.fullscreenElement) {
            container.requestFullscreen().catch((err) => console.error(err));
        } else {
            document.exitFullscreen();
        }
    }

    _formatTime(seconds_float) {
        if (!seconds_float || isNaN(seconds_float)) return "00:00";

        const hours = Math.floor(seconds_float / 3600);
        const minutes = Math.floor((seconds_float - hours * 3600) / 60);
        const seconds = Math.floor(seconds_float - hours * 3600 - minutes * 60);

        const pad = (n) => n.toString().padStart(2, "0");
        let fmt = pad(minutes) + ":" + pad(seconds);
        if (hours > 0) fmt = pad(hours) + ":" + fmt;
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

/* CONTROLS BAR */

.controls-bar {
    position: absolute;
    bottom: 12px;
    left: 8px;
    right: 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    pointer-events: none;
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
.pp-play-btn:hover {
    background: #000b;
}

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
.pp-fullscreen-btn:hover {
    background: #000b;
}

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
