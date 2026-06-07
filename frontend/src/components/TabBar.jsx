import { useState, useEffect, useRef } from 'react';

export default function TabBar({ tabs, activeTabId, tabsState, onSwitch, onClose, onOpenFile }) {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef(null);

    useEffect(() => {
        if (!menuOpen) return;
        const onMouseDown = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                setMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', onMouseDown);
        return () => document.removeEventListener('mousedown', onMouseDown);
    }, [menuOpen]);

    return (
        <div className="tab-bar">
            <div className="tab-menu-btn" ref={menuRef} onClick={() => setMenuOpen(o => !o)}>
                ☰
                {menuOpen && (
                    <div className="dropdown" onClick={e => e.stopPropagation()}>
                        <div className="dropdown-item" onClick={() => { setMenuOpen(false); onOpenFile?.(); }}>
                            Open File...
                        </div>
                        <div className="dropdown-separator" />
                        <div className="dropdown-item" onClick={() => { console.log('Preferences'); setMenuOpen(false); }}>
                            Preferences
                        </div>
                    </div>
                )}
            </div>

            <div className="tabs-list">
                {tabs.map(tab => (
                    <div
                        key={tab.id}
                        className={`tab${tab.id === activeTabId ? ' active' : ''}`}
                        onClick={() => onSwitch(tab.id)}
                        title={tab.filename}
                    >
                        {tabsState[tab.id] && <span className="tab-playing">▶</span>}
                        <span className="tab-name">{tab.filename}</span>
                        <button
                            className="tab-close"
                            onClick={e => { e.stopPropagation(); onClose(tab.id); }}
                        >
                            ×
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
