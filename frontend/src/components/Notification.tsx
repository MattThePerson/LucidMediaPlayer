import { useState, useEffect, useRef } from 'react';
import type { NotificationEntry } from '../types';

interface Props {
    notification: NotificationEntry | null;
}

export default function Notification({ notification }: Props) {
    const [current, setCurrent] = useState<NotificationEntry | null>(notification);
    const [exiting, setExiting] = useState(false);
    const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
        if (notification) {
            setExiting(false);
            setCurrent(notification);
        } else if (current) {
            setExiting(true);
            exitTimerRef.current = setTimeout(() => {
                setCurrent(null);
                setExiting(false);
            }, 220);
        }
        return () => { if (exitTimerRef.current) clearTimeout(exitTimerRef.current); };
    }, [notification]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!current) return null;
    return (
        <div
            className={`notification-popup notification-popup--${current.type}${exiting ? ' notification-popup--exit' : ''}`}
            onClick={e => e.stopPropagation()}
        >
            {current.message}
        </div>
    );
}
