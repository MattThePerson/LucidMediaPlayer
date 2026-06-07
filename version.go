package main

import (
	_ "embed"
	"encoding/json"
)

//go:embed wails.json
var wailsJSON []byte

//go:embed docs/CHANGELOG.md
var changelogMD []byte

func getAppVersion() string {
	var cfg struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(wailsJSON, &cfg); err != nil {
		return "unknown"
	}
	return cfg.Version
}

func getChangelog() string {
	return string(changelogMD)
}
