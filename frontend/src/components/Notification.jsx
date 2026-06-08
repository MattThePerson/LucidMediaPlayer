import { useState, useEffect, useRef } from 'react';

export default function Notification({ notification }) {
    const [current, setCurrent] = useState(notification);
    const [exiting, setExiting] = useState(false);
    const exitTimerRef = useRef(null);

    useEffect(() => {
        clearTimeout(exitTimerRef.current);
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
        return () => clearTimeout(exitTimerRef.current);
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
