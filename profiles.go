package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"lucidmediaplayer/internal/storage"
)

type ProfileEntry struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type profilesFile struct {
	Profiles []ProfileEntry `json:"profiles"`
}

func profilesFilePath() (string, error) {
	base, err := storage.AppDataDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "profiles.json"), nil
}

func loadProfiles() ([]ProfileEntry, error) {
	path, err := profilesFilePath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		defaults := []ProfileEntry{{ID: "default", Name: "Default", Color: ""}}
		if err := saveProfiles(defaults); err != nil {
			return nil, err
		}
		return defaults, nil
	}
	if err != nil {
		return nil, err
	}
	var pf profilesFile
	if err := json.Unmarshal(data, &pf); err != nil {
		return nil, err
	}
	if len(pf.Profiles) == 0 {
		pf.Profiles = []ProfileEntry{{ID: "Default", Name: "Default", Color: ""}}
		_ = saveProfiles(pf.Profiles)
	}
	return pf.Profiles, nil
}

func saveProfiles(profiles []ProfileEntry) error {
	path, err := profilesFilePath()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(profilesFile{Profiles: profiles}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

// generateProfileID derives a stable folder-safe ID from name and ensures uniqueness.
func generateProfileID(name string, existing []ProfileEntry) string {
	// Strip characters invalid in Windows/Unix path components.
	var b strings.Builder
	for _, r := range strings.TrimSpace(name) {
		if strings.ContainsRune(`<>:"/\|?*`, r) {
			continue
		}
		b.WriteRune(r)
	}
	base := strings.TrimSpace(b.String())
	if base == "" {
		base = "Profile"
	}

	taken := make(map[string]bool, len(existing))
	for _, p := range existing {
		taken[p.ID] = true
	}

	id := base
	for n := 2; taken[id]; n++ {
		id = fmt.Sprintf("%s (%d)", base, n)
	}
	return id
}
