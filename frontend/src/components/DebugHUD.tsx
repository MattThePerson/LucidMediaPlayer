import { useState, useEffect, useRef } from 'react';
import { GetDebugHUDInfo } from '../../wailsjs/go/main/App';

interface DebugHUDProps {
    open: boolean;
    onClose: () => void;
}

export default function DebugHUD({ open, onClose }: DebugHUDProps) {
    const [info, setInfo] = useState<Record<string, string>>({});
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        if (!open) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            return;
        }
        const poll = () => GetDebugHUDInfo().then(setInfo).catch(() => {});
        poll();
        intervalRef.current = setInterval(poll, 1000);
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [open]);

    if (!open) return null;

    const text = Object.entries(info).map(([k, v]) => `[${k}]\n${v}`).join('\n\n');

    const copyAll = () => navigator.clipboard.writeText(text).catch(() => {});

    return (
        <div style={{
            position: 'absolute',
            top: 16,
            right: 16,
            zIndex: 90,
            background: 'rgba(10, 10, 14, 0.88)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6,
            padding: '10px 12px',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            maxWidth: 300,
            pointerEvents: 'auto',
            fontFamily: 'monospace',
            fontSize: 11,
            color: '#b0b0b0',
            lineHeight: 1.6,
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ color: '#fff', fontWeight: 600, fontSize: 12 }}>DEBUG HUD</span>
                <button
                    onClick={onClose}
                    style={{
                        background: 'none', border: 'none', color: '#888', cursor: 'pointer',
                        fontSize: 14, padding: '0 2px', lineHeight: 1,
                    }}
                    title="Close (Shift+F3)"
                >×</button>
            </div>
            <pre style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                userSelect: 'text',
                WebkitUserSelect: 'text',
                color: '#b0b0b0',
            }}>
                {text || 'Loading…'}
            </pre>
            <div style={{ marginTop: 8, textAlign: 'right' }}>
                <button
                    onClick={copyAll}
                    style={{
                        background: 'rgba(255,255,255,0.08)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: 4,
                        color: '#ccc',
                        cursor: 'pointer',
                        fontSize: 11,
                        padding: '3px 8px',
                    }}
                >Copy all</button>
            </div>
        </div>
    );
}
