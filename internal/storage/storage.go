package storage

import (
	"os"
	"path/filepath"
	"runtime"

	"lucidplayer/internal/config"
)

// AppDataDir returns (and creates) the platform-specific app data directory.
func AppDataDir() (string, error) {
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

// ProfileDataDir returns (and creates) the profile data directory at
// <AppDataDir>/profiles/<profile>/
func ProfileDataDir() (string, error) {
    base, err := AppDataDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "profiles", *config.Profile)
	return dir, os.MkdirAll(dir, 0o755)
}

// MediaDir returns (and creates) the per-video media cache directory at
// <AppDataDir>/media/<hash>/.
func MediaDir(hash string) (string, error) {
	base, err := AppDataDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "media", hash)
	return dir, os.MkdirAll(dir, 0o755)
}
