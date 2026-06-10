import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { GetFolderContents, GetFileThumbnail, GetSeekThumbnailDataByPath } from '../../wailsjs/go/main/App';
import type { FileExplorerState, FileExplorerViewType, FileExplorerSortBy } from '../types';
import type { main, thumbs } from '../../wailsjs/go/models';

interface Props {
    state: FileExplorerState;
    onNavigate: (path: string) => void;
    onBack: () => void;
    onForward: () => void;
    onUp: () => void;
    onPlayFile: (path: string) => void;
    onOpenInNewTab: (path: string) => void;
    onCloseVideo: () => void;
    onNextFile: () => void; // unused; handled internally
    onPrevFile: () => void; // unused; handled internally
    onViewChange: (view: FileExplorerViewType) => void;
    onGridSizeChange: (size: number) => void;
    onSortChange: (sortBy: FileExplorerSortBy, dir: 'asc' | 'desc') => void;
    onSelectionChange: (path: string | null) => void;
    isVideoPlaying: boolean;
    videoUIVisible: boolean;
}

type FileEntry = main.FileEntry;

const THUMB_W = 214;
const THUMB_H = 120;
const SPRITE_COLS = 10;

function formatSize(bytes: number): string {
    if (bytes === 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(secs: number): string {
    if (!secs) return '—';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDate(iso: string): string {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch { return iso; }
}

function typeLabel(entry: FileEntry): string {
    if (entry.isDir) return 'Folder';
    return entry.extension ? entry.extension.slice(1).toUpperCase() : '—';
}

function parentPath(p: string): string {
    const sep = p.includes('\\') ? '\\' : '/';
    const parts = p.replace(/[/\\]+$/, '').split(sep);
    if (parts.length <= 1) return p;
    const parent = parts.slice(0, -1).join(sep) || sep;
    return parent;
}

export default function FileExplorerPage({
    state, onNavigate, onBack, onForward, onUp,
    onPlayFile, onOpenInNewTab, onCloseVideo, onNextFile, onPrevFile,
    onViewChange, onGridSizeChange, onSortChange, onSelectionChange,
    isVideoPlaying, videoUIVisible,
}: Props) {
    const [entries, setEntries] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
    const [editingPath, setEditingPath] = useState(false);
    const [editPathValue, setEditPathValue] = useState('');
    const [hoverThumb, setHoverThumb] = useState<{
        x: number; y: number; above: boolean;
        seekData: thumbs.SeekThumbnailData;
        cursorFrac: number;
        itemPath: string;
    } | null>(null);
    const [sortDropOpen, setSortDropOpen] = useState(false);

    const containerRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const pathInputRef = useRef<HTMLInputElement>(null);
    const loadGenRef = useRef(0);
    const thumbGenRef = useRef(0);
    const hoverThumbRef = useRef(hoverThumb);
    hoverThumbRef.current = hoverThumb;

    const { currentPath, history, forwardHistory, viewType, gridSize, sortBy, sortDir, selectedPath, playingPath } = state;

    // Load folder contents when path changes
    useEffect(() => {
        if (!currentPath) return;
        const gen = ++loadGenRef.current;
        ++thumbGenRef.current;
        setLoading(true);
        setEntries([]);
        setThumbnails({});
        setHoverThumb(null);
        GetFolderContents(currentPath).then(items => {
            if (gen !== loadGenRef.current) return;
            setEntries(items ?? []);
            setLoading(false);
        }).catch(() => {
            if (gen !== loadGenRef.current) return;
            setLoading(false);
        });
    }, [currentPath]);

    // Lazy-load thumbnails when entries change or view type switches to list/grid
    useEffect(() => {
        if (viewType === 'details') return;
        const gen = thumbGenRef.current;
        const mediaEntries = entries.filter(e => e.isMedia);
        for (const entry of mediaEntries) {
            GetFileThumbnail(entry.path).then(thumb => {
                if (gen !== thumbGenRef.current) return;
                if (thumb) setThumbnails(prev => ({ ...prev, [entry.path]: thumb }));
            }).catch(() => {});
        }
    }, [entries, viewType]);

    // Auto-focus list when mounted or path changes
    useEffect(() => {
        listRef.current?.focus();
    }, [currentPath]);

    const sortedEntries = useMemo(() => {
        const dirs = entries.filter(e => e.isDir);
        const files = entries.filter(e => !e.isDir);
        const compare = (a: FileEntry, b: FileEntry): number => {
            let v = 0;
            if (sortBy === 'name') v = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
            else if (sortBy === 'size') v = a.size - b.size;
            else if (sortBy === 'dateModified') v = a.dateModified.localeCompare(b.dateModified);
            else if (sortBy === 'dateCreated') v = a.dateCreated.localeCompare(b.dateCreated);
            else if (sortBy === 'type') v = typeLabel(a).localeCompare(typeLabel(b));
            else if (sortBy === 'duration') v = a.duration - b.duration;
            return sortDir === 'desc' ? -v : v;
        };
        return [...dirs.sort(compare), ...files.sort(compare)];
    }, [entries, sortBy, sortDir]);

    const selectedEntry = sortedEntries.find(e => e.path === selectedPath) ?? null;
    const selectedIdx = selectedPath ? sortedEntries.findIndex(e => e.path === selectedPath) : -1;

    const openEntry = useCallback((entry: FileEntry) => {
        if (entry.isDir) {
            onNavigate(entry.path);
        } else {
            onPlayFile(entry.path);
        }
    }, [onNavigate, onPlayFile]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
        const count = sortedEntries.length;
        if (count === 0 && !['KeyH', 'AltLeft', 'AltRight'].includes(e.code)) return;

        if (e.code === 'KeyJ' || e.code === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            const next = selectedIdx < 0 ? 0 : Math.min(selectedIdx + 1, count - 1);
            onSelectionChange(sortedEntries[next]?.path ?? null);
        } else if (e.code === 'KeyK' || e.code === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            const next = selectedIdx <= 0 ? 0 : selectedIdx - 1;
            onSelectionChange(sortedEntries[next]?.path ?? null);
        } else if (e.code === 'KeyL' || e.code === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            if (selectedEntry) openEntry(selectedEntry);
        } else if (e.code === 'KeyH' || (e.altKey && e.code === 'ArrowUp') || e.code === 'Backspace') {
            e.preventDefault();
            e.stopPropagation();
            onUp();
        } else if (e.altKey && e.code === 'ArrowLeft') {
            e.preventDefault();
            e.stopPropagation();
            onBack();
        } else if (e.altKey && e.code === 'ArrowRight') {
            e.preventDefault();
            e.stopPropagation();
            onForward();
        }
    }, [sortedEntries, selectedIdx, selectedEntry, openEntry, onSelectionChange, onUp, onBack, onForward]);

    const scrollSelectedIntoView = useCallback(() => {
        if (!listRef.current || selectedIdx < 0) return;
        const item = listRef.current.querySelector(`[data-path="${CSS.escape(selectedPath ?? '')}"]`) as HTMLElement | null;
        item?.scrollIntoView({ block: 'nearest' });
    }, [selectedIdx, selectedPath]);

    useEffect(() => { scrollSelectedIntoView(); }, [selectedPath]);

    const handleSortClick = (col: FileExplorerSortBy) => {
        if (sortBy === col) {
            onSortChange(col, sortDir === 'asc' ? 'desc' : 'asc');
        } else {
            onSortChange(col, 'asc');
        }
    };

    const sortArrow = (col: FileExplorerSortBy) =>
        sortBy === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

    // Seek-thumb hover state for grid view
    const handleGridThumbMouseMove = useCallback(async (
        e: React.MouseEvent<HTMLDivElement>,
        entry: FileEntry,
    ) => {
        if (!entry.hasSeekThumbs) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const above = e.clientY > window.innerHeight / 2;

        if (hoverThumbRef.current?.itemPath === entry.path) {
            setHoverThumb(prev => prev ? { ...prev, x: e.clientX, y: e.clientY, above, cursorFrac: frac } : null);
            return;
        }
        try {
            const data = await GetSeekThumbnailDataByPath(entry.path);
            if (!data?.ready) return;
            setHoverThumb({ x: e.clientX, y: e.clientY, above, seekData: data, cursorFrac: frac, itemPath: entry.path });
        } catch { /* ignore */ }
    }, []);

    const getSpriteBg = (seekData: thumbs.SeekThumbnailData, frac: number) => {
        const idx = Math.min(99, Math.floor(frac * 100));
        const col = idx % SPRITE_COLS;
        const row = Math.floor(idx / SPRITE_COLS);
        return {
            backgroundImage: `url(${seekData.spritesheetBase64})`,
            backgroundPosition: `-${col * THUMB_W}px -${row * THUMB_H}px`,
            backgroundSize: `${SPRITE_COLS * THUMB_W}px auto`,
            backgroundRepeat: 'no-repeat',
            width: THUMB_W,
            height: THUMB_H,
        };
    };

    const canGoUp = currentPath.replace(/[/\\]+$/, '').includes('/') || currentPath.replace(/[/\\]+$/, '').includes('\\');

    // Breadcrumbs from currentPath
    const pathSep = currentPath.includes('\\') ? '\\' : '/';
    const pathParts = currentPath.replace(/[/\\]+$/, '').split(pathSep).filter(Boolean);

    const renderBreadcrumbs = () => {
        // Windows: first part is like "C:" — handle specially
        const parts = pathParts.length > 0 ? pathParts : [currentPath];
        return (
            <div className="fex-breadcrumbs">
                {parts.map((part, i) => {
                    const partPath = parts.slice(0, i + 1).join(pathSep) + (i === 0 && part.endsWith(':') ? pathSep : '');
                    const isLast = i === parts.length - 1;
                    return (
                        <span key={i} className="fex-breadcrumb-group">
                            {i > 0 && <span className="fex-breadcrumb-sep">{pathSep}</span>}
                            <span
                                className={`fex-breadcrumb${isLast ? ' current' : ''}`}
                                onClick={isLast ? undefined : () => onNavigate(partPath)}
                            >{part}</span>
                        </span>
                    );
                })}
            </div>
        );
    };

    const renderToolbar = () => (
        <div className="fex-toolbar">
            <button className="fex-nav-btn" onClick={onBack} disabled={history.length === 0} title="Back (Alt+←)">‹</button>
            <button className="fex-nav-btn" onClick={onForward} disabled={forwardHistory.length === 0} title="Forward (Alt+→)">›</button>
            <button className="fex-nav-btn" onClick={onUp} disabled={!canGoUp} title="Up (Alt+↑ / H)">↑</button>
            <div className="fex-location-bar" onClick={() => { if (!editingPath) { setEditingPath(true); setEditPathValue(currentPath); setTimeout(() => { pathInputRef.current?.select(); }, 0); } }}>
                {editingPath ? (
                    <input
                        ref={pathInputRef}
                        className="fex-location-input"
                        value={editPathValue}
                        onChange={e => setEditPathValue(e.target.value)}
                        onKeyDown={e => {
                            if (e.code === 'Enter') { e.preventDefault(); setEditingPath(false); onNavigate(editPathValue.trim()); }
                            if (e.code === 'Escape') { e.preventDefault(); setEditingPath(false); }
                        }}
                        onBlur={() => setEditingPath(false)}
                        autoFocus
                    />
                ) : renderBreadcrumbs()}
            </div>
            <div className="fex-view-btns">
                {(['details', 'list', 'grid'] as FileExplorerViewType[]).map(v => (
                    <button
                        key={v}
                        className={`fex-view-btn${viewType === v ? ' active' : ''}`}
                        onClick={() => onViewChange(v)}
                        title={v.charAt(0).toUpperCase() + v.slice(1)}
                    >
                        {v === 'details' ? '☰' : v === 'list' ? '▤' : '⊞'}
                    </button>
                ))}
            </div>
            {viewType === 'grid' && (
                <input
                    className="fex-grid-size-slider"
                    type="range" min={80} max={280} step={10}
                    value={gridSize}
                    onChange={e => onGridSizeChange(Number(e.target.value))}
                    title={`Grid size: ${gridSize}px`}
                />
            )}
            <div className="fex-sort-wrapper">
                <button className="fex-sort-btn" onClick={() => setSortDropOpen(v => !v)} title="Sort">
                    ⇅ {sortBy === 'name' ? 'Name' : sortBy === 'size' ? 'Size' : sortBy === 'dateModified' ? 'Modified' : sortBy === 'dateCreated' ? 'Created' : sortBy === 'type' ? 'Type' : 'Duration'}
                    {sortDir === 'asc' ? ' ▲' : ' ▼'}
                </button>
                {sortDropOpen && (
                    <div className="fex-sort-dropdown">
                        {(['name', 'size', 'duration', 'type', 'dateModified', 'dateCreated'] as FileExplorerSortBy[]).map(col => (
                            <div
                                key={col}
                                className={`fex-sort-option${sortBy === col ? ' active' : ''}`}
                                onClick={() => { handleSortClick(col); setSortDropOpen(false); }}
                            >
                                {col === 'name' ? 'Name' : col === 'size' ? 'Size' : col === 'duration' ? 'Duration' : col === 'type' ? 'Type' : col === 'dateModified' ? 'Date Modified' : 'Date Created'}
                                {sortBy === col && <span className="fex-sort-arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );

    const renderDetailsRow = (entry: FileEntry) => (
        <div
            key={entry.path}
            data-path={entry.path}
            className={[
                'fex-row',
                entry.path === selectedPath ? 'selected' : '',
                entry.path === playingPath ? 'playing' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => onSelectionChange(entry.path)}
            onDoubleClick={() => openEntry(entry)}
            onMouseDown={e => { if (e.button === 1) { e.preventDefault(); if (!entry.isDir) onOpenInNewTab(entry.path); } }}
        >
            <span className="fex-col-icon">{entry.isDir ? '📁' : '🎬'}</span>
            <span className="fex-col-name" title={entry.name}>{entry.name}</span>
            <span className="fex-col-size">{entry.isDir ? '—' : formatSize(entry.size)}</span>
            <span className="fex-col-duration">{entry.isDir ? '—' : formatDuration(entry.duration)}</span>
            <span className="fex-col-type">{typeLabel(entry)}</span>
            <span className="fex-col-date">{formatDate(entry.dateModified)}</span>
            <span className="fex-col-date">{formatDate(entry.dateCreated)}</span>
            <span className="fex-col-thumbs" title={entry.hasSeekThumbs ? 'Seek thumbnails available' : 'No seek thumbnails'}>
                {entry.isMedia ? (entry.hasSeekThumbs ? <span className="fex-thumb-dot has" /> : <span className="fex-thumb-dot" />) : null}
            </span>
        </div>
    );

    const renderListItem = (entry: FileEntry) => {
        const thumb = thumbnails[entry.path];
        return (
            <div
                key={entry.path}
                data-path={entry.path}
                className={[
                    'fex-list-item',
                    entry.path === selectedPath ? 'selected' : '',
                    entry.path === playingPath ? 'playing' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => onSelectionChange(entry.path)}
                onDoubleClick={() => openEntry(entry)}
                onMouseDown={e => { if (e.button === 1) { e.preventDefault(); if (!entry.isDir) onOpenInNewTab(entry.path); } }}
            >
                {entry.isDir ? (
                    <span className="fex-list-icon">📁</span>
                ) : thumb ? (
                    <img className="fex-list-thumb" src={thumb} alt="" draggable={false} />
                ) : (
                    <span className="fex-list-icon">🎬</span>
                )}
                <span className="fex-list-name" title={entry.name}>{entry.name}</span>
                {!entry.isDir && entry.hasSeekThumbs && <span className="fex-list-thumbs-dot" title="Seek thumbnails" />}
                {!entry.isDir && <span className="fex-list-duration">{formatDuration(entry.duration)}</span>}
            </div>
        );
    };

    const renderGridItem = (entry: FileEntry) => {
        const thumb = thumbnails[entry.path];
        return (
            <div
                key={entry.path}
                data-path={entry.path}
                className={[
                    'fex-grid-item',
                    entry.path === selectedPath ? 'selected' : '',
                    entry.path === playingPath ? 'playing' : '',
                ].filter(Boolean).join(' ')}
                style={{ width: gridSize }}
                onClick={() => onSelectionChange(entry.path)}
                onDoubleClick={() => openEntry(entry)}
                onMouseDown={e => { if (e.button === 1) { e.preventDefault(); if (!entry.isDir) onOpenInNewTab(entry.path); } }}
                onMouseLeave={() => { if (hoverThumbRef.current?.itemPath === entry.path) setHoverThumb(null); }}
            >
                <div
                    className="fex-grid-thumb-area"
                    style={{ height: Math.round(gridSize * 9 / 16) }}
                    onMouseMove={entry.isMedia ? (e) => handleGridThumbMouseMove(e, entry) : undefined}
                    onMouseLeave={entry.isMedia ? () => setHoverThumb(null) : undefined}
                >
                    {entry.isDir ? (
                        <span className="fex-grid-folder-icon">📁</span>
                    ) : thumb ? (
                        <img className="fex-grid-thumb" src={thumb} alt="" draggable={false} />
                    ) : (
                        <span className="fex-grid-folder-icon">🎬</span>
                    )}
                    {entry.path === playingPath && <span className="fex-grid-playing-dot" />}
                </div>
                <div className="fex-grid-name" title={entry.name}>{entry.name}</div>
                {!entry.isDir && <div className="fex-grid-meta">{formatDuration(entry.duration)}</div>}
            </div>
        );
    };

    const renderContent = () => {
        if (loading) return <div className="fex-loading">Loading…</div>;
        if (sortedEntries.length === 0) return <div className="fex-empty">This folder is empty</div>;

        if (viewType === 'details') {
            return (
                <div
                    className="fex-list fex-details"
                    ref={listRef}
                    tabIndex={0}
                    onKeyDown={handleKeyDown}
                    onClick={() => { if (!editingPath) setSortDropOpen(false); }}
                >
                    <div className="fex-details-header">
                        <span className="fex-col-icon" />
                        <span className="fex-col-name fex-sortable" onClick={() => handleSortClick('name')}>Name{sortArrow('name')}</span>
                        <span className="fex-col-size fex-sortable" onClick={() => handleSortClick('size')}>Size{sortArrow('size')}</span>
                        <span className="fex-col-duration fex-sortable" onClick={() => handleSortClick('duration')}>Duration{sortArrow('duration')}</span>
                        <span className="fex-col-type fex-sortable" onClick={() => handleSortClick('type')}>Type{sortArrow('type')}</span>
                        <span className="fex-col-date fex-sortable" onClick={() => handleSortClick('dateModified')}>Modified{sortArrow('dateModified')}</span>
                        <span className="fex-col-date fex-sortable" onClick={() => handleSortClick('dateCreated')}>Created{sortArrow('dateCreated')}</span>
                        <span className="fex-col-thumbs" title="Seek thumbnails">⊡</span>
                    </div>
                    {sortedEntries.map(renderDetailsRow)}
                </div>
            );
        }

        if (viewType === 'list') {
            return (
                <div
                    className="fex-list"
                    ref={listRef}
                    tabIndex={0}
                    onKeyDown={handleKeyDown}
                    onClick={() => setSortDropOpen(false)}
                >
                    {sortedEntries.map(renderListItem)}
                </div>
            );
        }

        // grid
        return (
            <div
                className="fex-grid-container"
                ref={listRef}
                tabIndex={0}
                onKeyDown={handleKeyDown}
                onClick={() => setSortDropOpen(false)}
            >
                {sortedEntries.map(renderGridItem)}
            </div>
        );
    };

    return (
        <div
            ref={containerRef}
            className={`fex-page${isVideoPlaying ? ' fex-overlay-mode' : ''}`}
            onClick={() => setSortDropOpen(false)}
        >
            {renderToolbar()}
            {renderContent()}

            {/* Seek-thumb hover preview in grid view */}
            {hoverThumb && viewType === 'grid' && (
                <div
                    className="fex-seek-preview"
                    style={{
                        left: Math.min(hoverThumb.x - THUMB_W / 2, window.innerWidth - THUMB_W - 8),
                        ...(hoverThumb.above
                            ? { bottom: window.innerHeight - hoverThumb.y + 8 }
                            : { top: hoverThumb.y + 8 }),
                    }}
                >
                    <div style={getSpriteBg(hoverThumb.seekData, hoverThumb.cursorFrac)} />
                </div>
            )}

            {/* Video overlay controls */}
            {isVideoPlaying && (() => {
                const mediaFiles = sortedEntries.filter(e => e.isMedia);
                const playingIdx = playingPath ? mediaFiles.findIndex(e => e.path === playingPath) : -1;
                const hasPrev = playingIdx > 0;
                const hasNext = playingIdx >= 0 && playingIdx < mediaFiles.length - 1;
                return (
                    <div className={`fex-video-controls${videoUIVisible ? ' visible' : ''}`}>
                        <button className="fex-video-btn" onClick={() => { if (hasPrev) onPlayFile(mediaFiles[playingIdx - 1]!.path); }} disabled={!hasPrev} title="Previous">◀</button>
                        <span className="fex-video-nowplaying" title={playingPath ?? ''}>
                            {playingPath ? playingPath.split(/[\\/]/).pop() : ''}
                        </span>
                        <button className="fex-video-btn" onClick={() => { if (hasNext) onPlayFile(mediaFiles[playingIdx + 1]!.path); }} disabled={!hasNext} title="Next">▶</button>
                        <button className="fex-video-close-btn" onClick={onCloseVideo} title="Close video (Esc)">✕</button>
                    </div>
                );
            })()}
        </div>
    );
}
