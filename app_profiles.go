package main

import (
	"errors"

	"lucidmediaplayer/internal/config"
)

// ProfileInfo is the frontend-facing view of the currently active profile.
type ProfileInfo struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

func (a *App) GetProfileInfo() ProfileInfo {
	id := *config.Profile
	profiles, err := loadProfiles()
	if err != nil {
		return ProfileInfo{ID: id, Name: id}
	}
	for _, p := range profiles {
		if p.ID == id {
			return ProfileInfo{ID: p.ID, Name: p.Name, Color: p.Color}
		}
	}
	return ProfileInfo{ID: id, Name: id}
}

func (a *App) GetProfiles() []ProfileEntry {
	profiles, _ := loadProfiles()
	return profiles
}

func (a *App) CreateProfile(name, color string) ProfileEntry {
	profiles, _ := loadProfiles()
	entry := ProfileEntry{
		ID:    generateProfileID(name, profiles),
		Name:  name,
		Color: color,
	}
	profiles = append(profiles, entry)
	_ = saveProfiles(profiles)
	return entry
}

func (a *App) RenameProfile(id, newName string) error {
	profiles, err := loadProfiles()
	if err != nil {
		return err
	}
	for i, p := range profiles {
		if p.ID == id {
			profiles[i].Name = newName
			return saveProfiles(profiles)
		}
	}
	return errors.New("profile not found")
}

func (a *App) SetProfileColor(id, color string) error {
	profiles, err := loadProfiles()
	if err != nil {
		return err
	}
	for i, p := range profiles {
		if p.ID == id {
			profiles[i].Color = color
			return saveProfiles(profiles)
		}
	}
	return errors.New("profile not found")
}

func (a *App) DeleteProfile(id string) error {
	if id == *config.Profile {
		return errors.New("cannot delete the active profile")
	}
	profiles, err := loadProfiles()
	if err != nil {
		return err
	}
	newProfiles := profiles[:0:0]
	for _, p := range profiles {
		if p.ID != id {
			newProfiles = append(newProfiles, p)
		}
	}
	if len(newProfiles) == len(profiles) {
		return errors.New("profile not found")
	}
	return saveProfiles(newProfiles)
}

func (a *App) ReorderProfiles(ids []string) error {
	profiles, err := loadProfiles()
	if err != nil {
		return err
	}
	byID := make(map[string]ProfileEntry, len(profiles))
	for _, p := range profiles {
		byID[p.ID] = p
	}
	newProfiles := make([]ProfileEntry, 0, len(ids))
	for _, id := range ids {
		if p, ok := byID[id]; ok {
			newProfiles = append(newProfiles, p)
		}
	}
	return saveProfiles(newProfiles)
}

func (a *App) OpenProfile(id string) {
	if id == *config.Profile {
		return
	}
	_ = launchVisible("-profile", id)
}
