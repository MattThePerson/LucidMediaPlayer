import { useEffect, useRef, useState } from 'react';

interface Props {
    x: number;
    y: number;
    isPlaying: boolean | null;   // null = no video (page tab)
    onPlayPause: () => void;
    canRename: boolean;
    undoName: string | null;     // null = no history
    onRename: () => void;
    onUndo: () => void;
    filePath: string | null;
    onRevealInExplorer: () => void;
    onCloseTab: () => void;
    onClose: () => void;
}

export default function TabContextMenu({
    x, y, isPlaying, onPlayPause, canRename, undoName, onRename, onUndo,
    filePath, onRevealInExplorer, onCloseTab, onClose,
}: Props) {
    const menuRef = useRef<HTMLDivElement>(null);
    const [undoHovered, setUndoHovered] = useState(false);

    useEffect(() => {
        const onMouseDown = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.code === 'Escape') { e.stopPropagation(); onClose(); }
        };
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('keydown', onKey, true);
        return () => {
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('keydown', onKey, true);
        };
    }, [onClose]);

    const adjustedX = Math.min(x, window.innerWidth - 215);
    const adjustedY = Math.min(y, window.innerHeight - 200);
    const hasUndo = undoName !== null;

    return (
        <div ref={menuRef} className="tab-context-menu" style={{ left: adjustedX, top: adjustedY }}>
            {isPlaying !== null && (
                <>
                    <div className="tab-context-menu-item" onMouseDown={onPlayPause}>
                        {isPlaying ? '⏸️ Pause' : '▶️ Play'}
                    </div>
                    <div className="tab-context-menu-separator" />
                </>
            )}
            {canRename && (
                <div className="tab-context-menu-item" onMouseDown={onRename}>
                    Rename file
                    <span className="tab-context-menu-shortcut">F2</span>
                </div>
            )}
            <div
                className={`tab-context-menu-item${!hasUndo ? ' tab-context-menu-item--disabled' : ''}`}
                onMouseDown={hasUndo ? onUndo : undefined}
                onMouseEnter={() => setUndoHovered(true)}
                onMouseLeave={() => setUndoHovered(false)}
                style={{ position: 'relative' }}
            >
                Undo rename
                {undoHovered && undoName && (
                    <div className="tab-context-menu-tooltip">{undoName}</div>
                )}
            </div>
            {filePath && (
                <div className="tab-context-menu-item" onMouseDown={onRevealInExplorer}>
                    Open file location
                </div>
            )}
            <div className="tab-context-menu-separator" />
            <div className="tab-context-menu-item tab-context-menu-item--danger" onMouseDown={onCloseTab}>
                Close tab
            </div>
        </div>
    );
}
