package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Preferences holds user-configurable settings persisted to
// %APPDATA%\LucidPlayer\config\preferences.json.
type Preferences struct {
	AutogenerateSeekThumbs bool `json:"autogenerateSeekThumbs"`
}

func configDir() (string, error) {
	base, err := appDataDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "config")
	return dir, os.MkdirAll(dir, 0o755)
}

func loadPreferences() Preferences {
	dir, err := configDir()
	if err != nil {
		return Preferences{}
	}
	data, err := os.ReadFile(filepath.Join(dir, "preferences.json"))
	if err != nil {
		return Preferences{}
	}
	var p Preferences
	if err := json.Unmarshal(data, &p); err != nil {
		return Preferences{}
	}
	return p
}

func savePreferences(p Preferences) error {
	dir, err := configDir()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "preferences.json"), data, 0o644)
}
