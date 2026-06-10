import { useState, useRef, useEffect } from 'react';

interface Props {
    stem: string;
    ext: string;
    onConfirm: (newStem: string) => void;
    onCancel: () => void;
}

const INVALID_CHARS_RE = /[<>:"/\\|?*]/;

function wordStart(text: string, pos: number): number {
    let i = pos - 1;
    while (i >= 0 && !/\w/.test(text[i]!)) i--;
    while (i >= 0 && /\w/.test(text[i]!)) i--;
    return Math.max(0, i + 1);
}

function wordEnd(text: string, pos: number): number {
    let i = pos;
    while (i < text.length && !/\w/.test(text[i]!)) i++;
    while (i < text.length && /\w/.test(text[i]!)) i++;
    return i;
}

export default function RenameBar({ stem, ext, onConfirm, onCancel }: Props) {
    const [value, setValue] = useState(stem);
    const inputRef = useRef<HTMLInputElement>(null);
    const pendingCursorRef = useRef<number | null>(null);

    const trimmed = value.trim();
    const isValid = trimmed !== '' && !INVALID_CHARS_RE.test(trimmed);

    useEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.select();
    }, []);

    // Apply any cursor position queued by text-modifying keyboard ops.
    useEffect(() => {
        if (pendingCursorRef.current !== null) {
            inputRef.current?.setSelectionRange(pendingCursorRef.current, pendingCursorRef.current);
            pendingCursorRef.current = null;
        }
    });

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        const el = inputRef.current!;
        const pos = el.selectionStart ?? 0;
        const val = value;

        if (e.code === 'Enter') {
            e.preventDefault();
            if (isValid) onConfirm(trimmed);
            return;
        }

        if (e.code === 'Escape' || (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyC')) {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
            return;
        }

        if (e.ctrlKey && !e.altKey && !e.shiftKey) {
            switch (e.code) {
                case 'KeyA': // beginning of line
                    e.preventDefault();
                    el.setSelectionRange(0, 0);
                    return;
                case 'KeyE': // end of line
                    e.preventDefault();
                    el.setSelectionRange(val.length, val.length);
                    return;
                case 'KeyF': // forward one char
                    e.preventDefault();
                    el.setSelectionRange(Math.min(pos + 1, val.length), Math.min(pos + 1, val.length));
                    return;
                case 'KeyB': // backward one char
                    e.preventDefault();
                    el.setSelectionRange(Math.max(pos - 1, 0), Math.max(pos - 1, 0));
                    return;
                case 'KeyK': { // kill to end
                    e.preventDefault();
                    setValue(val.slice(0, pos));
                    pendingCursorRef.current = pos;
                    return;
                }
                case 'KeyU': // kill to start
                    e.preventDefault();
                    setValue(val.slice(pos));
                    pendingCursorRef.current = 0;
                    return;
                case 'KeyW': { // kill word backward
                    e.preventDefault();
                    const ws = wordStart(val, pos);
                    setValue(val.slice(0, ws) + val.slice(pos));
                    pendingCursorRef.current = ws;
                    return;
                }
                case 'KeyD': { // delete char forward
                    e.preventDefault();
                    if (pos < val.length) {
                        setValue(val.slice(0, pos) + val.slice(pos + 1));
                        pendingCursorRef.current = pos;
                    }
                    return;
                }
            }
        }

        if (e.altKey && !e.ctrlKey && !e.shiftKey) {
            switch (e.code) {
                case 'KeyF': { // forward one word
                    e.preventDefault();
                    const we = wordEnd(val, pos);
                    el.setSelectionRange(we, we);
                    return;
                }
                case 'KeyB': { // backward one word
                    e.preventDefault();
                    const ws = wordStart(val, pos);
                    el.setSelectionRange(ws, ws);
                    return;
                }
                case 'KeyD': { // kill word forward
                    e.preventDefault();
                    const we = wordEnd(val, pos);
                    setValue(val.slice(0, pos) + val.slice(we));
                    pendingCursorRef.current = pos;
                    return;
                }
            }
        }
    };

    return (
        <div className="rename-bar" onMouseDown={e => e.stopPropagation()}>
            <span className="rename-bar-label">Rename:</span>
            <input
                ref={inputRef}
                type="text"
                className={`rename-bar-input${isValid ? '' : ' invalid'}`}
                value={value}
                onChange={e => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
                spellCheck={false}
                autoComplete="off"
            />
            {ext && <span className="rename-bar-ext">{ext}</span>}
            <button
                className="rename-bar-btn rename-bar-confirm"
                onClick={() => { if (isValid) onConfirm(trimmed); }}
                disabled={!isValid}
                title="Confirm (Enter)"
            >✓</button>
            <button
                className="rename-bar-btn rename-bar-cancel"
                onClick={onCancel}
                title="Cancel (Escape)"
            >✕</button>
        </div>
    );
}
