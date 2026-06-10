import { useState, useEffect, useCallback, useRef } from 'react';
import {
    OpenVideo, OpenFilePicker, OpenFilePickerMultiple, OpenFolderPicker, GetMediaFilesInFolder,
    OpenPlaylistVideo, LoadFile,
    SwitchTab, CloseTab,
    TogglePlayback, Seek, GetPlaybackInfo, GetAllTabsState,
    ToggleFullscreen, GetVersion, GetRecentFiles, ClearRecentFiles,
    ResizeVideo, SetVolume, GetSeekThumbnailData,
    GetPreferences, SavePreferences, StartSeekThumbnailGeneration, RegenerateSeekThumbnails,
    GetSubtitleState, SetSubtitleTrack, AddSubtitleFile, OpenSubtitleFilePicker,
    FrameStep, SetPlaybackSpeed, SetVideoFilter,
    GetProfileInfo, GetProfiles, CreateProfile, RenameProfile, SetProfileColor,
    DeleteProfile, ReorderProfiles, OpenProfile, TearOffTab,
    RenameVideoFile,
    RevealInExplorer,
} from '../wailsjs/go/main/App';
import { EventsOn, OnFileDrop, OnFileDropOff } from '../wailsjs/runtime/runtime';
import { debugLog, getDebugLogs } from './debug';
import TabBar from './components/TabBar';
import RecentFilesOverlay from './components/RecentFilesOverlay';
import RenameBar from './components/RenameBar';
import TabContextMenu from './components/TabContextMenu';
import HomeScreen from './components/HomeScreen';
import PassionPlayerWrapper from './components/PassionPlayerWrapper';
import DebugPage from './components/DebugPage';
import ChangelogPage from './components/ChangelogPage';
import Notification from './components/Notification';
import PreferencesPage from './components/PreferencesPage';
import PlaylistPage from './components/PlaylistPage';
import FileExplorerPage from './components/FileExplorerPage';
import ManageProfilesPage from './components/ManageProfilesPage';
import DebugHUD from './components/DebugHUD';
import type { Tab, PlaylistState, PlaylistsMap, FileExplorerState, FileExplorersMap, FileExplorerViewType, FileExplorerSortBy, TabsStateMap, SeekThumbs, NotificationEntry, ClosedTabEntry, PageTabType } from './types';
import type { main, db } from '../wailsjs/go/models';

const PAGE_TITLES: Record<PageTabType, string> = { debug: 'Debug', changelog: 'Changelog', preferences: 'Settings', manageprofiles: 'Profiles' };
const extname = (p: string) => { const i = p.lastIndexOf('.'); return i >= 0 ? p.slice(i) : ''; };

