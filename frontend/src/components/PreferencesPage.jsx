import { useCallback } from 'react';

export default function PreferencesPage({ preferences, onSave }) {
    const handleToggle = useCallback((key) => (e) => {
        onSave({ ...preferences, [key]: e.target.checked });
    }, [preferences, onSave]);

    return (
        <div className="preferences-page">
            <div className="preferences-section">
                <h2>Preferences</h2>
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
                        checked={!!preferences?.openInExistingInstance}
                        onChange={handleToggle('openInExistingInstance')}
                    />
                    <span>
                        Open files in existing window
                        <span className="preference-hint">Opening a file via "Open with" reuses this window instead of launching a new one.</span>
                    </span>
                </label>
            </div>
        </div>
    );
}
