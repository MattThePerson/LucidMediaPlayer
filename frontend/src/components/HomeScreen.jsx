function AppIcon({ className }) {
    return (
        <img className={className} src="/src/assets/images/appicon.png"></img>
    )
}

function AppIconSVG({ className }) {
    return (
        <svg className={className} width="150" height="150" viewBox="0 0 150 150" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="150" height="150" rx="30" fill="#17132c"/>
            <rect width="9" height="10" y="10" x="15" rx="2" fill="#f5f4d3"/>
            <rect width="9" height="10" y="10" x="38" rx="2" fill="#f5f4d3"/>
            <rect width="9" height="10" y="10" x="61" rx="2" fill="#f5f4d3"/>
            <rect width="9" height="10" y="10" x="84" rx="2" fill="#f5f4d3"/>
            <rect width="9" height="10" y="10" x="107" rx="2" fill="#f5f4d3"/>
            <rect width="9" height="10" y="10" x="130" rx="2" fill="#f5f4d3"/>
            <rect width="9" height="10" y="130" x="15" rx="2" fill="#f5f4d3"/>
            <rect width="9" height="10" y="130" x="38" rx="2" fill="#f5f4d3"/>
            <rect width="9" height="10" y="130" x="61" rx="2" fill="#f5f4d3"/>
            <rect width="9" height="10" y="130" x="84" rx="2" fill="#f5f4d3"/>
            <rect width="9" height="10" y="130" x="107" rx="2" fill="#f5f4d3"/>
            <rect width="9" height="10" y="130" x="130" rx="2" fill="#f5f4d3"/>
            <rect width="150" height="40" y="30" fill="#ffbe4f"/>
            <rect width="150" height="40" y="52.5" fill="#ff7a36"/>
            <rect width="150" height="40" y="75" fill="#ff0f57"/>
            <rect width="150" height="22.5" y="97.5" fill="#2173fd"/>
            <path d="M60,45 L110,75 L60,105 Z" fill="#3b3636" stroke="#3b3636" strokeWidth="10" strokeLinejoin="round" strokeLinecap="round" transform="translate(-5,0)"/>
        </svg>
    );
}

export default function HomeScreen({ version, isDragging, onOpenChangelog, onOpenFolderAsPlaylist, onNewPlaylist }) {
    return (
        <div className="home-screen">
            <AppIcon className="home-icon" />
            <div className="home-title">Lucid Media Player</div>
            <div className="home-version" onClick={onOpenChangelog} role="button" tabIndex={0}>
                Version {version}
            </div>
            <div className="home-shortcuts">
                <div className="home-shortcut-hint">
                    <kbd>Ctrl+O</kbd>
                    <span>Open video</span>
                </div>
                <div className="home-shortcut-hint clickable" onClick={onOpenFolderAsPlaylist} role="button" tabIndex={0}>
                    <kbd>Ctrl+K, Ctrl+O</kbd>
                    <span>Open folder as playlist</span>
                </div>
                <div className="home-shortcut-hint clickable" onClick={onNewPlaylist} role="button" tabIndex={0}>
                    <kbd>Ctrl+K, Ctrl+P</kbd>
                    <span>New playlist</span>
                </div>
            </div>
            {isDragging && (
                <div className="drop-overlay">
                    <svg className="drop-overlay-arrow" width="44" height="44" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 3v13M5 11l7 7 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span className="drop-overlay-text">Drop to play</span>
                </div>
            )}
        </div>
    );
}
