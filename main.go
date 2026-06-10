package main

import (
	"embed"
	"os"
	"strings"
	"flag"
	"fmt"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"

	"lucidplayer/internal/config"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {

    // Profile
    config.Profile = flag.String("profile", "Default", "profile to use")
    flag.Parse()
    fmt.Printf("starting with profile: \"%s\"\n", *config.Profile)

    // Parse the file path from "Open with" or file association launch.
	var startupFile string
	if len(os.Args) > 1 && !strings.HasPrefix(os.Args[1], "-") {
		startupFile = os.Args[1]
	}

	// If the user has opted into single-instance mode and there's already an
	// instance running, hand the file off to it and exit immediately.
	if startupFile != "" {
		prefs := loadPreferences()
		if prefs.OpenInExistingInstance && trySendToExistingInstance(startupFile) {
			return
		}
	}

	app := NewApp()
	app.startupFile = startupFile

	err := wails.Run(&options.App{
		Title:            "Lucid Player",
		Width:            1024,
		Height:           768,
		WindowStartState: options.Normal,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 0, G: 0, B: 0, A: 0},
		OnStartup:        app.startup,
		OnDomReady:       app.onDomReady,
		OnShutdown:       app.shutdown,
		Windows: &windows.Options{
			WebviewIsTransparent: true,
		},
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: false, // JS-side OnFileDrop requires WebView2 to see the drop
		},
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
