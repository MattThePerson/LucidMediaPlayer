import { useState, useEffect, useRef } from 'react';
import { Quit } from '../../wailsjs/runtime/runtime';
import type { Tab, TabsStateMap } from '../types';
import type { main } from '../../wailsjs/go/models';

interface Props {
    tabs: Tab[];
    activeTabId: string | null;
    tabsState: TabsStateMap;
    onSwitch: (tabId: string) => void;
    onClose: (tabId: string) => void;
    onOpenFile: () => void;
    onOpenDebug: () => void;
    onOpenChangelog: () => void;
    onOpenPreferences: () => void;
    onNewPlaylist: () => void;
    onOpenFolderAsPlaylist: () => void;
    onReorder: (fromId: string, toId: string) => void;
    onOpenRecentOverlay: () => void;
    version: string;
    isWorking: boolean;
    profileInfo: main.ProfileInfo;
    profiles: main.ProfileEntry[];
    onOpenProfile: (id: string) => void;
    onOpenManageProfiles: () => void;
    onMenuOpen?: () => void;
    onTearOff?: (tabId: string) => void;
    onTabContextMenu?: (tabId: string, x: number, y: number) => void;
}

export default function TabBar({
    tabs, activeTabId, tabsState,
    onSwitch, onClose,
    onOpenFile, onOpenDebug, onOpenChangelog, onOpenPreferences,
    onNewPlaylist, onOpenFolderAsPlaylist,
    onReorder,
    onOpenRecentOverlay,
    version, isWorking,
    profileInfo, profiles, onOpenProfile, onOpenManageProfiles, onMenuOpen,
    onTearOff,
    onTabContextMenu,
}: Props) {
    const [menuOpen, setMenuOpen] = useState(false);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const tabsListRef = useRef<HTMLDivElement>(null);
    const draggedIdRef = useRef<string | null>(null);
    const lastOverRef = useRef<string | null>(null);

    useEffect(() => {
        if (!menuOpen) return;
        const onMouseDown = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.code === 'Escape') {
                e.stopPropagation();
                setMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('keydown', onKey, true);
        return () => {
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('keydown', onKey, true);
        };
    }, [menuOpen]);

    useEffect(() => {
        const onDocDragOver = (e: DragEvent) => {
            if (!draggedIdRef.current) return;
            e.preventDefault();
            const tabEls = tabsListRef.current?.querySelectorAll('[data-tab-id]');
            if (!tabEls) return;
            for (const el of tabEls) {
                const rect = el.getBoundingClientRect();
                if (e.clientX < rect.left || e.clientX > rect.right) continue;
                const id = (el as HTMLElement).dataset['tabId'];
                if (!id) break;
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

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, id: string) => {
        draggedIdRef.current = id;
        lastOverRef.current = null;
        setDraggingId(id);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);

        const ghost = document.createElement('div');
        ghost.style.cssText = 'width:1px;height:1px;position:fixed;top:-100px;left:-100px;opacity:0';
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 0, 0);
        requestAnimationFrame(() => document.body.removeChild(ghost));
    };

    const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
        const id = draggedIdRef.current;
        const tab = tabs.find(t => t.id === id);
        draggedIdRef.current = null;
        lastOverRef.current = null;
        setDraggingId(null);

        if (id && tab?.type === 'video' && e.clientY > 80) {
            onTearOff?.(id);
            return;
        }
        if (id && id !== activeTabId) {
            onSwitch(id);
        }
    };

    const closeMenu = () => setMenuOpen(false);
    const menuItem = (label: string, handler: () => void) => (
        <div className="dropdown-item" onClick={() => { closeMenu(); handler(); }}>
            {label}
        </div>
    );
    const menuItemWithShortcut = (label: string, shortcut: string, handler: () => void) => (
        <div className="dropdown-item-with-shortcut" onClick={() => { closeMenu(); handler(); }}>
            <span>{label}</span>
            <span className="dropdown-shortcut">{shortcut}</span>
        </div>
    );

    return (
        <div className="tab-bar">
            <div className="tab-menu-btn" ref={menuRef} onClick={() => { const next = !menuOpen; setMenuOpen(next); if (next) onMenuOpen?.(); }}>
                ☰
                {profileInfo?.color && (
                    <span className="profile-dot" style={{ background: profileInfo.color }} />
                )}
                {menuOpen && (
                    <div className="dropdown" onClick={e => e.stopPropagation()}>
                        {menuItemWithShortcut('Open File…', 'Ctrl+O', onOpenFile)}
                        {menuItemWithShortcut('Open Folder as Playlist…', 'Ctrl+K, Ctrl+O', onOpenFolderAsPlaylist)}
                        {menuItemWithShortcut('New Playlist', 'Ctrl+K, Ctrl+P', onNewPlaylist)}

                        <div className="dropdown-separator" />

                        {menuItemWithShortcut('Open Recent…', 'Ctrl+R', onOpenRecentOverlay)}

                        <div className="dropdown-separator" />
                        {menuItemWithShortcut('Debug Log', 'F3', onOpenDebug)}
                        <div className="dropdown-item dropdown-item-with-version" onClick={() => { closeMenu(); onOpenChangelog(); }}>
                            Changelog
                            {version && <span className="dropdown-version">{version}</span>}
                        </div>
                        <div className="dropdown-separator" />
                        {menuItemWithShortcut('Settings', 'Ctrl+,', onOpenPreferences)}
                        <div className="dropdown-separator" />

                        <div className="dropdown-submenu-wrapper">
                            <div className="dropdown-item dropdown-item-has-submenu">
                                <span className="dropdown-profile-label">
                                    {profileInfo?.color && (
                                        <span className="dropdown-profile-dot" style={{ background: profileInfo.color }} />
                                    )}
                                    Profile: {profileInfo?.name || 'Default'}
                                </span>
                                <span className="dropdown-submenu-arrow">▶</span>
                            </div>
                            <div className="dropdown-submenu">
                                {(profiles ?? []).map(p => (
                                    <div
                                        key={p.id}
                                        className={`dropdown-item dropdown-profile-option${p.id === profileInfo?.id ? ' is-active' : ''}`}
                                        onClick={p.id !== profileInfo?.id ? () => { closeMenu(); onOpenProfile(p.id); } : undefined}
                                    >
                                        {p.color
                                            ? <span className="dropdown-profile-dot" style={{ background: p.color }} />
                                            : <span className="dropdown-profile-dot-empty" />
                                        }
                                        <span>{p.name}</span>
                                        {p.id === profileInfo?.id && <span className="dropdown-check">✓</span>}
                                    </div>
                                ))}
                                <div className="dropdown-separator" />
                                {menuItem('Manage Profiles…', onOpenManageProfiles)}
                            </div>
                        </div>

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
                            tabsState[tab.id] ? 'tab-is-playing' : '',
                        ].filter(Boolean).join(' ')}
                        draggable
                        onClick={() => onSwitch(tab.id)}
                        onMouseDown={e => { if (e.button === 1) { e.preventDefault(); onClose(tab.id); } }}
                        onContextMenu={e => { e.preventDefault(); onTabContextMenu?.(tab.id, e.clientX, e.clientY); }}
                        onDragStart={e => handleDragStart(e, tab.id)}
                        onDragEnd={handleDragEnd}
                        title={tab.title}
                    >
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
