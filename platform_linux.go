//go:build linux || darwin

package main

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	goruntime "runtime"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// ipcPath returns the Unix socket path for a tab's mpv IPC socket.
func ipcPath(tabID string) string {
	return fmt.Sprintf("/tmp/mpvsocket-%s", tabID)
}

// connectMPV connects to the mpv Unix socket, retrying until timeout.
func connectMPV(path string, timeout time.Duration) (net.Conn, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		conn, err := net.Dial("unix", path)
		if err == nil {
			return conn, nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return nil, fmt.Errorf("timed out connecting to %s", path)
}

// mpvWindowArgs returns the mpv IPC argument only — no --wid on Linux.
func mpvWindowArgs(_ uintptr, ipcSocketPath string) []string {
	return []string{fmt.Sprintf("--input-ipc-server=%s", ipcSocketPath)}
}

// hideSubprocess is a no-op on Linux (no hidden-window concept).
func hideSubprocess(_ *exec.Cmd) {}

// initPlatform is a no-op on Linux; returns parentHWND=0.
func initPlatform(_ *App) (uintptr, error) {
	return 0, nil
}

// getChildren returns nil on Linux (no HWND embedding).
func getChildren(_ uintptr) []uintptr { return nil }

// waitForChild returns 0 immediately on Linux (mpv runs standalone).
func waitForChild(_ uintptr, _ []uintptr, _ time.Duration) uintptr { return 0 }

// prepareChild is a no-op on Linux.
func prepareChild(_ *App, _ uintptr) {}

// showChild is a no-op on Linux.
func showChild(_ uintptr) {}

// hideChild is a no-op on Linux.
func hideChild(_ uintptr) {}

// repositionChild is a no-op on Linux.
func repositionChild(_ *App, _ uintptr) {}

// bringToFront focuses the Wails window via the runtime.
func bringToFront(a *App) {
	runtime.WindowShow(a.ctx)
}

// platformToggleFullscreen uses the Wails runtime for fullscreen on Linux.
func platformToggleFullscreen(a *App) {
	if a.isFullscreen {
		runtime.WindowUnfullscreen(a.ctx)
		a.isFullscreen = false
		runtime.EventsEmit(a.ctx, "fullscreen-changed", false)
	} else {
		runtime.WindowFullscreen(a.ctx)
		a.isFullscreen = true
		runtime.EventsEmit(a.ctx, "fullscreen-changed", true)
	}
}

// platformRevealFile opens the file manager with the given file selected.
// macOS: open -R; Linux: nautilus --select, falling back to xdg-open on the directory.
func platformRevealFile(a *App, path string) {
	dir := filepath.Dir(path)
	if goruntime.GOOS == "darwin" {
		a.emitDebug("reveal", fmt.Sprintf("macOS: open -R %s", path))
		if err := exec.Command("open", "-R", path).Start(); err != nil {
			a.emitDebug("reveal", fmt.Sprintf("error: %v", err))
		}
		return
	}
	a.emitDebug("reveal", fmt.Sprintf("Linux: nautilus --select %s", path))
	if err := exec.Command("nautilus", "--select", path).Start(); err != nil {
		a.emitDebug("reveal", fmt.Sprintf("nautilus failed (%v), fallback xdg-open %s", err, dir))
		if err2 := exec.Command("xdg-open", dir).Start(); err2 != nil {
			a.emitDebug("reveal", fmt.Sprintf("xdg-open error: %v", err2))
		}
	}
}

// platformResizeVideo is a no-op on Linux (mpv manages its own window).
func platformResizeVideo(_ *App) {}

// getWin32DebugString is a no-op on Linux.
func getWin32DebugString(_ uintptr) string { return "(not available on Linux)" }

// getFileCreatedTime returns the fallback on Linux (no creation-time syscall).
func getFileCreatedTime(_ os.FileInfo, fallback string) string { return fallback }
