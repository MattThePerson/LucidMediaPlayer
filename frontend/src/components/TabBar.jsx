import { useState, useEffect, useRef } from 'react';
import { Quit } from '../../wailsjs/runtime/runtime';

export default function TabBar({
    tabs, activeTabId, tabsState,
    onSwitch, onClose,
    onOpenFile, onOpenDebug, onOpenChangelog, onOpenPreferences,
    onNewPlaylist, onOpenFolderAsPlaylist,
    onReorder,
    recentFiles, onOpenRecent, onClearRecent,
    version, isWorking,
}) {
    const [menuOpen, setMenuOpen] = useState(false);
    const [recentOpen, setRecentOpen] = useState(false);
    const [draggingId, setDraggingId] = useState(null);
    const menuRef = useRef(null);
    const tabsListRef = useRef(null);
    const draggedIdRef = useRef(null);
    const lastOverRef = useRef(null);
    const recentTimerRef = useRef(null);

    // Close main dropdown on outside click
    useEffect(() => {
        if (!menuOpen) return;
        const onMouseDown = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                setMenuOpen(false);
                setRecentOpen(false);
            }
        };
        document.addEventListener('mousedown', onMouseDown);
        return () => document.removeEventListener('mousedown', onMouseDown);
    }, [menuOpen]);

    // Document-level dragover: only X position determines target tab
    useEffect(() => {
        const onDocDragOver = (e) => {
            if (!draggedIdRef.current) return;
            e.preventDefault();
            const tabEls = tabsListRef.current?.querySelectorAll('[data-tab-id]');
            if (!tabEls) return;
            for (const el of tabEls) {
                const rect = el.getBoundingClientRect();
                if (e.clientX < rect.left || e.clientX > rect.right) continue;
                const id = el.dataset.tabId;
                if (id === draggedIdRef.current) {
                    lastOverRef.current = null;
                } else if (id !== lastOverRef.current) {
                    lastOverRef.current = id;
                    onReorder(draggedIdRef.current, id);
                }
                break;
            }
        };
        document.addEventListener('dragover', onDocDragOver);
        return () => document.removeEventListener('dragover', onDocDragOver);
    }, [onReorder]);

    const handleDragStart = (e, id) => {
        draggedIdRef.current = id;
        lastOverRef.current = null;
        setDraggingId(id);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);

        // Suppress the native ghost image so the tab only moves within the bar
        const ghost = document.createElement('div');
        ghost.style.cssText = 'width:1px;height:1px;position:fixed;top:-100px;left:-100px;opacity:0';
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 0, 0);
        requestAnimationFrame(() => document.body.removeChild(ghost));
    };

    const handleDragEnd = () => {
        const id = draggedIdRef.current;
        draggedIdRef.current = null;
        lastOverRef.current = null;
        setDraggingId(null);
        // Switch to the tab that was dragged
        if (id && id !== activeTabId) {
            onSwitch(id);
        }
    };

    // Submenu hover helpers — 150ms close delay lets the mouse travel from
    // trigger to submenu without snapping shut across the dropdown border gap
    const openRecent = () => {
        clearTimeout(recentTimerRef.current);
        setRecentOpen(true);
    };
    const scheduleCloseRecent = () => {
        recentTimerRef.current = setTimeout(() => setRecentOpen(false), 150);
    };

    const closeMenu = () => {
        setMenuOpen(false);
        setRecentOpen(false);
    };
    const menuItem = (label, handler) => (
        <div className="dropdown-item" onClick={() => { closeMenu(); handler(); }}>
            {label}
        </div>
    );
    const menuItemWithShortcut = (label, shortcut, handler) => (
        <div className="dropdown-item-with-shortcut" onClick={() => { closeMenu(); handler(); }}>
            <span>{label}</span>
            <span className="dropdown-shortcut">{shortcut}</span>
        </div>
    );

    return (
        <div className="tab-bar">
            <div className="tab-menu-btn" ref={menuRef} onClick={() => setMenuOpen(o => !o)}>
                ☰
                {menuOpen && (
                    <div className="dropdown" onClick={e => e.stopPropagation()}>
                        {menuItemWithShortcut('Open File…', 'Ctrl+O', onOpenFile)}

                        <div className="dropdown-separator" />

                        {/* Recently Opened submenu */}
                        <div
                            className="dropdown-submenu-wrapper"
                            onMouseEnter={openRecent}
                            onMouseLeave={scheduleCloseRecent}
                        >
                            <div className="dropdown-item dropdown-item-has-submenu">
                                Recently Opened
                                <span className="dropdown-submenu-arrow">▸</span>
                            </div>
                            {recentOpen && (
                                <div
                                    className="dropdown-submenu"
                                    onMouseEnter={openRecent}
                                    onMouseLeave={scheduleCloseRecent}
                                >
                                    {recentFiles.length === 0
                                        ? <div className="dropdown-item dropdown-item-empty">No recent files</div>
                                        : recentFiles.map(f => (
                                            <div
                                                key={f.path}
                                                className="dropdown-item dropdown-item-recent"
                                                title={f.path}
                                                onClick={() => { closeMenu(); onOpenRecent(f.path); }}
                                            >
                                                {f.filename}
                                            </div>
                                        ))
                                    }
                                    {recentFiles.length > 0 && (
                                        <>
                                            <div className="dropdown-separator" />
                                            <div
                                                className="dropdown-item dropdown-item-clear"
                                                onClick={() => { closeMenu(); onClearRecent(); }}
                                            >
                                                Clear Recent
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="dropdown-separator" />
                        {menuItemWithShortcut('Debug Log', 'F3', onOpenDebug)}
                        <div className="dropdown-item dropdown-item-with-version" onClick={() => { closeMenu(); onOpenChangelog(); }}>
                            Changelog
                            {version && <span className="dropdown-version">{version}</span>}
                        </div>
                        <div className="dropdown-separator" />
                        {menuItemWithShortcut('Settings', 'Ctrl+,', onOpenPreferences)}
                        <div className="dropdown-separator" />
                        {menuItem('New Playlist', onNewPlaylist)}
                        {menuItemWithShortcut('Open Folder as Playlist…', 'Ctrl+K, O', onOpenFolderAsPlaylist)}
                        <div className="dropdown-separator" />
                        {menuItem('Quit', () => Quit())}
                    </div>
                )}
            </div>

            <div className="tabs-list" ref={tabsListRef} style={{ flex: 1 }}>
                {tabs.map(tab => (
                    <div
                        key={tab.id}
                        data-tab-id={tab.id}
                        className={[
                            'tab',
                            tab.id === activeTabId ? 'active' : '',
                            tab.type !== 'video' ? 'tab-page' : '',
                            tab.type === 'playlist' ? 'tab-playlist' : '',
                            tab.id === draggingId ? 'tab-dragging' : '',
                        ].filter(Boolean).join(' ')}
                        draggable
                        onClick={() => onSwitch(tab.id)}
                        onMouseDown={e => { if (e.button === 1) { e.preventDefault(); onClose(tab.id); } }}
                        onDragStart={e => handleDragStart(e, tab.id)}
                        onDragEnd={handleDragEnd}
                        title={tab.title}
                    >
                        {tabsState[tab.id] && <span className="tab-playing" />}
                        <span className="tab-name">{tab.title}</span>
                        <button className="tab-close" onClick={e => { e.stopPropagation(); onClose(tab.id); }}>
                            ×
                        </button>
                    </div>
                ))}
            </div>
            {isWorking && <div className="tab-bar-working" title="Generating seek thumbnails..." />}
        </div>
    );
}
