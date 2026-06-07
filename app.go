//go:build windows

package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/Microsoft/go-winio"
)

var (
	modUser32   = syscall.NewLazyDLL("user32.dll")
	findWindowW = modUser32.NewProc("FindWindowW")
)

type App struct {
	ctx     context.Context
	mpvCmd  *exec.Cmd
	ipcConn net.Conn
	ipcMu   sync.Mutex
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) onDomReady(ctx context.Context) {
	go a.launchMpv()
}

func (a *App) shutdown(ctx context.Context) {
	a.ipcMu.Lock()
	if a.ipcConn != nil {
		a.ipcConn.Close()
		a.ipcConn = nil
	}
	a.ipcMu.Unlock()

	if a.mpvCmd != nil && a.mpvCmd.Process != nil {
		a.mpvCmd.Process.Kill()
	}
}

func (a *App) launchMpv() {
	hwnd, err := getWailsHWND("AwesomeVideoPlayer")
	if err != nil {
		fmt.Println("HWND error:", err)
		return
	}

	cwd, err := os.Getwd()
	if err != nil {
		fmt.Println("Getwd error:", err)
		return
	}
	videoPath := filepath.Join(cwd, "video.mp4")

	pipeName := `\\.\pipe\mpvsocket`

	a.mpvCmd = exec.Command(
		"mpv",
		fmt.Sprintf("--wid=%d", hwnd),
		fmt.Sprintf("--input-ipc-server=%s", pipeName),
		"--pause",
		"--no-terminal",
		videoPath,
	)
	a.mpvCmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}

	if err := a.mpvCmd.Start(); err != nil {
		fmt.Println("mpv start error:", err)
		return
	}

	conn, err := connectMpvPipe(pipeName, 5*time.Second)
	if err != nil {
		fmt.Println("mpv IPC error:", err)
		return
	}

	a.ipcMu.Lock()
	a.ipcConn = conn
	a.ipcMu.Unlock()
	fmt.Println("mpv ready")
}

func (a *App) TogglePlayback() error {
	a.ipcMu.Lock()
	conn := a.ipcConn
	a.ipcMu.Unlock()

	if conn == nil {
		return fmt.Errorf("mpv not connected")
	}
	_, err := fmt.Fprint(conn, "{\"command\": [\"cycle\", \"pause\"]}\n")
	return err
}

func getWailsHWND(title string) (uintptr, error) {
	titlePtr, err := syscall.UTF16PtrFromString(title)
	if err != nil {
		return 0, err
	}
	ret, _, callErr := findWindowW.Call(
		0,
		uintptr(unsafe.Pointer(titlePtr)),
	)
	if ret == 0 {
		return 0, fmt.Errorf("FindWindowW returned 0: %w", callErr)
	}
	return ret, nil
}

func connectMpvPipe(path string, timeout time.Duration) (net.Conn, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		conn, err := winio.DialPipe(path, nil)
		if err == nil {
			return conn, nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return nil, fmt.Errorf("timed out connecting to %s", path)
}
