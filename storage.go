package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

const (
	maxRecentFiles     = 20
	displayRecentFiles = 10
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
//	Windows : %APPDATA%\AwesomeVideoPlayer\
//	macOS   : ~/Library/Application Support/AwesomeVideoPlayer/
//	Linux   : $XDG_CONFIG_HOME/AwesomeVideoPlayer/  (fallback: ~/.config/…)
//
// Subdirectory conventions (created on demand):
//
//	config/ — preferences.json, keybinds.json  (future)
//	data/   — recent.json; media/ for thumbnails, waveforms, timeline data
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
	dir := filepath.Join(base, "AwesomeVideoPlayer")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func recentFilesPath() (string, error) {
	dir, err := appDataDir()
	if err != nil {
		return "", err
	}
	dataDir := filepath.Join(dir, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return "", err
	}
	return filepath.Join(dataDir, "recent.json"), nil
}

func loadRecentFiles() ([]RecentEntry, error) {
	p, err := recentFilesPath()
	if err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(p)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var entries []RecentEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, err
	}
	return entries, nil
}

func saveRecentFiles(entries []RecentEntry) error {
	p, err := recentFilesPath()
	if err != nil {
		return err
	}
	if entries == nil {
		entries = []RecentEntry{}
	}
	data, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0o644)
}

// pushRecentFile prepends filePath to the list, deduplicates, and trims to
// maxRecentFiles. Errors are silently dropped (non-critical persistence).
func pushRecentFile(filePath string) {
	entries, _ := loadRecentFiles()
	// Deduplicate in-place (remove existing entry for the same path)
	j := 0
	for _, e := range entries {
		if e.Path != filePath {
			entries[j] = e
			j++
		}
	}
	entries = entries[:j]
	// Prepend
	entries = append([]RecentEntry{{
		Path:     filePath,
		Filename: filepath.Base(filePath),
		OpenedAt: time.Now().Format(time.RFC3339),
	}}, entries...)
	if len(entries) > maxRecentFiles {
		entries = entries[:maxRecentFiles]
	}
	_ = saveRecentFiles(entries)
}
