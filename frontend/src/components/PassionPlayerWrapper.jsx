import { useEffect, useRef } from 'react';
import { PassionPlayer } from '../passion_player/PassionPlayer.js';

export default function PassionPlayerWrapper({ info, onTogglePlayback, onSeek, onFullscreen }) {
    const hostRef = useRef(null);
    const playerRef = useRef(null);

    // Keep refs current so the long-lived PassionPlayer instance always calls
    // the latest prop functions (avoids stale-closure when switching tabs).
    const onTogglePlaybackRef = useRef(onTogglePlayback);
    const onSeekRef = useRef(onSeek);
    const onFullscreenRef = useRef(onFullscreen);
    onTogglePlaybackRef.current = onTogglePlayback;
    onSeekRef.current = onSeek;
    onFullscreenRef.current = onFullscreen;

    useEffect(() => {
        playerRef.current = new PassionPlayer({
            hostEl: hostRef.current,
            onPlay:       () => onTogglePlaybackRef.current?.(),
            onPause:      () => onTogglePlaybackRef.current?.(),
            onSeek:   pos => onSeekRef.current?.(pos),
            onFullscreen: () => onFullscreenRef.current?.(),
            disable_keybinds: true,
            quiet: true,
        });
        return () => playerRef.current?.destroy();
    }, []);

    useEffect(() => {
        playerRef.current?.setState(info);
    }, [info]);

    return <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />;
}