function App() {
    const [tabs, setTabs] = useState<Tab[]>([]);
    const [activeTabId, setActiveTabId] = useState<string | null>(null);
    const [info, setInfo] = useState<main.PlaybackInfo>({ time_pos: 0, duration: 0, paused: true, volume: 100 } as main.PlaybackInfo);
    const [tabsState, setTabsState] = useState<TabsStateMap>({});
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [version, setVersion] = useState('');
    const [profileInfo, setProfileInfo] = useState<main.ProfileInfo>({ id: '', name: '', color: '' } as main.ProfileInfo);
    const [profiles, setProfiles] = useState<main.ProfileEntry[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [recentFiles, setRecentFiles] = useState<db.RecentEntry[]>([]);
    const [seekThumbs, setSeekThumbs] = useState<SeekThumbs | null>(null);
    const [notification, setNotification] = useState<NotificationEntry | null>(null);
    const [isWorking, setIsWorking] = useState(false);
    const [subtitleText, setSubtitleText] = useState('');
    const [subtitleTracks, setSubtitleTracks] = useState<main.TrackInfo[]>([]);
    const [activeSid, setActiveSid] = useState(0);
    const [recentOverlayOpen, setRecentOverlayOpen] = useState(false);
    const [videoUIVisible, setVideoUIVisible] = useState(false);
    const [debugHUDOpen, setDebugHUDOpen] = useState(false);
    const [viewportH, setViewportH] = useState(window.innerHeight);
    const [preferences, setPreferences] = useState<main.Preferences>({ autogenerateSeekThumbs: false, openInExistingInstance: false, clickToTogglePlayback: false, oneVideoAtATime: false } as main.Preferences);
    const [playlists, setPlaylists] = useState<PlaylistsMap>({});
    const [fileExplorers, setFileExplorers] = useState<FileExplorersMap>({});
    const [renameTabId, setRenameTabId] = useState<string | null>(null);
    const [renameHistory, setRenameHistory] = useState<Map<string, string[]>>(new Map());
    const [tabContextMenu, setTabContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);

    const closedTabsRef = useRef<ClosedTabEntry[]>([]);
    const notifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const promptDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const localTimeRef = useRef(0);
    const chordActiveRef = useRef(false);
    const chordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const autoPausedTabIdRef = useRef<string | null>(null);
    const playlistsRef = useRef<PlaylistsMap>(playlists);
    playlistsRef.current = playlists;
    const fileExplorersRef = useRef<FileExplorersMap>(fileExplorers);
    fileExplorersRef.current = fileExplorers;
    const renameTabIdRef = useRef<string | null>(null);
    renameTabIdRef.current = renameTabId;
    const activeTabRef = useRef<Tab | null>(null);
    const activeTabIdRef = useRef<string | null>(null);
    const preferencesRef = useRef<main.Preferences>(preferences);
    preferencesRef.current = preferences;
    const infoRef = useRef<main.PlaybackInfo>(info);
    infoRef.current = info;
    const tabsStateRef = useRef<TabsStateMap>(tabsState);
    tabsStateRef.current = tabsState;

    const activeTab = tabs.find(t => t.id === activeTabId) ?? null;
    activeTabRef.current = activeTab;
    activeTabIdRef.current = activeTabId;

    const effectiveVideoTabId: string | null =
        activeTab?.type === 'video' ? activeTabId :
        activeTab?.type === 'playlist' ? (activeTabId ? (playlists[activeTabId]?.videoTabId ?? null) : null) :
        activeTab?.type === 'fileexplorer' ? (activeTabId ? (fileExplorers[activeTabId]?.videoTabId ?? null) : null) :
        null;
    const effectiveVideoTabIdRef = useRef<string | null>(effectiveVideoTabId);
    effectiveVideoTabIdRef.current = effectiveVideoTabId;

    const effectiveTabsState: TabsStateMap = { ...tabsState };
    for (const [plsTabId, pls] of Object.entries(playlists)) {
        if (pls.videoTabId) effectiveTabsState[plsTabId] = tabsState[pls.videoTabId] ?? false;
    }
    for (const [exTabId, ex] of Object.entries(fileExplorers)) {
        if (ex.videoTabId) effectiveTabsState[exTabId] = tabsState[ex.videoTabId] ?? false;
    }

    // ── Playlist mutations ──────────────────────────────────────────────────────

    const handlePlaylistAddFiles = useCallback((plsTabId: string, paths: string[]) => {
        setPlaylists(prev => {
            const pls = prev[plsTabId];
            if (!pls) return prev;
            return { ...prev, [plsTabId]: { ...pls, items: [...pls.items, ...paths] } };
        });
    }, []);

    const handlePlaylistRemoveItem = useCallback((plsTabId: string, index: number) => {
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

    const handlePlaylistReorder = useCallback((plsTabId: string, fromIdx: number, toIdx: number) => {
        setPlaylists(prev => {
            const pls = prev[plsTabId];
            if (!pls) return prev;
            const items = [...pls.items];
            const moved = items.splice(fromIdx, 1)[0]!;
            items.splice(toIdx, 0, moved);
            let ci = pls.currentIndex;
            if (ci === fromIdx) ci = toIdx;
            else if (fromIdx < ci && ci <= toIdx) ci--;
            else if (toIdx <= ci && ci < fromIdx) ci++;
            return { ...prev, [plsTabId]: { ...pls, items, currentIndex: ci } };
        });
    }, []);

    const handlePlaylistToggleRandom = useCallback((plsTabId: string) => {
        setPlaylists(prev => {
            const pls = prev[plsTabId];
            if (!pls) return prev;
            return { ...prev, [plsTabId]: { ...pls, random: !pls.random, playedIndices: [] } };
        });
    }, []);

    // ── Playlist play / advance ─────────────────────────────────────────────────

    const handlePlaylistPlay = useCallback(async (plsTabId: string, index: number) => {
        const pls = playlistsRef.current[plsTabId];
        if (!pls || index < 0 || index >= pls.items.length) return;
        const filePath = pls.items[index]!;
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
                    playedIndices: prev[plsTabId]!.random
                        ? [...prev[plsTabId]!.playedIndices.filter(i => i !== index), index]
                        : [],
                } as PlaylistState,
            }));
            setInfo({ time_pos: 0, duration: 0, paused: false } as main.PlaybackInfo);
        } catch (e) {
            debugLog('PlaylistPlay', 'ERROR: ' + e);
        }
    }, []);

    const handlePlaylistNext = useCallback((plsTabId: string) => {
        const pls = playlistsRef.current[plsTabId];
        if (!pls || pls.items.length === 0) return;
        let nextIndex: number;
        if (pls.random) {
            const allIdxs = pls.items.map((_, i) => i);
            const unplayed = allIdxs.filter(i => !pls.playedIndices.includes(i) && i !== pls.currentIndex);
            if (unplayed.length === 0) {
                setPlaylists(prev => ({ ...prev, [plsTabId]: { ...prev[plsTabId]!, playedIndices: [] } }));
                const candidates = allIdxs.filter(i => i !== pls.currentIndex);
                if (candidates.length === 0) return;
                nextIndex = candidates[Math.floor(Math.random() * candidates.length)]!;
            } else {
                nextIndex = unplayed[Math.floor(Math.random() * unplayed.length)]!;
            }
        } else {
            nextIndex = pls.currentIndex + 1;
            if (nextIndex >= pls.items.length) return;
        }
        handlePlaylistPlay(plsTabId, nextIndex);
    }, [handlePlaylistPlay]);

    const handlePlaylistPrev = useCallback((plsTabId: string) => {
        const pls = playlistsRef.current[plsTabId];
        if (!pls || pls.items.length === 0) return;
        const prevIndex = Math.max(0, pls.currentIndex - 1);
        handlePlaylistPlay(plsTabId, prevIndex);
    }, [handlePlaylistPlay]);

    const handlePlaylistNextRef = useRef(handlePlaylistNext);
    handlePlaylistNextRef.current = handlePlaylistNext;

    // ── Playlist tab creation ───────────────────────────────────────────────────

    const openNewPlaylist = useCallback((initialItems: string[] = []) => {
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
            debugLog('OpenFolderAsPlaylist', 'folder: ' + folder);
            const files = await GetMediaFilesInFolder(folder);
            debugLog('OpenFolderAsPlaylist', `found ${files?.length ?? 0} files`);
            if (!files?.length) return;
            openNewPlaylist(files);
        } catch (e) {
            debugLog('OpenFolderAsPlaylist', 'ERROR: ' + e);
        }
    }, [openNewPlaylist]);

    // ── File explorer tab creation ──────────────────────────────────────────────

    const openFileExplorer = useCallback(async () => {
        try {
            const folder = await OpenFolderPicker();
            if (!folder) return;
            const id = `fileexplorer-${Date.now()}`;
            const folderName = folder.split(/[\\/]/).pop() || folder;
            SwitchTab('').catch(console.error);
            setFileExplorers(prev => ({
                ...prev,
                [id]: {
                    currentPath: folder,
                    history: [],
                    forwardHistory: [],
                    viewType: 'details',
                    gridSize: 160,
                    sortBy: 'name',
                    sortDir: 'asc',
                    selectedPath: null,
                    videoTabId: null,
                    playingPath: null,
                },
            }));
            setTabs(prev => [...prev, { id, type: 'fileexplorer', title: folderName }]);
            setActiveTabId(id);
        } catch (e) {
            debugLog('OpenFolder', 'ERROR: ' + e);
        }
    }, []);

    const handleExplorerNavigate = useCallback((exTabId: string, path: string) => {
        setFileExplorers(prev => {
            const ex = prev[exTabId];
            if (!ex) return prev;
            return {
                ...prev,
                [exTabId]: {
                    ...ex,
                    history: [...ex.history, ex.currentPath],
                    forwardHistory: [],
                    currentPath: path,
                    selectedPath: null,
                },
            };
        });
        setTabs(prev => prev.map(t => t.id === exTabId
            ? { ...t, title: path.split(/[\\/]/).pop() || path }
            : t
        ));
    }, []);

    const handleExplorerBack = useCallback((exTabId: string) => {
        setFileExplorers(prev => {
            const ex = prev[exTabId];
            if (!ex || ex.history.length === 0) return prev;
            const prevPath = ex.history[ex.history.length - 1]!;
            return {
                ...prev,
                [exTabId]: {
                    ...ex,
                    history: ex.history.slice(0, -1),
                    forwardHistory: [ex.currentPath, ...ex.forwardHistory],
                    currentPath: prevPath,
                    selectedPath: null,
                },
            };
        });
    }, []);

    const handleExplorerForward = useCallback((exTabId: string) => {
        setFileExplorers(prev => {
            const ex = prev[exTabId];
            if (!ex || ex.forwardHistory.length === 0) return prev;
            const nextPath = ex.forwardHistory[0]!;
            return {
                ...prev,
                [exTabId]: {
                    ...ex,
                    history: [...ex.history, ex.currentPath],
                    forwardHistory: ex.forwardHistory.slice(1),
                    currentPath: nextPath,
                    selectedPath: null,
                },
            };
        });
    }, []);

    const handleExplorerUp = useCallback((exTabId: string) => {
        const ex = fileExplorersRef.current[exTabId];
        if (!ex) return;
        const sep = ex.currentPath.includes('\\') ? '\\' : '/';
        const parts = ex.currentPath.replace(/[/\\]+$/, '').split(sep).filter(Boolean);
        if (parts.length <= 1) return;
        const parent = parts.slice(0, -1).join(sep) + (parts.length === 2 && parts[0]!.endsWith(':') ? sep : '');
        handleExplorerNavigate(exTabId, parent);
    }, [handleExplorerNavigate]);

    const handleExplorerPlayFile = useCallback(async (exTabId: string, filePath: string) => {
        const ex = fileExplorersRef.current[exTabId];
        if (!ex) return;
        try {
            let videoTabId = ex.videoTabId;
            if (!videoTabId) {
                videoTabId = await OpenPlaylistVideo(filePath);
                if (activeTabIdRef.current === exTabId) {
                    await SwitchTab(videoTabId);
                }
            } else {
                await LoadFile(videoTabId, filePath);
            }
            setFileExplorers(prev => ({
                ...prev,
                [exTabId]: { ...prev[exTabId]!, videoTabId, playingPath: filePath },
            }));
            setInfo({ time_pos: 0, duration: 0, paused: false } as main.PlaybackInfo);
        } catch (e) {
            debugLog('ExplorerPlay', 'ERROR: ' + e);
        }
    }, []);

    const handleExplorerCloseVideo = useCallback(async () => {
        const exTabId = activeTabIdRef.current;
        if (!exTabId) return;
        const ex = fileExplorersRef.current[exTabId];
        if (!ex?.videoTabId) return;
        await CloseTab(ex.videoTabId);
        setFileExplorers(prev => ({
            ...prev,
            [exTabId]: { ...prev[exTabId]!, videoTabId: null, playingPath: null },
        }));
        await SwitchTab('');
        setInfo({ time_pos: 0, duration: 0, paused: true } as main.PlaybackInfo);
    }, []);

    const handleExplorerViewChange = useCallback((exTabId: string, view: FileExplorerViewType) => {
        setFileExplorers(prev => ({ ...prev, [exTabId]: { ...prev[exTabId]!, viewType: view } }));
    }, []);

    const handleExplorerGridSizeChange = useCallback((exTabId: string, size: number) => {
        setFileExplorers(prev => ({ ...prev, [exTabId]: { ...prev[exTabId]!, gridSize: size } }));
    }, []);

    const handleExplorerSortChange = useCallback((exTabId: string, sortBy: FileExplorerSortBy, sortDir: 'asc' | 'desc') => {
        setFileExplorers(prev => ({ ...prev, [exTabId]: { ...prev[exTabId]!, sortBy, sortDir } }));
    }, []);

    const handleExplorerSelectionChange = useCallback((exTabId: string, path: string | null) => {
        setFileExplorers(prev => ({ ...prev, [exTabId]: { ...prev[exTabId]!, selectedPath: path } }));
    }, []);

    const handlePlaylistCloseVideo = useCallback(async () => {
        const plsTabId = activeTabIdRef.current;
        if (!plsTabId) return;
        const pls = playlistsRef.current[plsTabId];
        if (!pls?.videoTabId) return;
        await CloseTab(pls.videoTabId);
        setPlaylists(prev => ({
            ...prev,
            [plsTabId]: { ...prev[plsTabId]!, videoTabId: null },
        }));
        await SwitchTab('');
        setInfo({ time_pos: 0, duration: 0, paused: true } as main.PlaybackInfo);
    }, []);

    // ── Core callbacks ──────────────────────────────────────────────────────────

    const openVideoPath = useCallback(async (filePath: string) => {
        const filename = filePath.split(/[\\/]/).pop() ?? filePath;
        debugLog('OpenVideo', 'opening: ' + filePath);
        try {
            const tabId = await OpenVideo(filePath);
            debugLog('OpenVideo', 'success tabId=' + tabId);
            setTabs(prev => [...prev, { id: tabId, type: 'video', title: filename, path: filePath }]);
            await SwitchTab(tabId);
            setActiveTabId(tabId);
            setInfo({ time_pos: 0, duration: 0, paused: true } as main.PlaybackInfo);
            GetRecentFiles().then(setRecentFiles).catch(() => {});
        } catch (e) {
            debugLog('OpenVideo', 'ERROR: ' + e);
        }
    }, []);

    const handlePlaylistAddFilesRef = useRef(handlePlaylistAddFiles);
    handlePlaylistAddFilesRef.current = handlePlaylistAddFiles;

    useEffect(() => {
        GetVersion().then(setVersion).catch(() => { });
        GetProfileInfo().then(setProfileInfo).catch(() => { });
        GetProfiles().then(setProfiles).catch(() => { });
        GetRecentFiles().then(setRecentFiles).catch(() => {});
        GetPreferences().then(setPreferences).catch(() => {});

        const offDebugLog = EventsOn('debug-log', (payload: { source?: string; message?: string }) => {
            debugLog(payload?.source ?? 'go', payload?.message ?? String(payload));
        });
        const offFullscreen = EventsOn('fullscreen-changed', (val: boolean) => {
            setIsFullscreen(val);
            setTimeout(() => {
                setViewportH(window.innerHeight);
                debugLog('Fullscreen', `changed→${val} innerH=${window.innerHeight}`);
            }, 100);
        });
        const offSubtitleText = EventsOn('subtitle-text', ({ tabID, text }: { tabID: string; text: string }) => {
            if (tabID === effectiveVideoTabIdRef.current) setSubtitleText(text);
        });
        const offSubtitleTracks = EventsOn('subtitle-tracks', ({ tabID, tracks, activeSid: sid }: { tabID: string; tracks: main.TrackInfo[]; activeSid: number }) => {
            if (tabID === effectiveVideoTabIdRef.current) {
                setSubtitleTracks(tracks ?? []);
                setActiveSid(sid ?? 0);
            }
        });
        const offOpenFile = EventsOn('open-file', (path: string) => {
            if (activeTabRef.current?.type === 'playlist') {
                handlePlaylistAddFilesRef.current(activeTabIdRef.current ?? '', [path]);
            } else {
                openVideoPath(path);
            }
        });

        const offPlaylistEnded = EventsOn('playlist-video-ended', (goTabId: string) => {
            const pls = playlistsRef.current;
            const plsTabId = Object.keys(pls).find(k => pls[k]?.videoTabId === goTabId);
            if (plsTabId) handlePlaylistNextRef.current(plsTabId);
        });

        OnFileDrop(async (x, y, paths) => {
            debugLog('OnFileDrop', `x=${x} y=${y} paths=${paths.join(', ')}`);
            if (activeTabRef.current?.type === 'playlist') {
                handlePlaylistAddFilesRef.current(activeTabIdRef.current ?? '', paths);
            } else {
                for (const p of paths) await openVideoPath(p);
            }
        }, false);

        const onDragEnter = () => { setIsDragging(true); };
        const onDragOver = (e: DragEvent) => e.preventDefault();
        const onDragLeave = (e: DragEvent) => { if (!e.relatedTarget) setIsDragging(false); };
        const onDrop = (e: DragEvent) => {
            e.preventDefault();
            setIsDragging(false);
            const files = [...(e.dataTransfer?.files ?? [])].map(f => f.name);
            debugLog('Drag', 'browser drop (fallback) — ' + (files.length ? files.join(', ') : 'no files'));
        };
        window.addEventListener('dragenter', onDragEnter);
        window.addEventListener('dragover', onDragOver);
        window.addEventListener('dragleave', onDragLeave);
        window.addEventListener('drop', onDrop);
        const blurButtons = () => {
            const el = document.activeElement as HTMLElement | null;
            if (el?.tagName === 'BUTTON') el.blur();
        };
        document.addEventListener('mouseup', blurButtons);
        return () => {
            offDebugLog?.();
            offFullscreen?.();
            offSubtitleText?.();
            offSubtitleTracks?.();
            offOpenFile?.();
            offPlaylistEnded?.();
            OnFileDropOff();
            window.removeEventListener('dragenter', onDragEnter);
            window.removeEventListener('dragover', onDragOver);
            window.removeEventListener('dragleave', onDragLeave);
            window.removeEventListener('drop', onDrop);
            document.removeEventListener('mouseup', blurButtons);
        };
    }, [openVideoPath]);

    useEffect(() => {
        setSubtitleText('');
        setSubtitleTracks([]);
        setActiveSid(0);
        if (!effectiveVideoTabId) return;
        GetSubtitleState(effectiveVideoTabId).then(state => {
            if (state?.tracks) setSubtitleTracks(state.tracks);
            if (state?.activeSid !== undefined) setActiveSid(state.activeSid);
        }).catch(() => {});
    }, [effectiveVideoTabId]);

    useEffect(() => {
        if (!effectiveVideoTabId) return;
        localTimeRef.current = 0;
        const poll = () => {
            GetPlaybackInfo(effectiveVideoTabId).then(newInfo => {
                setInfo(newInfo);
                localTimeRef.current = newInfo.time_pos;
            }).catch(() => {});
        };
        const fastId = setInterval(poll, 100);
        let slowId: ReturnType<typeof setInterval> | null = null;
        const switchTimer = setTimeout(() => {
            clearInterval(fastId);
            slowId = setInterval(poll, 500);
        }, 2000);
        return () => {
            clearInterval(fastId);
            if (slowId) clearInterval(slowId);
            clearTimeout(switchTimer);
        };
    }, [effectiveVideoTabId]);

    useEffect(() => {
        if (!activeTabId || activeTab?.type !== 'video') {
            setSeekThumbs(null);
            setNotification(null);
            setIsWorking(false);
            if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
            if (promptDelayRef.current) clearTimeout(promptDelayRef.current);
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

        const offGenerating = EventsOn('seek-thumbs-generating', (tabID: string) => {
            if (tabID !== activeTabId) return;
            if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
            if (promptDelayRef.current) clearTimeout(promptDelayRef.current);
            setIsWorking(true);
            setNotification({ type: 'generating', message: 'Generating seek thumbnails...' });
            notifTimerRef.current = setTimeout(() => setNotification(null), 2000);
        });

        const offReady = EventsOn('seek-thumbs-ready', (tabID: string) => {
            if (tabID !== activeTabId) return;
            if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
            if (promptDelayRef.current) clearTimeout(promptDelayRef.current);
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
            if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
            if (promptDelayRef.current) clearTimeout(promptDelayRef.current);
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
        let timer: ReturnType<typeof setTimeout>;
        const onResize = () => {
            setViewportH(window.innerHeight);
            debugLog('Resize', `innerH=${window.innerHeight}`);
            clearTimeout(timer);
            timer = setTimeout(() => ResizeVideo().catch(() => {}), 200);
        };
        window.addEventListener('resize', onResize);
        return () => { clearTimeout(timer); window.removeEventListener('resize', onResize); };
    }, []);

    const handleSwitchTab = useCallback(async (tabId: string) => {
        if (renameTabIdRef.current !== null) setRenameTabId(null);
        setTabContextMenu(null);
        if (tabId === activeTabId) return;

        if (preferencesRef.current?.oneVideoAtATime) {
            const curTab = activeTabRef.current;
            const curVidId: string | null =
                curTab?.type === 'video' ? activeTabId :
                curTab?.type === 'playlist' ? ((activeTabId ? playlists[activeTabId]?.videoTabId : null) ?? null) :
                curTab?.type === 'fileexplorer' ? ((activeTabId ? fileExplorers[activeTabId]?.videoTabId : null) ?? null) :
                null;
            const isPlaying = (curVidId ? tabsStateRef.current[curVidId] : undefined) ?? !infoRef.current.paused;
            if (curVidId && isPlaying) {
                TogglePlayback(curVidId).catch(console.error);
                autoPausedTabIdRef.current = activeTabId;
            }
        }

        const tab = tabId ? tabs.find(t => t.id === tabId) : null;
        let goTabId = '';
        if (tab?.type === 'video') goTabId = tabId;
        else if (tab?.type === 'playlist') goTabId = playlists[tabId]?.videoTabId ?? '';
        else if (tab?.type === 'fileexplorer') goTabId = fileExplorers[tabId]?.videoTabId ?? '';
        await SwitchTab(goTabId);
        setActiveTabId(tabId ?? null);
        if (!goTabId) setInfo({ time_pos: 0, duration: 0, paused: true } as main.PlaybackInfo);

        if (preferencesRef.current?.oneVideoAtATime && tabId === autoPausedTabIdRef.current) {
            autoPausedTabIdRef.current = null;
            const vidId = tab?.type === 'video' ? tabId
                : tab?.type === 'playlist' ? (tabId ? playlists[tabId]?.videoTabId : undefined)
                : tab?.type === 'fileexplorer' ? (tabId ? fileExplorers[tabId]?.videoTabId : undefined)
                : undefined;
            if (vidId) setTimeout(() => TogglePlayback(vidId).catch(console.error), 150);
        }
    }, [activeTabId, tabs, playlists, fileExplorers]);

    const handleCloseTab = useCallback(async (tabId: string) => {
        if (renameTabIdRef.current === tabId) setRenameTabId(null);
        setRenameHistory(prev => { const n = new Map(prev); n.delete(tabId); return n; });
        const idx = tabs.findIndex(t => t.id === tabId);
        const tab = tabs.find(t => t.id === tabId);

        if (tab) {
            const entry: ClosedTabEntry = { type: tab.type, ...(tab.path !== undefined ? { path: tab.path } : {}) };
            if (tab.type === 'playlist') entry.playlistItems = playlists[tabId]?.items ?? [];
            if (tab.type === 'fileexplorer') { const p = fileExplorers[tabId]?.currentPath; if (p) entry.explorerPath = p; }
            closedTabsRef.current.push(entry);
        }

        if (tab?.type === 'video') {
            await CloseTab(tabId);
        } else if (tab?.type === 'playlist') {
            const pls = playlists[tabId];
            if (pls?.videoTabId) await CloseTab(pls.videoTabId);
            setPlaylists(prev => { const n = { ...prev }; delete n[tabId]; return n; });
        } else if (tab?.type === 'fileexplorer') {
            const ex = fileExplorers[tabId];
            if (ex?.videoTabId) await CloseTab(ex.videoTabId);
            setFileExplorers(prev => { const n = { ...prev }; delete n[tabId]; return n; });
        }

        const newTabs = tabs.filter(t => t.id !== tabId);
        setTabs(newTabs);

        if (tabId === activeTabId) {
            const next = newTabs[Math.min(idx, newTabs.length - 1)] ?? null;
            let nextGoTabId = '';
            if (next?.type === 'video') nextGoTabId = next.id;
            else if (next?.type === 'playlist') nextGoTabId = (next.id ? playlists[next.id]?.videoTabId : undefined) ?? '';
            else if (next?.type === 'fileexplorer') nextGoTabId = (next.id ? fileExplorers[next.id]?.videoTabId : undefined) ?? '';
            await SwitchTab(nextGoTabId);
            setActiveTabId(next?.id ?? null);
            if (!nextGoTabId) setInfo({ time_pos: 0, duration: 0, paused: true } as main.PlaybackInfo);
        }
    }, [tabs, activeTabId, playlists, fileExplorers]);

    const handleTearOff = useCallback(async (tabId: string) => {
        await TearOffTab(tabId).catch(console.error);
        const idx = tabs.findIndex(t => t.id === tabId);
        const newTabs = tabs.filter(t => t.id !== tabId);
        setTabs(newTabs);
        if (tabId === activeTabId) {
            const next = newTabs[Math.min(idx, newTabs.length - 1)] ?? null;
            let nextGoTabId = '';
            if (next?.type === 'video') nextGoTabId = next.id;
            await SwitchTab(nextGoTabId).catch(console.error);
            setActiveTabId(next?.id ?? null);
            if (!nextGoTabId) setInfo({ time_pos: 0, duration: 0, paused: true } as main.PlaybackInfo);
        }
    }, [tabs, activeTabId]);

    const openPageTab = useCallback((type: PageTabType) => {
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

    const handleReorderTab = useCallback((fromId: string, toId: string) => {
        setTabs(prev => {
            const fromIdx = prev.findIndex(t => t.id === fromId);
            const toIdx = prev.findIndex(t => t.id === toId);
            if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
            const next = [...prev];
            const moved = next.splice(fromIdx, 1)[0]!;
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
                if (paths?.length) handlePlaylistAddFiles(activeTabId ?? '', paths);
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

    const handleFrameStep = useCallback((dir: number) => {
        const vidId = effectiveVideoTabId;
        if (!vidId) return;
        FrameStep(vidId, dir).catch(console.error);
    }, [effectiveVideoTabId]);

    const handleSpeedChange = useCallback((speed: number) => {
        const vidId = effectiveVideoTabId;
        if (!vidId) return;
        SetPlaybackSpeed(vidId, speed).catch(console.error);
    }, [effectiveVideoTabId]);

    const handleMpvFilterChange = useCallback((vfStr: string) => {
        const vidId = effectiveVideoTabId;
        if (!vidId) return;
        SetVideoFilter(vidId, vfStr).catch(console.error);
    }, [effectiveVideoTabId]);

    const handleVolumeChange = useCallback((vol: number) => {
        const vidId = effectiveVideoTabId;
        if (!vidId) return;
        SetVolume(vidId, vol).catch(console.error);
    }, [effectiveVideoTabId]);

    const handleSubtitleChange = useCallback((sid: number) => {
        const vidId = effectiveVideoTabId;
        if (!vidId) return;
        SetSubtitleTrack(vidId, sid).catch(console.error);
    }, [effectiveVideoTabId]);

    const handleAddSubtitleFile = useCallback(async () => {
        const vidId = effectiveVideoTabId;
        if (!vidId) return;
        try {
            const path = await OpenSubtitleFilePicker();
            if (!path) return;
            await AddSubtitleFile(vidId, path);
        } catch (e) {
            debugLog('Subtitle', 'add file error: ' + e);
        }
    }, [effectiveVideoTabId]);

    const handleSavePreferences = useCallback((prefs: main.Preferences) => {
        SavePreferences(prefs).catch(console.error);
        setPreferences(prefs);
    }, []);

    const handleCreateProfile = useCallback(async (name: string, color: string) => {
        const entry = await CreateProfile(name, color);
        setProfiles(prev => [...prev, entry]);
        return entry;
    }, []);

    const handleRenameProfile = useCallback(async (id: string, newName: string) => {
        await RenameProfile(id, newName);
        setProfiles(prev => prev.map(p => p.id === id ? { ...p, name: newName } : p));
        setProfileInfo(prev => prev.id === id ? { ...prev, name: newName } : prev);
    }, []);

    const handleSetProfileColor = useCallback(async (id: string, color: string) => {
        await SetProfileColor(id, color);
        setProfiles(prev => prev.map(p => p.id === id ? { ...p, color } : p));
        setProfileInfo(prev => prev.id === id ? { ...prev, color } : prev);
    }, []);

    const handleDeleteProfile = useCallback(async (id: string) => {
        await DeleteProfile(id);
        setProfiles(prev => prev.filter(p => p.id !== id));
    }, []);

    const handleReorderProfiles = useCallback(async (ids: string[]) => {
        await ReorderProfiles(ids);
        setProfiles(prev => {
            const byId = Object.fromEntries(prev.map(p => [p.id, p]));
            return ids.map(id => byId[id]).filter((p): p is main.ProfileEntry => p !== undefined);
        });
    }, []);

    const handleOpenProfile = useCallback((id: string) => {
        OpenProfile(id).catch(console.error);
    }, []);

    const refreshProfiles = useCallback(() => {
        GetProfiles().then(setProfiles).catch(() => {});
    }, []);

    // ── Rename file ─────────────────────────────────────────────────────────────

    const openRenameBar = useCallback(async (tabId: string) => {
        setTabContextMenu(null);
        if (tabId !== activeTabId) await handleSwitchTab(tabId);
        setRenameTabId(tabId);
    }, [activeTabId, handleSwitchTab]);

    const handleRenameConfirm = useCallback(async (newStem: string) => {
        const tabId = renameTabId;
        if (!tabId) return;
        const tab = tabs.find(t => t.id === tabId);
        if (!tab?.path) return;
        const oldPath = tab.path;
        setRenameTabId(null);
        try {
            const newPath = await RenameVideoFile(tabId, newStem);
            setTabs(prev => prev.map(t =>
                t.path === oldPath ? { ...t, title: newStem + extname(oldPath), path: newPath } : t
            ));
            setRenameHistory(prev => {
                const next = new Map(prev);
                next.set(tabId, [...(next.get(tabId) ?? []), oldPath]);
                return next;
            });
            setPlaylists(prev => {
                const next = { ...prev };
                for (const [pid, ps] of Object.entries(next)) {
                    if (ps.videoTabId === tabId && ps.currentIndex >= 0 && ps.items[ps.currentIndex] === oldPath) {
                        const newItems = [...ps.items];
                        newItems[ps.currentIndex] = newPath;
                        next[pid] = { ...ps, items: newItems };
                    }
                }
                return next;
            });
            if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
            setNotification({ type: 'done', message: `Renamed to ${newStem}${extname(oldPath)}` });
            notifTimerRef.current = setTimeout(() => setNotification(null), 2500);
        } catch (err) {
            if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
            setNotification({ type: 'prompt', message: `Rename failed: ${String(err)}` });
            notifTimerRef.current = setTimeout(() => setNotification(null), 3500);
        }
    }, [renameTabId, tabs]);

    const handleRenameUndo = useCallback(async (tabId: string) => {
        const stack = renameHistory.get(tabId);
        if (!stack?.length) return;
        const prevPath = stack[stack.length - 1]!;
        const tab = tabs.find(t => t.id === tabId);
        if (!tab?.path) return;
        const oldPath = tab.path;
        const prevStem = prevPath.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');
        setTabContextMenu(null);
        try {
            const newPath = await RenameVideoFile(tabId, prevStem);
            setTabs(prev => prev.map(t =>
                t.path === oldPath ? { ...t, title: prevPath.split(/[\\/]/).pop()!, path: newPath } : t
            ));
            setRenameHistory(prev => {
                const next = new Map(prev);
                const newStack = [...(next.get(tabId) ?? [])];
                newStack.pop();
                if (newStack.length === 0) next.delete(tabId);
                else next.set(tabId, newStack);
                return next;
            });
            setPlaylists(prev => {
                const next = { ...prev };
                for (const [pid, ps] of Object.entries(next)) {
                    if (ps.videoTabId === tabId && ps.currentIndex >= 0 && ps.items[ps.currentIndex] === oldPath) {
                        const newItems = [...ps.items];
                        newItems[ps.currentIndex] = newPath;
                        next[pid] = { ...ps, items: newItems };
                    }
                }
                return next;
            });
            if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
            setNotification({ type: 'done', message: `Reverted to ${prevPath.split(/[\\/]/).pop()}` });
            notifTimerRef.current = setTimeout(() => setNotification(null), 2500);
        } catch (err) {
            if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
            setNotification({ type: 'prompt', message: `Undo failed: ${String(err)}` });
            notifTimerRef.current = setTimeout(() => setNotification(null), 3500);
        }
    }, [renameHistory, tabs]);

    useEffect(() => {
        if (activeTab?.type === 'manageprofiles') refreshProfiles();
    }, [activeTab?.type, refreshProfiles]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (renameTabId !== null) return;

            const tag = (document.activeElement as HTMLElement | null)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;

            if (recentOverlayOpen) {
                if (e.code === 'Escape') { e.preventDefault(); setRecentOverlayOpen(false); }
                return;
            }

            const isVideo = activeTab?.type === 'video';
            const isPlaylistPlaying = activeTab?.type === 'playlist' && (activeTabId ? playlists[activeTabId]?.videoTabId : null);

            if (e.code === 'F2' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
                if (isVideo && activeTabId && activeTab?.path && !isFullscreen) {
                    e.preventDefault();
                    openRenameBar(activeTabId);
                }
                return;
            }

            if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyK') {
                e.preventDefault();
                if (chordTimerRef.current) clearTimeout(chordTimerRef.current);
                chordActiveRef.current = true;
                chordTimerRef.current = setTimeout(() => { chordActiveRef.current = false; }, 1000);
                return;
            }

            if (e.code === 'Escape') {
                if (isFullscreen) {
                    e.preventDefault();
                    ToggleFullscreen().catch(console.error);
                } else if (activeTab?.type === 'playlist' && (activeTabId ? playlists[activeTabId]?.videoTabId : null)) {
                    e.preventDefault();
                    handlePlaylistCloseVideo();
                } else if (activeTab?.type === 'fileexplorer' && (activeTabId ? fileExplorers[activeTabId]?.videoTabId : null)) {
                    e.preventDefault();
                    handleExplorerCloseVideo();
                }
            }
            if (e.code === 'F3' && !e.shiftKey) { e.preventDefault(); openPageTab('debug'); }
            if (e.code === 'F3' && e.shiftKey) { e.preventDefault(); setDebugHUDOpen(v => !v); }
            if (e.code === 'F5' && isVideo && activeTabId) {
                e.preventDefault();
                if (e.shiftKey) {
                    RegenerateSeekThumbnails(activeTabId).catch(console.error);
                } else {
                    StartSeekThumbnailGeneration(activeTabId).catch(console.error);
                }
            }

            if (e.code === 'KeyN' && !e.ctrlKey && !e.altKey && !e.shiftKey && isPlaylistPlaying && activeTabId) {
                e.preventDefault();
                handlePlaylistNext(activeTabId);
            }
            if (e.code === 'KeyP' && !e.ctrlKey && !e.altKey && !e.shiftKey && isPlaylistPlaying && activeTabId) {
                e.preventDefault();
                handlePlaylistPrev(activeTabId);
            }

            if (e.ctrlKey && e.code === 'KeyN' && !e.shiftKey && !e.altKey && activeTab?.type === 'playlist' && activeTabId) {
                e.preventDefault();
                const pls = playlistsRef.current[activeTabId];
                if (pls && pls.items.length > 0) {
                    const next = Math.min((pls.selectedIndex < 0 ? -1 : pls.selectedIndex) + 1, pls.items.length - 1);
                    setPlaylists(prev => ({ ...prev, [activeTabId]: { ...prev[activeTabId]!, selectedIndex: next } }));
                }
            }
            if (e.ctrlKey && e.code === 'KeyP' && !e.shiftKey && !e.altKey && activeTab?.type === 'playlist' && !chordActiveRef.current && activeTabId) {
                e.preventDefault();
                const pls = playlistsRef.current[activeTabId];
                if (pls && pls.items.length > 0) {
                    const next = Math.max((pls.selectedIndex < 0 ? 0 : pls.selectedIndex) - 1, 0);
                    setPlaylists(prev => ({ ...prev, [activeTabId]: { ...prev[activeTabId]!, selectedIndex: next } }));
                }
            }

            if (e.ctrlKey && e.code === 'KeyR' && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                setRecentOverlayOpen(true);
            }
            if (e.ctrlKey && e.code === 'KeyO' && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                if (chordActiveRef.current) {
                    if (chordTimerRef.current) clearTimeout(chordTimerRef.current);
                    chordActiveRef.current = false;
                    openFolderAsPlaylist();
                } else {
                    handleOpenFile();
                }
            }
            if (e.ctrlKey && e.code === 'KeyP' && !e.shiftKey && !e.altKey && chordActiveRef.current) {
                e.preventDefault();
                if (chordTimerRef.current) clearTimeout(chordTimerRef.current);
                chordActiveRef.current = false;
                openNewPlaylist();
            }
            if (e.ctrlKey && e.code === 'Comma' && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                openPageTab('preferences');
            }
            if (e.ctrlKey && e.shiftKey && e.code === 'KeyC') {
                const text = getDebugLogs().map(entry => `${entry.time} [${entry.source}] ${entry.message}`).join('\n');
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
                    openNewPlaylist(last.playlistItems ?? []);
                } else if (last.type === 'fileexplorer' && last.explorerPath) {
                    // Reopen a file explorer tab by simulating folder selection
                    (() => {
                        const folder = last.explorerPath!;
                        const id = `fileexplorer-${Date.now()}`;
                        const folderName = folder.split(/[\\/]/).pop() || folder;
                        SwitchTab('').catch(console.error);
                        setFileExplorers(prev => ({
                            ...prev,
                            [id]: { currentPath: folder, history: [], forwardHistory: [], viewType: 'details', gridSize: 160, sortBy: 'name', sortDir: 'asc', selectedPath: null, videoTabId: null, playingPath: null },
                        }));
                        setTabs(prev => [...prev, { id, type: 'fileexplorer', title: folderName }]);
                        setActiveTabId(id);
                    })();
                } else if (last.type !== 'video' && last.type !== 'fileexplorer') {
                    openPageTab(last.type as PageTabType);
                }
            }
            if (e.ctrlKey && e.code === 'Tab' && tabs.length > 1) {
                e.preventDefault();
                const idx = tabs.findIndex(t => t.id === activeTabId);
                const nextIdx = e.shiftKey
                    ? (idx - 1 + tabs.length) % tabs.length
                    : (idx + 1) % tabs.length;
                const nextTab = tabs[nextIdx];
                if (nextTab) handleSwitchTab(nextTab.id);
            }
            if (e.ctrlKey && e.shiftKey && (e.code === 'PageUp' || e.code === 'PageDown') && activeTabId) {
                e.preventDefault();
                const dir = e.code === 'PageUp' ? -1 : 1;
                setTabs(prev => {
                    const idx = prev.findIndex(t => t.id === activeTabId);
                    const newIdx = idx + dir;
                    if (newIdx < 0 || newIdx >= prev.length) return prev;
                    const next = [...prev];
                    const a = next[idx]!;
                    const b = next[newIdx]!;
                    next[idx] = b;
                    next[newIdx] = a;
                    return next;
                });
            }

            if (e.altKey && !e.ctrlKey && !e.shiftKey) {
                const m = e.code.match(/^Digit([1-9])$/);
                if (m) {
                    e.preventDefault();
                    const idx = parseInt(m[1]!) - 1;
                    const targetTab = tabs[idx];
                    if (targetTab) handleSwitchTab(targetTab.id);
                }
            }

        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [activeTabId, activeTab, tabs, isFullscreen, info, playlists, fileExplorers, recentOverlayOpen,
        renameTabId, effectiveVideoTabId, handleCloseTab, handleSwitchTab, handleTogglePlayback,
        handleOpenFile, openPageTab, openVideoPath, openNewPlaylist, openFolderAsPlaylist,
        openFileExplorer, handlePlaylistNext, handlePlaylistPrev, handlePlaylistCloseVideo,
        handleExplorerCloseVideo, openRenameBar, setTabs]);

    const isPlaylistPlaying = activeTab?.type === 'playlist' && !!(activeTabId ? playlists[activeTabId]?.videoTabId : null);
    const isFileExplorerPlaying = activeTab?.type === 'fileexplorer' && !!(activeTabId ? fileExplorers[activeTabId]?.videoTabId : null);
    const effectiveHeight = isFullscreen ? viewportH : Math.min(viewportH, window.screen.availHeight);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: effectiveHeight, overflow: 'hidden' }}>
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
                    onOpenFolder={openFileExplorer}
                    onReorder={handleReorderTab}
                    onOpenRecentOverlay={() => setRecentOverlayOpen(true)}
                    version={version}
                    isWorking={isWorking}
                    profileInfo={profileInfo}
                    profiles={profiles}
                    onOpenProfile={handleOpenProfile}
                    onOpenManageProfiles={() => openPageTab('manageprofiles')}
                    onMenuOpen={refreshProfiles}
                    onTearOff={handleTearOff}
                    onTabContextMenu={(id, x, y) => setTabContextMenu({ tabId: id, x, y })}
                />
            )}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                {!activeTabId && (
                    <HomeScreen
                        version={version}
                        isDragging={isDragging}
                        onOpenChangelog={() => openPageTab('changelog')}
                        onOpenFile={handleOpenFile}
                        onOpenFolderAsPlaylist={openFolderAsPlaylist}
                        onNewPlaylist={openNewPlaylist}
                        profileInfo={profileInfo}
                    />
                )}
                {(activeTab?.type === 'video' || isPlaylistPlaying || isFileExplorerPlaying) && (
                    <>
                        <PassionPlayerWrapper
                            info={info}
                            seekThumbs={activeTab?.type === 'video' ? seekThumbs : null}
                            onTogglePlayback={handleTogglePlayback}
                            onSeek={(pos) => {
                                if (info.duration > 0) localTimeRef.current = pos * info.duration;
                                if (effectiveVideoTabId) Seek(effectiveVideoTabId, pos).catch(console.error);
                            }}
                            onFullscreen={() => ToggleFullscreen().catch(console.error)}
                            onVolumeChange={handleVolumeChange}
                            onUIVisible={setVideoUIVisible}
                            clickToTogglePlayback={preferences.clickToTogglePlayback}
                            subtitleText={subtitleText}
                            subtitleTracks={subtitleTracks}
                            activeSid={activeSid}
                            onSubtitleChange={handleSubtitleChange}
                            onAddSubtitleFile={handleAddSubtitleFile}
                            onFrameStep={handleFrameStep}
                            onSpeedChange={handleSpeedChange}
                            onMpvFilterChange={handleMpvFilterChange}
                            title={activeTab?.title ?? ''}
                            controlsOverlayKey="F1"
                            disableKeybinds={!effectiveVideoTabId}
                        />
                        <Notification notification={notification} />
                        {activeTab?.type === 'video' && <DebugHUD open={debugHUDOpen} onClose={() => setDebugHUDOpen(false)} />}
                        {isPlaylistPlaying && (
                            <button
                                className={`playlist-close-video-btn${videoUIVisible ? ' visible' : ''}`}
                                onClick={handlePlaylistCloseVideo}
                                title="Close video (Esc)"
                            >✕</button>
                        )}
                    </>
                )}
                {activeTab?.type === 'fileexplorer' && activeTabId && fileExplorers[activeTabId] && (() => {
                    const ex = fileExplorers[activeTabId]!;
                    return (
                        <FileExplorerPage
                            state={ex}
                            onNavigate={(path) => handleExplorerNavigate(activeTabId, path)}
                            onBack={() => handleExplorerBack(activeTabId)}
                            onForward={() => handleExplorerForward(activeTabId)}
                            onUp={() => handleExplorerUp(activeTabId)}
                            onPlayFile={(path) => handleExplorerPlayFile(activeTabId, path)}
                            onOpenInNewTab={openVideoPath}
                            onCloseVideo={handleExplorerCloseVideo}
                            onNextFile={() => {/* handled inside FileExplorerPage */}}
                            onPrevFile={() => {/* handled inside FileExplorerPage */}}
                            onViewChange={(view) => handleExplorerViewChange(activeTabId, view)}
                            onGridSizeChange={(size) => handleExplorerGridSizeChange(activeTabId, size)}
                            onSortChange={(sortBy, dir) => handleExplorerSortChange(activeTabId, sortBy, dir)}
                            onSelectionChange={(path) => handleExplorerSelectionChange(activeTabId, path)}
                            isVideoPlaying={isFileExplorerPlaying}
                            videoUIVisible={videoUIVisible}
                        />
                    );
                })()}
                {activeTab?.type === 'playlist' && !isPlaylistPlaying && activeTabId && (
                    <PlaylistPage
                        playlist={playlists[activeTabId]}
                        onPlay={(idx) => handlePlaylistPlay(activeTabId, idx)}
                        onRemove={(idx) => handlePlaylistRemoveItem(activeTabId, idx)}
                        onReorder={(from, to) => handlePlaylistReorder(activeTabId, from, to)}
                        onToggleRandom={() => handlePlaylistToggleRandom(activeTabId)}
                        onAddFiles={handleOpenFile}
                        onSelectionChange={(idx) => setPlaylists(prev => ({
                            ...prev,
                            [activeTabId]: { ...prev[activeTabId]!, selectedIndex: idx },
                        }))}
                    />
                )}
                {activeTab?.type === 'debug' && <DebugPage />}
                {activeTab?.type === 'changelog' && <ChangelogPage />}
                {activeTab?.type === 'preferences' && (
                    <PreferencesPage preferences={preferences} onSave={handleSavePreferences} />
                )}
                {activeTab?.type === 'manageprofiles' && (
                    <ManageProfilesPage
                        profiles={profiles}
                        activeProfileId={profileInfo.id}
                        onCreate={handleCreateProfile}
                        onRename={handleRenameProfile}
                        onSetColor={handleSetProfileColor}
                        onDelete={handleDeleteProfile}
                        onReorder={handleReorderProfiles}
                        onOpen={handleOpenProfile}
                    />
                )}
            </div>
            {recentOverlayOpen && (
                <RecentFilesOverlay
                    recentFiles={recentFiles}
                    onOpen={openVideoPath}
                    onClear={handleClearRecent}
                    onClose={() => setRecentOverlayOpen(false)}
                />
            )}
            {renameTabId !== null && (() => {
                const tab = tabs.find(t => t.id === renameTabId);
                if (!tab?.path) return null;
                const p = tab.path;
                const lastSlash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
                const filename = p.slice(lastSlash + 1);
                const lastDot = filename.lastIndexOf('.');
                const stem = lastDot >= 0 ? filename.slice(0, lastDot) : filename;
                const ext  = lastDot >= 0 ? filename.slice(lastDot) : '';
                return <>
                    <div className="rename-backdrop" onMouseDown={() => setRenameTabId(null)} />
                    <RenameBar stem={stem} ext={ext} onConfirm={handleRenameConfirm} onCancel={() => setRenameTabId(null)} />
                </>;
            })()}
            {tabContextMenu !== null && (() => {
                const ctxTabId = tabContextMenu.tabId;
                const tab = tabs.find(t => t.id === ctxTabId);
                const stack = renameHistory.get(ctxTabId);
                const undoName = stack?.length ? stack[stack.length - 1]!.split(/[\\/]/).pop()! : null;
                let ctxVideoTabId: string | null = null;
                if (tab?.type === 'video') ctxVideoTabId = ctxTabId;
                else if (tab?.type === 'playlist') ctxVideoTabId = playlists[ctxTabId]?.videoTabId ?? null;
                const ctxIsPlaying = ctxVideoTabId !== null ? (tabsState[ctxVideoTabId] ?? false) : null;
                return <TabContextMenu
                    x={tabContextMenu.x} y={tabContextMenu.y}
                    isPlaying={ctxIsPlaying}
                    onPlayPause={() => {
                        if (ctxVideoTabId) {
                            TogglePlayback(ctxVideoTabId).catch(console.error);
                            setTimeout(() => GetAllTabsState().then(setTabsState).catch(() => {}), 50);
                        }
                        setTabContextMenu(null);
                    }}
                    canRename={tab?.type === 'video' && !!tab.path}
                    undoName={undoName ?? null}
                    onRename={() => openRenameBar(ctxTabId)}
                    onUndo={() => handleRenameUndo(ctxTabId)}
                    filePath={tab?.type === 'video' ? (tab.path ?? null) : null}
                    onRevealInExplorer={() => {
                        if (tab?.type === 'video' && tab.path) RevealInExplorer(tab.path).catch(console.error);
                        setTabContextMenu(null);
                    }}
                    onCloseTab={() => { setTabContextMenu(null); handleCloseTab(ctxTabId); }}
                    onClose={() => setTabContextMenu(null)}
                />;
            })()}
        </div>
    );
}

export default App;
