import { useState, useEffect, useCallback, useRef } from 'react';
import {
    OpenVideo, OpenFilePicker, SwitchTab, CloseTab,
    TogglePlayback, Seek, GetPlaybackInfo, GetAllTabsState,
    ToggleFullscreen, GetVersion, GetRecentFiles, ClearRecentFiles,
    ResizeVideo, SetVolume,
} from '../wailsjs/go/main/App';
import { EventsOn, OnFileDrop, OnFileDropOff } from '../wailsjs/runtime/runtime';
import { debugLog, getDebugLogs } from './debug';
import TabBar from './components/TabBar';
import HomeScreen from './components/HomeScreen';
import PassionPlayerWrapper from './components/PassionPlayerWrapper';
import DebugPage from './components/DebugPage';
import ChangelogPage from './components/ChangelogPage';

// Each tab: { id, type: 'video'|'debug'|'changelog', title }
const PAGE_TITLES = { debug: 'Debug', changelog: 'Changelog' };

function App() {
    const [tabs, setTabs] = useState([]);
    const [activeTabId, setActiveTabId] = useState(null);
    const [info, setInfo] = useState({ time_pos: 0, duration: 0, paused: true, volume: 100 });
    const [tabsState, setTabsState] = useState({});
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [version, setVersion] = useState('');
    const [isDragging, setIsDragging] = useState(false);
    const [recentFiles, setRecentFiles] = useState([]);

    // Stack of recently closed tabs for Ctrl+Shift+T reopen
    const closedTabsRef = useRef([]);

    const activeTab = tabs.find(t => t.id === activeTabId) ?? null;

    // Shared: open a file path as a new video tab
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

    useEffect(() => {
        GetVersion().then(setVersion).catch(() => {});
        GetRecentFiles().then(setRecentFiles).catch(() => {});

        const offDebugLog = EventsOn('debug-log', (payload) => {
            debugLog(payload?.source ?? 'go', payload?.message ?? String(payload));
        });
        const offFullscreen = EventsOn('fullscreen-changed', setIsFullscreen);

        // JS-side OnFileDrop is the correct Wails v2 API for WebView2 file drops.
        // Go's runtime.OnFileDrop only works for Win32-level drops and never fires here.
        OnFileDrop(async (x, y, paths) => {
            debugLog('OnFileDrop', `x=${x} y=${y} paths=${paths.join(', ')}`);
            for (const p of paths) await openVideoPath(p);
        }, false); // false = fire on any drop, not just --wails-drop-target elements

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
            OnFileDropOff();
            window.removeEventListener('dragenter', onDragEnter);
            window.removeEventListener('dragover', onDragOver);
            window.removeEventListener('dragleave', onDragLeave);
            window.removeEventListener('drop', onDrop);
        };
    }, [openVideoPath]);

    // Poll playback info only when a video tab is active
    useEffect(() => {
        if (!activeTabId || activeTab?.type !== 'video') return;
        const id = setInterval(() => {
            GetPlaybackInfo(activeTabId).then(setInfo).catch(() => {});
        }, 500);
        return () => clearInterval(id);
    }, [activeTabId, activeTab?.type]);

    useEffect(() => {
        const id = setInterval(() => {
            GetAllTabsState().then(setTabsState).catch(() => {});
        }, 1000);
        return () => clearInterval(id);
    }, []);

    // Keep the active video window correctly sized when the Wails window is resized.
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
        await SwitchTab(tab?.type === 'video' ? tabId : '');
        setActiveTabId(tabId ?? null);
        setInfo({ time_pos: 0, duration: 0, paused: true, volume: 100 });
    }, [activeTabId, tabs]);

    const handleCloseTab = useCallback(async (tabId) => {
        const idx = tabs.findIndex(t => t.id === tabId);
        const tab = tabs.find(t => t.id === tabId);

        // Remember closed tab for Ctrl+Shift+T
        if (tab) {
            closedTabsRef.current.push({
                type: tab.type,
                path: tab.path, // full path for video tabs
            });
        }

        if (tab?.type === 'video') await CloseTab(tabId);
        const newTabs = tabs.filter(t => t.id !== tabId);
        setTabs(newTabs);

        if (tabId === activeTabId) {
            const next = newTabs[Math.min(idx, newTabs.length - 1)] ?? null;
            await SwitchTab(next?.type === 'video' ? next.id : '');
            setActiveTabId(next?.id ?? null);
            setInfo({ time_pos: 0, duration: 0, paused: true, volume: 100 });
        }
    }, [tabs, activeTabId]);

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
        if (!activeTabId) return;
        debugLog('App', `handleTogglePlayback @ ${Date.now()}`);
        TogglePlayback(activeTabId).catch(console.error);
        setTimeout(() => {
            GetPlaybackInfo(activeTabId).then(setInfo).catch(() => {});
            GetAllTabsState().then(setTabsState).catch(() => {});
        }, 50);
    }, [activeTabId]);

    const handleOpenFile = useCallback(async () => {
        try {
            const filePath = await OpenFilePicker();
            if (!filePath) return;
            debugLog('OpenFilePicker', 'selected: ' + filePath);
            await openVideoPath(filePath);
        } catch (e) {
            debugLog('OpenFilePicker', 'ERROR: ' + e);
        }
    }, [openVideoPath]);

    const handleVolumeChange = useCallback((vol) => {
        if (!activeTabId) return;
        SetVolume(activeTabId, vol).catch(console.error);
    }, [activeTabId]);

    useEffect(() => {
        const onKey = (e) => {
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;

            const isVideo = activeTab?.type === 'video';

            if (e.code === 'Space' && isVideo) {
                e.preventDefault();
                handleTogglePlayback();
            }
            if (e.code === 'KeyS' && isVideo && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                handleTogglePlayback();
            }
            if (e.code === 'KeyF') ToggleFullscreen().catch(console.error);
            if (e.code === 'Escape' && isFullscreen) {
                e.preventDefault();
                ToggleFullscreen().catch(console.error);
            }
            if (e.code === 'F3') { e.preventDefault(); openPageTab('debug'); }
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

            // Alt+1–9 switches to tab N
            if (e.altKey && !e.ctrlKey && !e.shiftKey) {
                const m = e.code.match(/^Digit([1-9])$/);
                if (m) {
                    e.preventDefault();
                    const idx = parseInt(m[1]) - 1;
                    if (idx < tabs.length) handleSwitchTab(tabs[idx].id);
                }
            }

            // Seek shortcuts (only for video tabs with known duration)
            if (isVideo && info.duration > 0) {
                const seekBy = (delta) => {
                    const newFrac = Math.max(0, Math.min(1, (info.time_pos + delta) / info.duration));
                    Seek(activeTabId, newFrac).catch(console.error);
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
    }, [activeTabId, activeTab, tabs, isFullscreen, info, handleCloseTab, handleSwitchTab, handleTogglePlayback, openPageTab, openVideoPath, setTabs]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
            {!isFullscreen && (
                <TabBar
                    tabs={tabs}
                    activeTabId={activeTabId}
                    tabsState={tabsState}
                    onSwitch={handleSwitchTab}
                    onClose={handleCloseTab}
                    onOpenFile={handleOpenFile}
                    onOpenDebug={() => openPageTab('debug')}
                    onOpenChangelog={() => openPageTab('changelog')}
                    onReorder={handleReorderTab}
                    recentFiles={recentFiles}
                    onOpenRecent={openVideoPath}
                    onClearRecent={handleClearRecent}
                    version={version}
                />
            )}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                {!activeTabId && <HomeScreen version={version} isDragging={isDragging} onOpenChangelog={() => openPageTab('changelog')} />}
                {activeTab?.type === 'video' && (
                    <PassionPlayerWrapper
                        info={info}
                        onTogglePlayback={handleTogglePlayback}
                        onSeek={(pos) => Seek(activeTabId, pos).catch(console.error)}
                        onFullscreen={() => ToggleFullscreen().catch(console.error)}
                        onVolumeChange={handleVolumeChange}
                    />
                )}
                {activeTab?.type === 'debug' && <DebugPage />}
                {activeTab?.type === 'changelog' && <ChangelogPage />}
            </div>
        </div>
    );
}

export default App;
