package main

import (
	"encoding/json"
	"os"
	"path/filepath"

	"lucidmediaplayer/internal/storage"
)

// Preferences holds user-configurable settings persisted to
// %APPDATA%\LucidMediaPlayer\config\preferences.json.
type Preferences struct {
	AutogenerateSeekThumbs  bool `json:"autogenerateSeekThumbs"`
	OpenInExistingInstance  bool `json:"openInExistingInstance"`
	ClickToTogglePlayback   bool `json:"clickToTogglePlayback"`
	OneVideoAtATime         bool `json:"oneVideoAtATime"`
}

func loadPreferences() Preferences {
	defaults := Preferences{OneVideoAtATime: true}
	dir, err := storage.ProfileDataDir()
	if err != nil {
		return defaults
	}
	data, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	if err != nil {
		return defaults
	}
	p := defaults
	if err := json.Unmarshal(data, &p); err != nil {
		return defaults
	}
	return p
}

func savePreferences(p Preferences) error {
	dir, err := storage.ProfileDataDir()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "settings.json"), data, 0o644)
}
