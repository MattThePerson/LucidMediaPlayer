import type { main } from '../../wailsjs/go/models';

function formatTime(secs: number): string {
    if (!secs || isNaN(secs)) return '0:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

interface Props {
    info: main.PlaybackInfo;
    onTogglePlayback: () => void;
    onSeek: (pos: number) => void;
    onDoubleClick: () => void;
}

export default function VideoControls({ info, onTogglePlayback, onSeek, onDoubleClick }: Props) {
    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onSeek((e.clientX - rect.left) / rect.width);
    };

    const progress = info.duration > 0 ? (info.time_pos / info.duration) * 100 : 0;

    return (
        <div
            style={{ position: 'absolute', inset: 0 }}
            onDoubleClick={onDoubleClick}
        >
            <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                padding: '10px 14px',
                background: 'linear-gradient(transparent, #000b)',
                display: 'flex', alignItems: 'center', gap: '10px',
            }}>
                <button
                    onClick={onTogglePlayback}
                    style={{
                        background: 'none', border: '1px solid #fff5',
                        color: 'white', borderRadius: '4px',
                        width: '32px', height: '32px', cursor: 'pointer',
                        fontSize: '13px', flexShrink: 0,
                    }}
                >
                    {info.paused ? '▶' : '⏸'}
                </button>

                <span style={{ color: '#fffd', fontSize: '12px', flexShrink: 0 }}>
                    {formatTime(info.time_pos)} / {formatTime(info.duration)}
                </span>

                <div
                    onClick={handleSeek}
                    style={{
                        flex: 1, height: '4px', background: '#fff3',
                        cursor: 'pointer', borderRadius: '2px',
                    }}
                >
                    <div style={{
                        width: `${progress}%`, height: '100%',
                        background: 'white', borderRadius: '2px',
                        pointerEvents: 'none',
                    }} />
                </div>
            </div>
        </div>
    );
}
