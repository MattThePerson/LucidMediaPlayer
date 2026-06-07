import { useState, useEffect, useRef } from 'react';

export default function TabBar({ tabs, activeTabId, tabsState, onSwitch, onClose, onOpenFile, onOpenDebug, onOpenChangelog, onReorder }) {
    const [menuOpen, setMenuOpen] = useState(false);
    const [draggingId, setDraggingId] = useState(null);
    const menuRef = useRef(null);
    const tabsListRef = useRef(null);
    const draggedIdRef = useRef(null);
    const lastOverRef = useRef(null);

    useEffect(() => {
        if (!menuOpen) return;
        const onMouseDown = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
        };
        document.addEventListener('mousedown', onMouseDown);
        return () => document.removeEventListener('mousedown', onMouseDown);
    }, [menuOpen]);

    // Document-level dragover: only X position determines target tab.
    // This keeps reordering working even when the mouse drifts vertically out of the tab bar.
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
                    // Passing through the dragged tab resets the dedup gate so
                    // dragging back over a previously-visited tab works correctly.
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
    };

    const handleDragEnd = () => {
        draggedIdRef.current = null;
        lastOverRef.current = null;
        setDraggingId(null);
    };

    const menuItem = (label, handler) => (
        <div className="dropdown-item" onClick={() => { setMenuOpen(false); handler(); }}>
            {label}
        </div>
    );

    return (
        <div className="tab-bar">
            <div className="tab-menu-btn" ref={menuRef} onClick={() => setMenuOpen(o => !o)}>
                ☰
                {menuOpen && (
                    <div className="dropdown" onClick={e => e.stopPropagation()}>
                        {menuItem('Open File…', onOpenFile)}
                        <div className="dropdown-separator" />
                        {menuItem('Debug', onOpenDebug)}
                        {menuItem('Changelog', onOpenChangelog)}
                        <div className="dropdown-separator" />
                        {menuItem('Preferences', () => {})}
                    </div>
                )}
            </div>

            <div className="tabs-list" ref={tabsListRef}>
                {tabs.map(tab => (
                    <div
                        key={tab.id}
                        data-tab-id={tab.id}
                        className={[
                            'tab',
                            tab.id === activeTabId ? 'active' : '',
                            tab.type !== 'video' ? 'tab-page' : '',
                            tab.id === draggingId ? 'tab-dragging' : '',
                        ].filter(Boolean).join(' ')}
                        draggable
                        onClick={() => onSwitch(tab.id)}
                        onMouseDown={e => { if (e.button === 1) { e.preventDefault(); onClose(tab.id); } }}
                        onDragStart={e => handleDragStart(e, tab.id)}
                        onDragEnd={handleDragEnd}
                        title={tab.title}
                    >
                        <span className="tab-playing" style={{ visibility: tabsState[tab.id] ? 'visible' : 'hidden' }}>▶</span>
                        <span className="tab-name">{tab.title}</span>
                        <button className="tab-close" onClick={e => { e.stopPropagation(); onClose(tab.id); }}>
                            ×
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
