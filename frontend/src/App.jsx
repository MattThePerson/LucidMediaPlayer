import { useState, useEffect, useCallback } from 'react';
import { OpenVideo, OpenFilePicker, SwitchTab, CloseTab, TogglePlayback, Seek, GetPlaybackInfo, GetAllTabsState, ToggleFullscreen, GetVersion } from '../wailsjs/go/main/App';
import { EventsOn } from '../wailsjs/runtime/runtime';
import TabBar from './components/TabBar';
import HomeScreen from './components/HomeScreen';
import VideoControls from './components/VideoControls';

function App() {
    const [videoTabs, setVideoTabs] = useState([]);
    const [activeTabId, setActiveTabId] = useState(null);
    const [info, setInfo] = useState({ time_pos: 0, duration: 0, paused: true });
    const [tabsState, setTabsState] = useState({});
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [version, setVersion] = useState('');
    const [isDragging, setIsDragging] = useState(false);

    // One-time setup
    useEffect(() => {
        GetVersion().then(setVersion).catch(() => {});

        EventsOn('file-dropped', async (filePath) => {
            const filename = filePath.split(/[\\/]/).pop();
            try {
                const tabId = await OpenVideo(filePath);
                setVideoTabs(prev => [...prev, { id: tabId, filename }]);
                await SwitchTab(tabId);
                setActiveTabId(tabId);
                setInfo({ time_pos: 0, duration: 0, paused: true });
            } catch (e) {
                console.error('Failed to open video:', e);
            }
        });

        EventsOn('fullscreen-changed', setIsFullscreen);

        // Drag visual feedback
        const onDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
        const onDragLeave = (e) => { if (!e.relatedTarget) setIsDragging(false); };
        const onDrop = (e) => { e.preventDefault(); setIsDragging(false); };
        window.addEventListener('dragover', onDragOver);
        window.addEventListener('dragleave', onDragLeave);
        window.addEventListener('drop', onDrop);
        return () => {
            window.removeEventListener('dragover', onDragOver);
            window.removeEventListener('dragleave', onDragLeave);
            window.removeEventListener('drop', onDrop);
        };
    }, []);

    // Poll active tab's playback info
    useEffect(() => {
        if (!activeTabId) return;
        const id = setInterval(() => {
            GetPlaybackInfo(activeTabId).then(setInfo).catch(() => {});
        }, 500);
        return () => clearInterval(id);
    }, [activeTabId]);

    // Poll all tabs' playing state (for tab indicators)
    useEffect(() => {
        const id = setInterval(() => {
            GetAllTabsState().then(setTabsState).catch(() => {});
        }, 1000);
        return () => clearInterval(id);
    }, []);

    const handleSwitchTab = useCallback(async (tabId) => {
        if (tabId === activeTabId) return;
        await SwitchTab(tabId ?? '');
        setActiveTabId(tabId ?? null);
        setInfo({ time_pos: 0, duration: 0, paused: true });
    }, [activeTabId]);

    const handleOpenFile = useCallback(async () => {
        try {
            const filePath = await OpenFilePicker();
            if (!filePath) return;
            const filename = filePath.split(/[\\/]/).pop();
            const tabId = await OpenVideo(filePath);
            setVideoTabs(prev => [...prev, { id: tabId, filename }]);
            await SwitchTab(tabId);
            setActiveTabId(tabId);
            setInfo({ time_pos: 0, duration: 0, paused: true });
        } catch (e) {
            console.error('Failed to open file:', e);
        }
    }, []);

    const handleCloseTab = useCallback(async (tabId) => {
        const idx = videoTabs.findIndex(t => t.id === tabId);
        await CloseTab(tabId);
        const newTabs = videoTabs.filter(t => t.id !== tabId);
        setVideoTabs(newTabs);

        if (tabId === activeTabId) {
            const next = newTabs[Math.min(idx, newTabs.length - 1)];
            const nextId = next?.id ?? null;
            await SwitchTab(nextId ?? '');
            setActiveTabId(nextId);
            setInfo({ time_pos: 0, duration: 0, paused: true });
        }
    }, [videoTabs, activeTabId]);

    // Keyboard shortcuts
    useEffect(() => {
        const onKey = (e) => {
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;

            if (e.code === 'Space' && activeTabId) {
                e.preventDefault();
                TogglePlayback(activeTabId).catch(console.error);
            }
            if (e.code === 'KeyF') {
                ToggleFullscreen().catch(console.error);
            }
            if (e.ctrlKey && e.code === 'KeyW' && activeTabId) {
                e.preventDefault();
                handleCloseTab(activeTabId);
            }
            if (e.ctrlKey && e.code === 'Tab' && videoTabs.length > 1) {
                e.preventDefault();
                const idx = videoTabs.findIndex(t => t.id === activeTabId);
                const next = e.shiftKey
                    ? (idx - 1 + videoTabs.length) % videoTabs.length
                    : (idx + 1) % videoTabs.length;
                handleSwitchTab(videoTabs[next].id);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [activeTabId, videoTabs, handleCloseTab, handleSwitchTab]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
            {!isFullscreen && (
                <TabBar
                    tabs={videoTabs}
                    activeTabId={activeTabId}
                    tabsState={tabsState}
                    onSwitch={handleSwitchTab}
                    onClose={handleCloseTab}
                    onOpenFile={handleOpenFile}
                />
            )}
            <div style={{ flex: 1, position: 'relative' }}>
                {activeTabId === null && (
                    <HomeScreen version={version} isDragging={isDragging} />
                )}
                {activeTabId !== null && (
                    <VideoControls
                        info={info}
                        onTogglePlayback={() => TogglePlayback(activeTabId).catch(console.error)}
                        onSeek={(pos) => Seek(activeTabId, pos).catch(console.error)}
                        onDoubleClick={() => ToggleFullscreen().catch(console.error)}
                    />
                )}
            </div>
        </div>
    );
}

export default App;
