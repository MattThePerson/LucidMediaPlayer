import { useState, useEffect, useCallback, useRef } from 'react';
import {
    OpenVideo, OpenFilePicker, OpenFilePickerMultiple, OpenFolderPicker, GetMediaFilesInFolder,
    OpenPlaylistVideo, LoadFile,
    SwitchTab, CloseTab,
    TogglePlayback, Seek, GetPlaybackInfo, GetAllTabsState,
    ToggleFullscreen, GetVersion, GetRecentFiles, ClearRecentFiles,
    ResizeVideo, SetVolume, GetSeekThumbnailData,
    GetPreferences, SavePreferences, StartSeekThumbnailGeneration, RegenerateSeekThumbnails,
} from '../wailsjs/go/main/App';
import { EventsOn, OnFileDrop, OnFileDropOff } from '../wailsjs/runtime/runtime';
import { debugLog, getDebugLogs } from './debug';
import TabBar from './components/TabBar';
import HomeScreen from './components/HomeScreen';
import PassionPlayerWrapper from './components/PassionPlayerWrapper';
import DebugPage from './components/DebugPage';
import ChangelogPage from './components/ChangelogPage';
import Notification from './components/Notification';
import PreferencesPage from './components/PreferencesPage';
import PlaylistPage from './components/PlaylistPage';

// Each tab: { id, type: 'video'|'debug'|'changelog'|'preferences'|'playlist', title, path? }
const PAGE_TITLES = { debug: 'Debug', changelog: 'Changelog', preferences: 'Settings' };

