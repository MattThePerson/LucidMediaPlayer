import { useState, useEffect, useRef, useMemo } from 'react';

function fuzzyScore(query, str) {
    const lq = query.toLowerCase();
    const ls = str.toLowerCase();
    let qi = 0, consecutive = 0, score = 0;
    for (let si = 0; si < ls.length && qi < lq.length; si++) {
        if (ls[si] === lq[qi]) {
            score += 1 + consecutive;
            consecutive++;
            qi++;
        } else {
            consecutive = 0;
        }
    }
    return qi === lq.length ? score : -1;
}

export default function RecentFilesOverlay({ recentFiles, onOpen, onClear, onClose }) {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef(null);
    const selectedItemRef = useRef(null);

    const filtered = useMemo(() => {
        if (!query.trim()) return recentFiles;
        return recentFiles
            .map(f => ({ f, score: fuzzyScore(query, f.filename) }))
            .filter(({ score }) => score >= 0)
            .sort((a, b) => b.score - a.score)
            .map(({ f }) => f);
    }, [query, recentFiles]);

    useEffect(() => { setSelectedIndex(0); }, [filtered]);

    useEffect(() => { inputRef.current?.focus(); }, []);

    useEffect(() => {
        selectedItemRef.current?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    const openSelected = () => {
        if (filtered[selectedIndex]) {
            onOpen(filtered[selectedIndex].path);
            onClose();
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
        } else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
            e.preventDefault();
            setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
        } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
            e.preventDefault();
            setSelectedIndex(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            openSelected();
        }
    };

    return (
        <div className="recent-overlay-backdrop" onMouseDown={onClose}>
            <div className="recent-overlay" onMouseDown={e => e.stopPropagation()}>
                <input
                    ref={inputRef}
                    className="recent-overlay-input"
                    placeholder="Search recent files…"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                />
                <div className="recent-overlay-list">
                    {filtered.length === 0
                        ? <div className="recent-overlay-empty">No recent files</div>
                        : filtered.map((f, i) => (
                            <div
                                key={f.path}
                                ref={i === selectedIndex ? selectedItemRef : null}
                                className={`recent-overlay-item${i === selectedIndex ? ' selected' : ''}`}
                                onMouseDown={() => { onOpen(f.path); onClose(); }}
                                onMouseEnter={() => setSelectedIndex(i)}
                                title={f.path}
                            >
                                <span className="recent-overlay-filename">{f.filename}</span>
                                <span className="recent-overlay-path">{f.path}</span>
                            </div>
                        ))
                    }
                </div>
                <div className="recent-overlay-footer">
                    <button
                        className="recent-overlay-clear"
                        onMouseDown={e => { e.stopPropagation(); onClear(); onClose(); }}
                    >
                        Clear Recents
                    </button>
                </div>
            </div>
        </div>
    );
}
