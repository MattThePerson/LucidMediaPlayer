function AppIcon({ className }) {
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

export default function HomeScreen({ version, isDragging }) {
    return (
        <div className={`home-screen${isDragging ? ' dragging' : ''}`}>
            <AppIcon className="home-icon" />
            <div className="home-title">Awesome Video Player</div>
            <div className="home-version">Version {version}</div>
            <div className="home-hint">Drop a video to get started</div>
        </div>
    );
}