function App() {
    const [tabs, setTabs] = useState([]);
    const [activeTabId, setActiveTabId] = useState(null);
    const [info, setInfo] = useState({ time_pos: 0, duration: 0, paused: true, volume: 100 });
    const [tabsState, setTabsState] = useState({});
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [version, setVersion] = useState('');
    const [isDragging, setIsDragging] = useState(false);
    const [recentFiles, setRecentFiles] = useState([]);
    const [seekThumbs, setSeekThumbs] = useState(null);
    const [notification, setNotification] = useState(null);
    const [isWorking, setIsWorking] = useState(false);
    const [preferences, setPreferences] = useState({ autogenerateSeekThumbs: false, openInExistingInstance: false, clickToTogglePlayback: false });
    // playlists: { [playlistTabId]: { items, selectedIndex, currentIndex, random, videoTabId, playedIndices } }
    const [playlists, setPlaylists] = useState({});

    const closedTabsRef = useRef([]);
    const notifTimerRef = useRef(null);
    const promptDelayRef = useRef(null);
    const chordActiveRef = useRef(false);
    const chordTimerRef = useRef(null);
    // Refs so event listeners with stale closures can reach current state
    const playlistsRef = useRef(playlists);
    playlistsRef.current = playlists;
    const activeTabRef = useRef(null);
    const activeTabIdRef = useRef(null);

    const activeTab = tabs.find(t => t.id === activeTabId) ?? null;
    activeTabRef.current = activeTab;
    activeTabIdRef.current = activeTabId;

    // The Go tab ID that's actually playing (null when no video is active)
    const effectiveVideoTabId =
        activeTab?.type === 'video' ? activeTabId :
        activeTab?.type === 'playlist' ? (playlists[activeTabId]?.videoTabId ?? null) :
        null;

    // tabsState with playlist tabs mapped to their underlying video tab's play state
    const effectiveTabsState = { ...tabsState };
    for (const [plsTabId, pls] of Object.entries(playlists)) {
        if (pls.videoTabId) effectiveTabsState[plsTabId] = tabsState[pls.videoTabId] ?? false;
    }

    // ── Playlist mutations ──────────────────────────────────────────────────────

    const handlePlaylistAddFiles = useCallback((plsTabId, paths) => {
        setPlaylists(prev => {
            const pls = prev[plsTabId];
            if (!pls) return prev;
            return { ...prev, [plsTabId]: { ...pls, items: [...pls.items, ...paths] } };
        });
    }, []);

    const handlePlaylistRemoveItem = useCallback((plsTabId, index) => {
        setPlaylists(prev => {
            const pls = prev[plsTabId];
            if (!pls) return prev;
            const newItems = pls.items.filter((_, i) => i !== index);
            let sel = pls.selectedIndex;
            if (sel > index) sel--;
            else if (sel === index) sel = newItems.length > 0 ? Math.min(index, newItems.length - 1) : -1;
            let cur = pls.currentIndex;
            if (cur > index) cur--;
            else if (cur === index) cur = -1;
            return { ...prev, [plsTabId]: { ...pls, items: newItems, selectedIndex: sel, currentIndex: cur } };
        });
    }, []);

    const handlePlaylistReorder = useCallback((plsTabId, fromIdx, toIdx) => {
        setPlaylists(prev => {
            const pls = prev[plsTabId];
            if (!pls) return prev;
            const items = [...pls.items];
            const [moved] = items.splice(fromIdx, 1);
            items.splice(toIdx, 0, moved);
            let ci = pls.currentIndex;
            if (ci === fromIdx) ci = toIdx;
            else if (fromIdx < ci && ci <= toIdx) ci--;
            else if (toIdx <= ci && ci < fromIdx) ci++;
            return { ...prev, [plsTabId]: { ...pls, items, currentIndex: ci } };
        });
    }, []);

    const handlePlaylistToggleRandom = useCallback((plsTabId) => {
        setPlaylists(prev => {
            const pls = prev[plsTabId];
            if (!pls) return prev;
            return { ...prev, [plsTabId]: { ...pls, random: !pls.random, playedIndices: [] } };
        });
    }, []);

    // ── Playlist play / advance ─────────────────────────────────────────────────

    const handlePlaylistPlay = useCallback(async (plsTabId, index) => {
        const pls = playlistsRef.current[plsTabId];
        if (!pls || index < 0 || index >= pls.items.length) return;
        const filePath = pls.items[index];
        try {
            let videoTabId = pls.videoTabId;
            if (!videoTabId) {
                videoTabId = await OpenPlaylistVideo(filePath);
                if (activeTabIdRef.current === plsTabId) {
                    await SwitchTab(videoTabId);
                }
            } else {
                await LoadFile(videoTabId, filePath);
            }
            setPlaylists(prev => ({
                ...prev,
                [plsTabId]: {
                    ...prev[plsTabId],
                    currentIndex: index,
                    selectedIndex: index,
                    videoTabId,
                    playedIndices: prev[plsTabId].random
                        ? [...prev[plsTabId].playedIndices.filter(i => i !== index), index]
                        : [],
                },
            }));
            setInfo({ time_pos: 0, duration: 0, paused: false, volume: 100 });
        } catch (e) {
            debugLog('PlaylistPlay', 'ERROR: ' + e);
        }
    }, []);

    const handlePlaylistNext = useCallback((plsTabId) => {
        const pls = playlistsRef.current[plsTabId];
        if (!pls || pls.items.length === 0) return;
        let nextIndex;
        if (pls.random) {
            const allIdxs = pls.items.map((_, i) => i);
            const unplayed = allIdxs.filter(i => !pls.playedIndices.includes(i) && i !== pls.currentIndex);
            if (unplayed.length === 0) {
                // All played: restart random
                setPlaylists(prev => ({ ...prev, [plsTabId]: { ...prev[plsTabId], playedIndices: [] } }));
                const candidates = allIdxs.filter(i => i !== pls.currentIndex);
                if (candidates.length === 0) return;
                nextIndex = candidates[Math.floor(Math.random() * candidates.length)];
            } else {
                nextIndex = unplayed[Math.floor(Math.random() * unplayed.length)];
            }
        } else {
            nextIndex = pls.currentIndex + 1;
            if (nextIndex >= pls.items.length) return; // end of playlist, stop
        }
        handlePlaylistPlay(plsTabId, nextIndex);
    }, [handlePlaylistPlay]);

    const handlePlaylistPrev = useCallback((plsTabId) => {
        const pls = playlistsRef.current[plsTabId];
        if (!pls || pls.items.length === 0) return;
        const prevIndex = Math.max(0, pls.currentIndex - 1);
        handlePlaylistPlay(plsTabId, prevIndex);
    }, [handlePlaylistPlay]);

    // Keep a stable ref so the event listener registered once can call current handlePlaylistNext
    const handlePlaylistNextRef = useRef(handlePlaylistNext);
    handlePlaylistNextRef.current = handlePlaylistNext;

    // ── Playlist tab creation ───────────────────────────────────────────────────

    const openNewPlaylist = useCallback((initialItems = []) => {
        const id = `playlist-${Date.now()}`;
        SwitchTab('').catch(console.error);
        setPlaylists(prev => ({
            ...prev,
            [id]: { items: initialItems, selectedIndex: -1, currentIndex: -1, random: false, videoTabId: null, playedIndices: [] },
        }));
        setTabs(prev => [...prev, { id, type: 'playlist', title: 'Playlist' }]);
        setActiveTabId(id);
    }, []);

    const openFolderAsPlaylist = useCallback(async () => {
        try {
            const folder = await OpenFolderPicker();
            if (!folder) return;
            const files = await GetMediaFilesInFolder(folder);
            if (!files?.length) return;
            openNewPlaylist(files);
        } catch (e) {
            debugLog('OpenFolderAsPlaylist', 'ERROR: ' + e);
        }
    }, [openNewPlaylist]);

    // ── Core callbacks ──────────────────────────────────────────────────────────

    const openVideoPath = useCallback(async (filePath) => {
        const filename = filePath.split(/[\\/]/).pop();
        debugLog('OpenVideo', 'opening: ' + filePath);
        try {
            const tabId = await OpenVideo(filePath);
            debugLog('OpenVideo', 'success tabId=' + tabId);
            setTabs(prev => [...prev, { id: tabId, type: 'video', title: filename, path: filePath }]);
            await SwitchTab(tabId);
            setActiveTabId(tabId);
            setInfo({ time_pos: 0, duration: 0, paused: true, volume: 100 });
            GetRecentFiles().then(setRecentFiles).catch(() => {});
        } catch (e) {
            debugLog('OpenVideo', 'ERROR: ' + e);
        }
    }, []);

    const handlePlaylistAddFilesRef = useRef(handlePlaylistAddFiles);
    handlePlaylistAddFilesRef.current = handlePlaylistAddFiles;

    useEffect(() => {
        GetVersion().then(setVersion).catch(() => {});
        GetRecentFiles().then(setRecentFiles).catch(() => {});
        GetPreferences().then(setPreferences).catch(() => {});

        const offDebugLog = EventsOn('debug-log', (payload) => {
            debugLog(payload?.source ?? 'go', payload?.message ?? String(payload));
        });
        const offFullscreen = EventsOn('fullscreen-changed', setIsFullscreen);
        const offOpenFile = EventsOn('open-file', (path) => {
            // Drop into playlist if active, otherwise open new tab
            if (activeTabRef.current?.type === 'playlist') {
                handlePlaylistAddFilesRef.current(activeTabIdRef.current, [path]);
            } else {
                openVideoPath(path);
            }
        });

        // Listen for playlist-video-ended (emitted by Go when eof-reached fires in playlist mpv)
        const offPlaylistEnded = EventsOn('playlist-video-ended', (goTabId) => {
            const pls = playlistsRef.current;
            const plsTabId = Object.keys(pls).find(k => pls[k].videoTabId === goTabId);
            if (plsTabId) handlePlaylistNextRef.current(plsTabId);
        });

        OnFileDrop(async (x, y, paths) => {
            debugLog('OnFileDrop', `x=${x} y=${y} paths=${paths.join(', ')}`);
            if (activeTabRef.current?.type === 'playlist') {
                handlePlaylistAddFilesRef.current(activeTabIdRef.current, paths);
            } else {
                for (const p of paths) await openVideoPath(p);
            }
        }, false);

        const onDragEnter = () => { setIsDragging(true); };
        const onDragOver = (e) => e.preventDefault();
        const onDragLeave = (e) => { if (!e.relatedTarget) setIsDragging(false); };
        const onDrop = (e) => {
            e.preventDefault();
            setIsDragging(false);
            const files = [...(e.dataTransfer?.files ?? [])].map(f => f.name);
            debugLog('Drag', 'browser drop (fallback) — ' + (files.length ? files.join(', ') : 'no files'));
        };
        window.addEventListener('dragenter', onDragEnter);
        window.addEventListener('dragover', onDragOver);
        window.addEventListener('dragleave', onDragLeave);
        window.addEventListener('drop', onDrop);
        return () => {
            offDebugLog?.();
            offFullscreen?.();
            offOpenFile?.();
            offPlaylistEnded?.();
            OnFileDropOff();
            window.removeEventListener('dragenter', onDragEnter);
            window.removeEventListener('dragover', onDragOver);
            window.removeEventListener('dragleave', onDragLeave);
            window.removeEventListener('drop', onDrop);
        };
    }, [openVideoPath]);

    // Poll playback info when a video tab or playing playlist tab is active
    useEffect(() => {
        if (!effectiveVideoTabId) return;
        const id = setInterval(() => {
            GetPlaybackInfo(effectiveVideoTabId).then(setInfo).catch(() => {});
        }, 500);
        return () => clearInterval(id);
    }, [effectiveVideoTabId]);

    // Load seek thumbnails on tab switch (video tabs only)
    useEffect(() => {
        if (!activeTabId || activeTab?.type !== 'video') {
            setSeekThumbs(null);
            setNotification(null);
            setIsWorking(false);
            clearTimeout(notifTimerRef.current);
            clearTimeout(promptDelayRef.current);
            return;
        }

        GetSeekThumbnailData(activeTabId).then(d => {
            if (d?.ready) {
                setSeekThumbs({ vtt: d.vtt, spritesheetBase64: d.spritesheetBase64 });
            } else {
                setSeekThumbs(null);
                if (!preferences.autogenerateSeekThumbs) {
                    promptDelayRef.current = setTimeout(() => {
                        setNotification({ type: 'prompt', message: 'Press F5 to generate seek thumbnails' });
                        notifTimerRef.current = setTimeout(() => setNotification(null), 2000);
                    }, 1500);
                }
            }
        }).catch(() => setSeekThumbs(null));

        const offGenerating = EventsOn('seek-thumbs-generating', (tabID) => {
            if (tabID !== activeTabId) return;
            clearTimeout(notifTimerRef.current);
            clearTimeout(promptDelayRef.current);
            setIsWorking(true);
            setNotification({ type: 'generating', message: 'Generating seek thumbnails...' });
            notifTimerRef.current = setTimeout(() => setNotification(null), 2000);
        });

        const offReady = EventsOn('seek-thumbs-ready', (tabID) => {
            if (tabID !== activeTabId) return;
            clearTimeout(notifTimerRef.current);
            clearTimeout(promptDelayRef.current);
            setIsWorking(false);
            setNotification({ type: 'done', message: 'Seek thumbnails ready!' });
            notifTimerRef.current = setTimeout(() => setNotification(null), 2000);
            GetSeekThumbnailData(tabID).then(d => {
                if (d?.ready) setSeekThumbs({ vtt: d.vtt, spritesheetBase64: d.spritesheetBase64 });
            }).catch(() => {});
        });

        return () => {
            offGenerating?.();
            offReady?.();
            clearTimeout(notifTimerRef.current);
            clearTimeout(promptDelayRef.current);
            setIsWorking(false);
        };
    }, [activeTabId, activeTab?.type, preferences.autogenerateSeekThumbs]);

    useEffect(() => {
        const id = setInterval(() => {
            GetAllTabsState().then(setTabsState).catch(() => {});
        }, 1000);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        let timer;
        const onResize = () => {
            clearTimeout(timer);
            timer = setTimeout(() => ResizeVideo().catch(() => {}), 200);
        };
        window.addEventListener('resize', onResize);
        return () => { clearTimeout(timer); window.removeEventListener('resize', onResize); };
    }, []);

    const handleSwitchTab = useCallback(async (tabId) => {
        if (tabId === activeTabId) return;
        const tab = tabId ? tabs.find(t => t.id === tabId) : null;
        let goTabId = '';
        if (tab?.type === 'video') goTabId = tabId;
        else if (tab?.type === 'playlist') goTabId = playlists[tabId]?.videoTabId ?? '';
        await SwitchTab(goTabId);
        setActiveTabId(tabId ?? null);
        if (!goTabId) setInfo({ time_pos: 0, duration: 0, paused: true, volume: 100 });
    }, [activeTabId, tabs, playlists]);

    const handleCloseTab = useCallback(async (tabId) => {
        const idx = tabs.findIndex(t => t.id === tabId);
        const tab = tabs.find(t => t.id === tabId);

        if (tab) {
            closedTabsRef.current.push({ type: tab.type, path: tab.path });
        }

        if (tab?.type === 'video') {
            await CloseTab(tabId);
        } else if (tab?.type === 'playlist') {
            const pls = playlists[tabId];
            if (pls?.videoTabId) await CloseTab(pls.videoTabId);
            setPlaylists(prev => { const n = { ...prev }; delete n[tabId]; return n; });
        }

        const newTabs = tabs.filter(t => t.id !== tabId);
        setTabs(newTabs);

        if (tabId === activeTabId) {
            const next = newTabs[Math.min(idx, newTabs.length - 1)] ?? null;
            let nextGoTabId = '';
            if (next?.type === 'video') nextGoTabId = next.id;
            else if (next?.type === 'playlist') nextGoTabId = playlists[next.id]?.videoTabId ?? '';
            await SwitchTab(nextGoTabId);
            setActiveTabId(next?.id ?? null);
            if (!nextGoTabId) setInfo({ time_pos: 0, duration: 0, paused: true, volume: 100 });
        }
    }, [tabs, activeTabId, playlists]);

    const openPageTab = useCallback((type) => {
        const existing = tabs.find(t => t.type === type);
        if (existing) {
            handleSwitchTab(existing.id);
            return;
        }
        const id = `${type}-${Date.now()}`;
        SwitchTab('').catch(console.error);
        setTabs(prev => [...prev, { id, type, title: PAGE_TITLES[type] }]);
        setActiveTabId(id);
    }, [tabs, handleSwitchTab]);

    const handleClearRecent = useCallback(() => {
        ClearRecentFiles().catch(console.error);
        setRecentFiles([]);
    }, []);

    const handleReorderTab = useCallback((fromId, toId) => {
        setTabs(prev => {
            const fromIdx = prev.findIndex(t => t.id === fromId);
            const toIdx = prev.findIndex(t => t.id === toId);
            if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
            const next = [...prev];
            const [moved] = next.splice(fromIdx, 1);
            next.splice(toIdx, 0, moved);
            return next;
        });
    }, []);

    const handleTogglePlayback = useCallback(() => {
        const vidId = effectiveVideoTabId;
        if (!vidId) return;
        debugLog('App', `handleTogglePlayback @ ${Date.now()}`);
        TogglePlayback(vidId).catch(console.error);
        setTimeout(() => {
            GetPlaybackInfo(vidId).then(setInfo).catch(() => {});
            GetAllTabsState().then(setTabsState).catch(() => {});
        }, 50);
    }, [effectiveVideoTabId]);

    const handleOpenFile = useCallback(async () => {
        try {
            if (activeTab?.type === 'playlist') {
                const paths = await OpenFilePickerMultiple();
                if (paths?.length) handlePlaylistAddFiles(activeTabId, paths);
            } else {
                const filePath = await OpenFilePicker();
                if (!filePath) return;
                debugLog('OpenFilePicker', 'selected: ' + filePath);
                await openVideoPath(filePath);
            }
        } catch (e) {
            debugLog('OpenFilePicker', 'ERROR: ' + e);
        }
    }, [activeTab?.type, activeTabId, openVideoPath, handlePlaylistAddFiles]);

    const handleVolumeChange = useCallback((vol) => {
        const vidId = effectiveVideoTabId;
        if (!vidId) return;
        SetVolume(vidId, vol).catch(console.error);
    }, [effectiveVideoTabId]);

    const handleSavePreferences = useCallback((prefs) => {
        SavePreferences(prefs).catch(console.error);
        setPreferences(prefs);
    }, []);

    useEffect(() => {
        const onKey = (e) => {
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;

            const isVideo = activeTab?.type === 'video';
            const isPlaylistPlaying = activeTab?.type === 'playlist' && playlists[activeTabId]?.videoTabId;
            const isVideoActive = isVideo || isPlaylistPlaying;

            // Ctrl+K chord — start a 1s window for Ctrl+K → Ctrl+O (open folder as playlist)
            if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyK') {
                e.preventDefault();
                clearTimeout(chordTimerRef.current);
                chordActiveRef.current = true;
                chordTimerRef.current = setTimeout(() => { chordActiveRef.current = false; }, 1000);
                return;
            }

            if (e.code === 'Space' && isVideoActive) {
                e.preventDefault();
                handleTogglePlayback();
            }
            if (e.code === 'KeyS' && isVideoActive && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                handleTogglePlayback();
            }
            if (e.code === 'KeyF') ToggleFullscreen().catch(console.error);
            if (e.code === 'Escape' && isFullscreen) {
                e.preventDefault();
                ToggleFullscreen().catch(console.error);
            }
            if (e.code === 'F3') { e.preventDefault(); openPageTab('debug'); }
            if (e.code === 'F5' && isVideo) {
                e.preventDefault();
                if (e.shiftKey) {
                    RegenerateSeekThumbnails(activeTabId).catch(console.error);
                } else {
                    StartSeekThumbnailGeneration(activeTabId).catch(console.error);
                }
            }

            // N / P — next/previous in playlist
            if (e.code === 'KeyN' && !e.ctrlKey && !e.altKey && !e.shiftKey && isPlaylistPlaying) {
                e.preventDefault();
                handlePlaylistNext(activeTabId);
            }
            if (e.code === 'KeyP' && !e.ctrlKey && !e.altKey && !e.shiftKey && isPlaylistPlaying) {
                e.preventDefault();
                handlePlaylistPrev(activeTabId);
            }

            if (e.ctrlKey && e.code === 'KeyO' && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                if (chordActiveRef.current) {
                    clearTimeout(chordTimerRef.current);
                    chordActiveRef.current = false;
                    openFolderAsPlaylist();
                } else {
                    handleOpenFile();
                }
            }
            if (e.ctrlKey && e.code === 'Comma' && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                openPageTab('preferences');
            }
            if (e.ctrlKey && e.shiftKey && e.code === 'KeyC') {
                const text = getDebugLogs().map(e => `${e.time} [${e.source}] ${e.message}`).join('\n');
                navigator.clipboard.writeText(text).catch(() => {});
            }
            if (e.ctrlKey && e.code === 'KeyW' && activeTabId) {
                e.preventDefault();
                handleCloseTab(activeTabId);
            }
            if (e.ctrlKey && e.shiftKey && e.code === 'KeyT') {
                e.preventDefault();
                const last = closedTabsRef.current.pop();
                if (!last) return;
                if (last.type === 'video' && last.path) {
                    openVideoPath(last.path);
                } else if (last.type === 'playlist') {
                    openNewPlaylist();
                } else if (last.type !== 'video') {
                    openPageTab(last.type);
                }
            }
            if (e.ctrlKey && e.code === 'Tab' && tabs.length > 1) {
                e.preventDefault();
                const idx = tabs.findIndex(t => t.id === activeTabId);
                const next = e.shiftKey
                    ? (idx - 1 + tabs.length) % tabs.length
                    : (idx + 1) % tabs.length;
                handleSwitchTab(tabs[next].id);
            }
            if (e.ctrlKey && e.shiftKey && (e.code === 'PageUp' || e.code === 'PageDown') && activeTabId) {
                e.preventDefault();
                const dir = e.code === 'PageUp' ? -1 : 1;
                setTabs(prev => {
                    const idx = prev.findIndex(t => t.id === activeTabId);
                    const newIdx = idx + dir;
                    if (newIdx < 0 || newIdx >= prev.length) return prev;
                    const next = [...prev];
                    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
                    return next;
                });
            }

            if (e.altKey && !e.ctrlKey && !e.shiftKey) {
                const m = e.code.match(/^Digit([1-9])$/);
                if (m) {
                    e.preventDefault();
                    const idx = parseInt(m[1]) - 1;
                    if (idx < tabs.length) handleSwitchTab(tabs[idx].id);
                }
            }

            // Seek shortcuts (video tabs and playing playlists, with known duration)
            if (isVideoActive && info.duration > 0) {
                const vidId = effectiveVideoTabId;
                const seekBy = (delta) => {
                    const newFrac = Math.max(0, Math.min(1, (info.time_pos + delta) / info.duration));
                    Seek(vidId, newFrac).catch(console.error);
                };
                if (!e.ctrlKey && !e.altKey) {
                    if (e.code === 'ArrowLeft') { e.preventDefault(); seekBy(-7); }
                    if (e.code === 'ArrowRight') { e.preventDefault(); seekBy(7); }
                    if (!e.shiftKey) {
                        if (e.code === 'KeyA') { e.preventDefault(); seekBy(-7); }
                        if (e.code === 'KeyD') { e.preventDefault(); seekBy(7); }
                    } else {
                        if (e.code === 'KeyA') { e.preventDefault(); seekBy(-2); }
                        if (e.code === 'KeyD') { e.preventDefault(); seekBy(2); }
                    }
                }
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [activeTabId, activeTab, tabs, isFullscreen, info, playlists,
        effectiveVideoTabId, handleCloseTab, handleSwitchTab, handleTogglePlayback,
        handleOpenFile, openPageTab, openVideoPath, openNewPlaylist, openFolderAsPlaylist,
        handlePlaylistNext, handlePlaylistPrev, setTabs]);

    const isPlaylistPlaying = activeTab?.type === 'playlist' && !!playlists[activeTabId]?.videoTabId;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
            {!isFullscreen && (
                <TabBar
                    tabs={tabs}
                    activeTabId={activeTabId}
                    tabsState={effectiveTabsState}
                    onSwitch={handleSwitchTab}
                    onClose={handleCloseTab}
                    onOpenFile={handleOpenFile}
                    onOpenDebug={() => openPageTab('debug')}
                    onOpenChangelog={() => openPageTab('changelog')}
                    onOpenPreferences={() => openPageTab('preferences')}
                    onNewPlaylist={openNewPlaylist}
                    onOpenFolderAsPlaylist={openFolderAsPlaylist}
                    onReorder={handleReorderTab}
                    recentFiles={recentFiles}
                    onOpenRecent={openVideoPath}
                    onClearRecent={handleClearRecent}
                    version={version}
                    isWorking={isWorking}
                />
            )}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                {!activeTabId && (
                    <HomeScreen version={version} isDragging={isDragging} onOpenChangelog={() => openPageTab('changelog')} />
                )}
                {(activeTab?.type === 'video' || isPlaylistPlaying) && (
                    <>
                        <PassionPlayerWrapper
                            info={info}
                            seekThumbs={activeTab?.type === 'video' ? seekThumbs : null}
                            onTogglePlayback={handleTogglePlayback}
                            onSeek={(pos) => Seek(effectiveVideoTabId, pos).catch(console.error)}
                            onFullscreen={() => ToggleFullscreen().catch(console.error)}
                            onVolumeChange={handleVolumeChange}
                            clickToTogglePlayback={preferences.clickToTogglePlayback}
                        />
                        {activeTab?.type === 'video' && <Notification notification={notification} />}
                    </>
                )}
                {activeTab?.type === 'playlist' && !isPlaylistPlaying && (
                    <PlaylistPage
                        playlist={playlists[activeTabId]}
                        onPlay={(idx) => handlePlaylistPlay(activeTabId, idx)}
                        onRemove={(idx) => handlePlaylistRemoveItem(activeTabId, idx)}
                        onReorder={(from, to) => handlePlaylistReorder(activeTabId, from, to)}
                        onToggleRandom={() => handlePlaylistToggleRandom(activeTabId)}
                        onAddFiles={handleOpenFile}
                        onSelectionChange={(idx) => setPlaylists(prev => ({
                            ...prev,
                            [activeTabId]: { ...prev[activeTabId], selectedIndex: idx },
                        }))}
                    />
                )}
                {activeTab?.type === 'debug' && <DebugPage />}
                {activeTab?.type === 'changelog' && <ChangelogPage />}
                {activeTab?.type === 'preferences' && (
                    <PreferencesPage preferences={preferences} onSave={handleSavePreferences} />
                )}
            </div>
        </div>
    );
}

export default App;
