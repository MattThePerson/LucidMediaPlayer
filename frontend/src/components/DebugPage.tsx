import { useEffect, useRef } from 'react';
import { useDebugLogs, clearDebugLogs } from '../debug';

export default function DebugPage() {
    const logs = useDebugLogs();
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'instant' });
    }, [logs]);

    return (
        <div className="debug-page">
            <div className="debug-toolbar">
                <span className="debug-title">Debug Log</span>
                <button className="debug-clear-btn" onClick={clearDebugLogs}>Clear</button>
            </div>
            <div className="debug-log">
                {logs.length === 0 && (
                    <div className="debug-empty">No entries yet. Try dragging a video file.</div>
                )}
                {logs.map(entry => (
                    <div key={entry.id} className="debug-entry">
                        <span className="debug-time">{entry.time}</span>
                        <span className="debug-source">[{entry.source}]</span>
                        <span className="debug-msg">{entry.message}</span>
                    </div>
                ))}
                <div ref={bottomRef} />
            </div>
        </div>
    );
}
