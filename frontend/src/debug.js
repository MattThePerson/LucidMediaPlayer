import { useSyncExternalStore } from 'react';

let logs = [];
let listeners = new Set();

function subscribe(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

function getSnapshot() { return logs; }

export function debugLog(source, message) {
    const time = new Date().toLocaleTimeString('en', {
        hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    }) + '.' + String(new Date().getMilliseconds()).padStart(3, '0');
    logs = [...logs, { id: logs.length + '-' + Date.now(), time, source, message: String(message) }];
    listeners.forEach(cb => cb());
}

export function clearDebugLogs() {
    logs = [];
    listeners.forEach(cb => cb());
}

export function useDebugLogs() {
    return useSyncExternalStore(subscribe, getSnapshot);
}
