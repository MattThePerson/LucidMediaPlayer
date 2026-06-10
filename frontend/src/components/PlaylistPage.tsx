import { useRef, useState, useEffect } from 'react';
import type { PlaylistState } from '../types';

interface Props {
    playlist: PlaylistState | null | undefined;
    onPlay: (idx: number) => void;
    onRemove: (idx: number) => void;
    onReorder: (fromIdx: number, toIdx: number) => void;
    onToggleRandom: () => void;
    onAddFiles: () => void;
    onSelectionChange: (idx: number) => void;
}

export default function PlaylistPage({
    playlist,
    onPlay,
    onRemove,
    onReorder,
    onToggleRandom,
    onAddFiles,
    onSelectionChange,
}: Props) {
    const listRef = useRef<HTMLDivElement>(null);
    const draggedIdxRef = useRef<number | null>(null);
    const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

    useEffect(() => { listRef.current?.focus(); }, []);

    const { items = [], selectedIndex = -1, currentIndex = -1, random = false } = playlist ?? {};

    const filename = (path: string) => path.split(/[\\/]/).pop() ?? path;

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (items.length === 0) return;
        if (e.code === 'ArrowDown') {
            e.preventDefault();
            const cur = selectedIndex < 0 ? -1 : selectedIndex;
            onSelectionChange(Math.min(cur + 1, items.length - 1));
        } else if (e.code === 'ArrowUp') {
            e.preventDefault();
            const cur = selectedIndex < 0 ? 0 : selectedIndex;
            onSelectionChange(Math.max(cur - 1, 0));
        } else if (e.code === 'Enter' && selectedIndex >= 0) {
            e.preventDefault();
            onPlay(selectedIndex);
        } else if (e.code === 'Delete' && selectedIndex >= 0) {
            e.preventDefault();
            onRemove(selectedIndex);
        }
    };

    if (!playlist) return null;

    return (
        <div className="playlist-page">
            <div className="playlist-toolbar">
                <span className="playlist-count">{items.length} {items.length === 1 ? 'item' : 'items'}</span>
                <div className="playlist-toolbar-btns">
                    <button className="playlist-add-btn" onClick={onAddFiles}>+ Add Files</button>
                    <button
                        className={`playlist-random-btn${random ? ' active' : ''}`}
                        onClick={onToggleRandom}
                        title={random ? 'Shuffle: on' : 'Shuffle: off'}
                    >
                        ⇄
                    </button>
                </div>
            </div>
            <div
                className="playlist-list"
                ref={listRef}
                tabIndex={0}
                onKeyDown={handleKeyDown}
                onFocus={() => { if (items.length > 0 && selectedIndex < 0) onSelectionChange(0); }}
            >
                {items.length === 0 && (
                    <div className="playlist-empty">Drop files here or click + Add Files to build a playlist</div>
                )}
                {items.map((path, idx) => (
                    <div
                        key={idx}
                        data-item-idx={idx}
                        className={[
                            'playlist-item',
                            idx === selectedIndex ? 'selected' : '',
                            idx === currentIndex ? 'playing' : '',
                            dragOverIdx === idx && draggedIdxRef.current !== idx ? 'drag-target' : '',
                        ].filter(Boolean).join(' ')}
                        draggable
                        onClick={() => onSelectionChange(idx)}
                        onDoubleClick={() => onPlay(idx)}
                        onDragStart={(e) => {
                            draggedIdxRef.current = idx;
                            setDragOverIdx(null);
                            e.dataTransfer.effectAllowed = 'move';
                            const ghost = document.createElement('div');
                            ghost.style.cssText = 'width:1px;height:1px;position:fixed;top:-100px;opacity:0';
                            document.body.appendChild(ghost);
                            e.dataTransfer.setDragImage(ghost, 0, 0);
                            requestAnimationFrame(() => document.body.removeChild(ghost));
                        }}
                        onDragOver={(e) => {
                            if (draggedIdxRef.current === null) return;
                            e.preventDefault();
                            setDragOverIdx(idx);
                        }}
                        onDrop={(e) => {
                            e.preventDefault();
                            if (draggedIdxRef.current !== null && draggedIdxRef.current !== idx) {
                                onReorder(draggedIdxRef.current, idx);
                            }
                            draggedIdxRef.current = null;
                            setDragOverIdx(null);
                        }}
                        onDragEnd={() => {
                            draggedIdxRef.current = null;
                            setDragOverIdx(null);
                        }}
                    >
                        {idx === currentIndex
                            ? <span className="playlist-item-playing-dot" />
                            : <span className="playlist-item-num">{idx + 1}</span>
                        }
                        <span className="playlist-item-name" title={path}>{filename(path)}</span>
                        <button
                            className="playlist-item-remove"
                            onClick={(e) => { e.stopPropagation(); onRemove(idx); }}
                            tabIndex={-1}
                            title="Remove"
                        >×</button>
                    </div>
                ))}
            </div>
        </div>
    );
}
