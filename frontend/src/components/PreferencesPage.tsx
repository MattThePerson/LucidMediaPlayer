import { useCallback } from 'react';
import type { main } from '../../wailsjs/go/models';

interface Props {
    preferences: main.Preferences;
    onSave: (prefs: main.Preferences) => void;
}

export default function PreferencesPage({ preferences, onSave }: Props) {
    const handleToggle = useCallback((key: keyof main.Preferences) => (e: React.ChangeEvent<HTMLInputElement>) => {
        onSave({ ...preferences, [key]: e.target.checked } as main.Preferences);
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
                        Only play video when tab focused
                        <span className="preference-hint">Pauses background videos automatically; switching back resumes them.</span>
                    </span>
                </label>
            </div>
        </div>
    );
}
