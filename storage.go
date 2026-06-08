package main

import (
	"os"
	"path/filepath"
	"runtime"
)

// RecentEntry is one item in the recently-opened list.
type RecentEntry struct {
	Path     string `json:"path"`
	Filename string `json:"filename"`
	OpenedAt string `json:"openedAt"`
}

// appDataDir returns (and creates) the platform-specific app data directory.
//
// Layout:
//
//	Windows : %APPDATA%\LucidPlayer\
//	macOS   : ~/Library/Application Support/LucidPlayer/
//	Linux   : $XDG_CONFIG_HOME/LucidPlayer/  (fallback: ~/.config/…)
func appDataDir() (string, error) {
	var base string
	switch runtime.GOOS {
	case "windows":
		base = os.Getenv("APPDATA")
		if base == "" {
			home, err := os.UserHomeDir()
			if err != nil {
				return "", err
			}
			base = filepath.Join(home, "AppData", "Roaming")
		}
	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		base = filepath.Join(home, "Library", "Application Support")
	default: // Linux / BSD
		xdg := os.Getenv("XDG_CONFIG_HOME")
		if xdg != "" {
			base = xdg
		} else {
			home, err := os.UserHomeDir()
			if err != nil {
				return "", err
			}
			base = filepath.Join(home, ".config")
		}
	}
	dir := filepath.Join(base, "LucidPlayer")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}
