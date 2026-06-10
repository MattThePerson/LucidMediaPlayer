import { useSyncExternalStore } from 'react';
import type { LogEntry } from './types';

let logs: LogEntry[] = [];
let listeners: Set<() => void> = new Set();

function subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

function getSnapshot(): LogEntry[] { return logs; }

export function debugLog(source: string, message: string): void {
    const time = new Date().toLocaleTimeString('en', {
        hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    }) + '.' + String(new Date().getMilliseconds()).padStart(3, '0');
    logs = [...logs, { id: logs.length + '-' + Date.now(), time, source, message: String(message) }];
    listeners.forEach(cb => cb());
}

export function clearDebugLogs(): void {
    logs = [];
    listeners.forEach(cb => cb());
}

export function getDebugLogs(): LogEntry[] { return logs; }

export function useDebugLogs(): LogEntry[] {
    return useSyncExternalStore(subscribe, getSnapshot);
}
