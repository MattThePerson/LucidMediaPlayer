import { useState, useEffect } from 'react';
import { GetChangelog } from '../../wailsjs/go/main/App';

function renderChangelog(md: string): JSX.Element[] {
    const lines = md.split('\n');
    const out: JSX.Element[] = [];
    let listBuffer: JSX.Element[] = [];

    const flushList = () => {
        if (listBuffer.length) {
            out.push(<ul key={`ul-${out.length}`}>{listBuffer}</ul>);
            listBuffer = [];
        }
    };

    lines.forEach((line, i) => {
        if (line.startsWith('# ')) {
            flushList();
            out.push(<h1 key={i}>{line.slice(2)}</h1>);
        } else if (line.startsWith('## ')) {
            flushList();
            out.push(<h2 key={i}>{line.slice(3)}</h2>);
        } else if (line.startsWith('- ')) {
            listBuffer.push(<li key={i}>{line.slice(2)}</li>);
        } else if (line.trim() === '') {
            flushList();
        } else {
            flushList();
            out.push(<p key={i}>{line}</p>);
        }
    });
    flushList();
    return out;
}

export default function ChangelogPage() {
    const [content, setContent] = useState('');

    useEffect(() => {
        GetChangelog().then(setContent).catch(() => setContent('Failed to load changelog.'));
    }, []);

    return (
        <div className="changelog-page">
            <div className="changelog-content">
                {content ? renderChangelog(content) : <p className="changelog-loading">Loading…</p>}
            </div>
        </div>
    );
}
