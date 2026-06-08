import { useCallback } from 'react';

export default function PreferencesPage({ preferences, onSave }) {
    const handleToggle = useCallback((e) => {
        onSave({ ...preferences, autogenerateSeekThumbs: e.target.checked });
    }, [preferences, onSave]);

    return (
        <div className="preferences-page">
            <div className="preferences-section">
                <h2>Preferences</h2>
                <label className="preference-row">
                    <input
                        type="checkbox"
                        checked={!!preferences?.autogenerateSeekThumbs}
                        onChange={handleToggle}
                    />
                    Autogenerate seek thumbnails
                </label>
            </div>
        </div>
    );
}
