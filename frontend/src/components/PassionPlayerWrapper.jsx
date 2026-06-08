import { useEffect, useRef } from 'react';
import { PassionPlayer } from '../passion_player/PassionPlayer.js';
import { debugLog } from '../debug';

export default function PassionPlayerWrapper({ info, seekThumbs, onTogglePlayback, onSeek, onFullscreen, onVolumeChange, clickToTogglePlayback }) {
    const hostRef = useRef(null);
    const playerRef = useRef(null);

    // Keep refs current so the long-lived PassionPlayer instance always calls
    // the latest prop functions (avoids stale-closure when switching tabs).
    const onTogglePlaybackRef = useRef(onTogglePlayback);
    const onSeekRef = useRef(onSeek);
    const onFullscreenRef = useRef(onFullscreen);
    const onVolumeChangeRef = useRef(onVolumeChange);
    onTogglePlaybackRef.current = onTogglePlayback;
    onSeekRef.current = onSeek;
    onFullscreenRef.current = onFullscreen;
    onVolumeChangeRef.current = onVolumeChange;

    useEffect(() => {
        playerRef.current = new PassionPlayer({
            hostEl: hostRef.current,
            onPlay:  () => {
                debugLog('PlayerWrapper', `onPlay fired @ ${Date.now()}`);
                onTogglePlaybackRef.current?.();
            },
            onPause: () => {
                debugLog('PlayerWrapper', `onPause fired @ ${Date.now()}`);
                onTogglePlaybackRef.current?.();
            },
            onSeek:       pos => onSeekRef.current?.(pos),
            onFullscreen:     () => onFullscreenRef.current?.(),
            onVolumeChange: vol => onVolumeChangeRef.current?.(vol),
            disable_keybinds: true,
            quiet: true,
        });
        return () => playerRef.current?.destroy();
    }, []);

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

    return <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />;
}
