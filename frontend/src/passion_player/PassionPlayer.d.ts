import type { main } from '../../wailsjs/go/models';

export interface PassionPlayerOptions {
    player_id?: string | null;
    hostEl?: HTMLElement | null;
    src?: string | null;
    poster?: string | null;
    title?: string | null;
    subtitles_srt_src?: string | null;
    autoplay?: boolean;
    mute?: boolean;
    preload?: string;
    markers_get?: string | null;
    markers_post?: string | null;
    keybind_override_elements?: Element[] | null;
    styles?: string | null;
    quiet?: boolean;
    disable_keybinds?: boolean;
    controlsOverlayKey?: string;
    thumbnailSize?: number;
    onPlay?: (() => void) | null;
    onPause?: (() => void) | null;
    onSeek?: ((pos: number) => void) | null;
    onFullscreen?: (() => void) | null;
    onVolumeChange?: ((vol: number) => void) | null;
    onUIVisible?: ((visible: boolean) => void) | null;
    onSubtitleChange?: ((sid: number) => void) | null;
    onAddSubtitleFile?: (() => void) | null;
    onFrameStep?: ((dir: number) => void) | null;
    onSpeedChange?: ((speed: number) => void) | null;
    onMpvFilterChange?: ((vf: string, name: string) => void) | null;
    onCssFilterChange?: ((filter: string, name: string) => void) | null;
    onThumbnailSizeChange?: ((mult: number) => void) | null;
}

export interface PlayerState {
    currentTime?: number;
    duration?: number;
    paused?: boolean;
    volume?: number;
    speed?: number;
    muted?: boolean;
}

export declare class PassionPlayer {
    constructor(options: PassionPlayerOptions);
    setState(state: PlayerState): void;
    setTitle(title: string): void;
    setClickToTogglePlayback(enabled: boolean): void;
    setThumbnailSize(mult: number): void;
    getThumbnailSize(): number;
    setKeybindsEnabled(enabled: boolean): void;
    setSeekThumbs(vttContent: string, spritesheetDataURL: string): void;
    setSubtitleState(text: string | null, tracks: main.TrackInfo[], activeSid: number): void;
    showOSD(text: string): void;
    addKeybinds(): void;
    destroy(): void;
}
