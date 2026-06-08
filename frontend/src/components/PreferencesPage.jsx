import { useCallback } from 'react';

export default function PreferencesPage({ preferences, onSave }) {
    const handleToggle = useCallback((key) => (e) => {
        onSave({ ...preferences, [key]: e.target.checked });
    }, [preferences, onSave]);

    return (
        <div className="preferences-page">
            <div className="preferences-section">
                <h2>Settings</h2>
                <label className="preference-row">
                    <input
                        type="checkbox"
                        checked={!!preferences?.autogenerateSeekThumbs}
                        onChange={handleToggle('autogenerateSeekThumbs')}
                    />
                    Autogenerate seek thumbnails
                </label>
                <label className="preference-row">
                    <input
                        type="checkbox"
                        checked={!!preferences?.clickToTogglePlayback}
                        onChange={handleToggle('clickToTogglePlayback')}
                    />
                    Click video to toggle playback
                </label>
                <label className="preference-row">
                    <input
                        type="checkbox"
                        checked={!!preferences?.openInExistingInstance}
                        onChange={handleToggle('openInExistingInstance')}
                    />
                    <span>
                        Open files in existing window
                        <span className="preference-hint">Opening a file via "Open with" reuses this window instead of launching a new one.</span>
                    </span>
                </label>
                <label className="preference-row">
                    <input
                        type="checkbox"
                        checked={!!preferences?.oneVideoAtATime}
                        onChange={handleToggle('oneVideoAtATime')}
                    />
                    <span>
                        One video playing at a time
                        <span className="preference-hint">Switching tabs pauses the current video; switching back resumes it.</span>
                    </span>
                </label>
            </div>
        </div>
    );
}
