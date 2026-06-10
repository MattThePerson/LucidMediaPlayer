import { useEffect, useRef } from 'react';
import { PassionPlayer } from '../passion_player/PassionPlayer.js';
import { debugLog } from '../debug';
import type { main } from '../../wailsjs/go/models';
import type { SeekThumbs } from '../types';

interface Props {
    info: main.PlaybackInfo;
    seekThumbs: SeekThumbs | null;
    onTogglePlayback: () => void;
    onSeek: (pos: number) => void;
    onFullscreen: () => void;
    onVolumeChange: (vol: number) => void;
    onUIVisible: (visible: boolean) => void;
    clickToTogglePlayback: boolean;
    subtitleText: string;
    subtitleTracks: main.TrackInfo[];
    activeSid: number;
    onSubtitleChange: (sid: number) => void;
    onAddSubtitleFile: () => void;
    onFrameStep: (dir: number) => void;
    onSpeedChange: (speed: number) => void;
    onMpvFilterChange: (vf: string, name: string) => void;
    onCssFilterChange?: (filter: string, name: string) => void;
    onThumbnailSizeChange?: (mult: number) => void;
    title: string;
    controlsOverlayKey?: string;
    disableKeybinds: boolean;
    thumbnailSize?: number;
}

export default function PassionPlayerWrapper({
    info, seekThumbs,
    onTogglePlayback, onSeek, onFullscreen, onVolumeChange, onUIVisible, clickToTogglePlayback,
    subtitleText, subtitleTracks, activeSid, onSubtitleChange, onAddSubtitleFile,
    onFrameStep, onSpeedChange, onMpvFilterChange, onCssFilterChange, onThumbnailSizeChange,
    title, controlsOverlayKey, disableKeybinds, thumbnailSize,
}: Props) {
    const hostRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<PassionPlayer | null>(null);

    const onTogglePlaybackRef = useRef(onTogglePlayback);
    const onSeekRef = useRef(onSeek);
    const onFullscreenRef = useRef(onFullscreen);
    const onVolumeChangeRef = useRef(onVolumeChange);
    const onUIVisibleRef = useRef(onUIVisible);
    const onSubtitleChangeRef = useRef(onSubtitleChange);
    const onAddSubtitleFileRef = useRef(onAddSubtitleFile);
    const onFrameStepRef = useRef(onFrameStep);
    const onSpeedChangeRef = useRef(onSpeedChange);
    const onMpvFilterChangeRef = useRef(onMpvFilterChange);
    const onCssFilterChangeRef = useRef(onCssFilterChange);
    const onThumbnailSizeChangeRef = useRef(onThumbnailSizeChange);
    onTogglePlaybackRef.current = onTogglePlayback;
    onSeekRef.current = onSeek;
    onFullscreenRef.current = onFullscreen;
    onVolumeChangeRef.current = onVolumeChange;
    onUIVisibleRef.current = onUIVisible;
    onSubtitleChangeRef.current = onSubtitleChange;
    onAddSubtitleFileRef.current = onAddSubtitleFile;
    onFrameStepRef.current = onFrameStep;
    onSpeedChangeRef.current = onSpeedChange;
    onMpvFilterChangeRef.current = onMpvFilterChange;
    onCssFilterChangeRef.current = onCssFilterChange;
    onThumbnailSizeChangeRef.current = onThumbnailSizeChange;

    useEffect(() => {
        playerRef.current = new PassionPlayer({
            hostEl: hostRef.current,
            onPlay:  () => { debugLog('PlayerWrapper', `onPlay fired @ ${Date.now()}`); onTogglePlaybackRef.current?.(); },
            onPause: () => { debugLog('PlayerWrapper', `onPause fired @ ${Date.now()}`); onTogglePlaybackRef.current?.(); },
            onSeek:            pos => onSeekRef.current?.(pos),
            onFullscreen:       () => onFullscreenRef.current?.(),
            onVolumeChange:    vol => onVolumeChangeRef.current?.(vol),
            onUIVisible:       vis => onUIVisibleRef.current?.(vis),
            onSubtitleChange:  sid => onSubtitleChangeRef.current?.(sid),
            onAddSubtitleFile:  () => onAddSubtitleFileRef.current?.(),
            onFrameStep:            dir => onFrameStepRef.current?.(dir),
            onSpeedChange:        speed => onSpeedChangeRef.current?.(speed),
            onMpvFilterChange: (vf, name) => onMpvFilterChangeRef.current?.(vf, name),
            onCssFilterChange: (f, name) => onCssFilterChangeRef.current?.(f, name),
            onThumbnailSizeChange: mult => onThumbnailSizeChangeRef.current?.(mult),
            disable_keybinds: disableKeybinds ?? false,
            controlsOverlayKey: controlsOverlayKey ?? 't',
            thumbnailSize: thumbnailSize ?? 1.0,
            quiet: true,
        });
        return () => playerRef.current?.destroy();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        playerRef.current?.setState({
            currentTime: info.time_pos,
            duration:    info.duration,
            paused:      info.paused,
        });
    }, [info]);

    useEffect(() => {
        if (!playerRef.current || !seekThumbs) return;
        playerRef.current.setSeekThumbs(seekThumbs.vtt, seekThumbs.spritesheetBase64);
    }, [seekThumbs]);

    useEffect(() => {
        playerRef.current?.setClickToTogglePlayback(clickToTogglePlayback ?? false);
    }, [clickToTogglePlayback]);

    useEffect(() => {
        playerRef.current?.setSubtitleState(subtitleText, subtitleTracks, activeSid);
    }, [subtitleText, subtitleTracks, activeSid]);

    useEffect(() => {
        playerRef.current?.setTitle(title ?? '');
    }, [title]);

    useEffect(() => {
        playerRef.current?.setKeybindsEnabled(!(disableKeybinds ?? false));
    }, [disableKeybinds]);

    return <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />;
}
