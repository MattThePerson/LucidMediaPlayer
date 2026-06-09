import appIconUrl from '../assets/images/appicon.png';

export default function HomeScreen({ version, isDragging, onOpenChangelog, onOpenFile, onOpenFolderAsPlaylist, onNewPlaylist, profile }) {
    return (
        <div className="home-screen">
            <img className="home-icon" src={appIconUrl} />
            <div className="home-title">Lucid Media Player</div>
            <div className="home-version" onClick={onOpenChangelog} role="button" tabIndex={0}>
                Version {version}
            </div>
            <div className="home-shortcuts">
                <div className="home-shortcut-hint clickable" onClick={onOpenFile} role="button" tabIndex={0}>
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
