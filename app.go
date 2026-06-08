//go:build windows

package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/Microsoft/go-winio"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var (
	modUser32      = syscall.NewLazyDLL("user32.dll")
	findWindowW    = modUser32.NewProc("FindWindowW")
	showWindowW    = modUser32.NewProc("ShowWindow")
	getWindowW     = modUser32.NewProc("GetWindow")
	getClientRectW = modUser32.NewProc("GetClientRect")
	moveWindowW    = modUser32.NewProc("MoveWindow")
)

const (
	swHide     = uintptr(0)
	swShow     = uintptr(5)
	gwChild    = uintptr(5)
	gwHwndNext = uintptr(2)

	tabBarHeight = 36 // must match .tab-bar height in style.css
)

type winRECT struct{ Left, Top, Right, Bottom int32 }

// PlaybackInfo is returned to the frontend for a given tab.
type PlaybackInfo struct {
	TimePos  float64 `json:"time_pos"`
	Duration float64 `json:"duration"`
	Paused   bool    `json:"paused"`
}

// TabInstance owns one mpv subprocess and its associated state.
type TabInstance struct {
	filePath  string
	mpvCmd    *exec.Cmd
	ipcConn   net.Conn
	ipcMu     sync.Mutex
	childHWND uintptr

	stateMu  sync.RWMutex
	timePos  float64
	duration float64
	paused   bool
}

func (t *TabInstance) writeIPC(msg string) error {
	t.ipcMu.Lock()
	defer t.ipcMu.Unlock()
	if t.ipcConn == nil {
		return fmt.Errorf("not connected")
	}
	_, err := fmt.Fprint(t.ipcConn, msg)
	return err
}

func (t *TabInstance) startReader() {
	t.ipcMu.Lock()
	conn := t.ipcConn
	fmt.Fprint(conn, `{"command": ["observe_property", 1, "time-pos"]}`+"\n")
	fmt.Fprint(conn, `{"command": ["observe_property", 2, "duration"]}`+"\n")
	fmt.Fprint(conn, `{"command": ["observe_property", 3, "pause"]}`+"\n")
	t.ipcMu.Unlock()

	scanner := bufio.NewScanner(conn)
	for scanner.Scan() {
		var msg map[string]interface{}
		if json.Unmarshal(scanner.Bytes(), &msg) != nil {
			continue
		}
		if msg["event"] != "property-change" {
			continue
		}
		t.stateMu.Lock()
		switch msg["name"] {
		case "time-pos":
			if v, ok := msg["data"].(float64); ok {
				t.timePos = v
			}
		case "duration":
			if v, ok := msg["data"].(float64); ok {
				t.duration = v
			}
		case "pause":
			if v, ok := msg["data"].(bool); ok {
				t.paused = v
			}
		}
		t.stateMu.Unlock()
	}
}

// App is the Wails application struct.
type App struct {
	ctx          context.Context
	parentHWND   uintptr
	tabsMu       sync.RWMutex
	tabs         map[string]*TabInstance
	activeTabID  string
	isFullscreen bool
}

func NewApp() *App {
	return &App{tabs: make(map[string]*TabInstance)}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) onDomReady(ctx context.Context) {
	if a.parentHWND != 0 {
		// dev hot-reload fires onDomReady again — HWND already found, skip
		a.emitDebug("startup", "onDomReady re-fired (dev reload), skipping")
		return
	}
	hwnd, err := getWailsHWND("Sunset Video Player")
	if err != nil {
		a.emitDebug("startup", "FindWindowW failed: "+err.Error())
		fmt.Println("HWND error:", err)
		return
	}
	a.parentHWND = hwnd
	a.emitDebug("startup", fmt.Sprintf("parentHWND=%d — ready", hwnd))
	// File drop is handled via JS-side OnFileDrop (window.runtime.OnFileDrop),
	// not Go's runtime.OnFileDrop, because WebView2 owns the drop event.
}

func (a *App) emitDebug(source, message string) {
	runtime.EventsEmit(a.ctx, "debug-log", map[string]string{
		"source":  source,
		"message": message,
	})
}

func (a *App) shutdown(ctx context.Context) {
	a.tabsMu.Lock()
	defer a.tabsMu.Unlock()
	for _, tab := range a.tabs {
		tab.ipcMu.Lock()
		if tab.ipcConn != nil {
			tab.ipcConn.Close()
		}
		tab.ipcMu.Unlock()
		if tab.mpvCmd != nil && tab.mpvCmd.Process != nil {
			tab.mpvCmd.Process.Kill()
		}
	}
}

// OpenVideo launches a new mpv instance for the given file and returns a tabID.
func (a *App) OpenVideo(filePath string) (string, error) {
	a.emitDebug("OpenVideo", "starting: "+filePath)
	tabID := fmt.Sprintf("tab-%d", time.Now().UnixNano())
	pipeName := fmt.Sprintf(`\\.\pipe\mpvsocket-%s`, tabID)

	before := getDirectChildren(a.parentHWND)

	cmd := exec.Command(
		"mpv",
		fmt.Sprintf("--wid=%d", a.parentHWND),
		fmt.Sprintf("--input-ipc-server=%s", pipeName),
		"--pause",
		"--no-terminal",
		"--keep-open=yes",
		filePath,
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}

	if err := cmd.Start(); err != nil {
		a.emitDebug("OpenVideo", "mpv start failed: "+err.Error())
		return "", fmt.Errorf("mpv start: %w", err)
	}
	a.emitDebug("OpenVideo", fmt.Sprintf("mpv pid=%d, connecting IPC...", cmd.Process.Pid))

	conn, err := connectMpvPipe(pipeName, 5*time.Second)
	if err != nil {
		cmd.Process.Kill()
		a.emitDebug("OpenVideo", "IPC connect failed: "+err.Error())
		return "", fmt.Errorf("IPC connect: %w", err)
	}

	childHWND := waitForNewChildHWND(a.parentHWND, before, 3*time.Second)
	a.emitDebug("OpenVideo", fmt.Sprintf("childHWND=%d tabID=%s", childHWND, tabID))

	// Pre-position while hidden so it's in the right place when SwitchTab reveals it.
	if childHWND != 0 {
		a.positionChildWindow(childHWND)
		setWindowVisibility(childHWND, false)
	}

	tab := &TabInstance{
		filePath:  filePath,
		mpvCmd:    cmd,
		ipcConn:   conn,
		childHWND: childHWND,
		paused:    true,
	}

	a.tabsMu.Lock()
	a.tabs[tabID] = tab
	a.tabsMu.Unlock()

	go tab.startReader()
	pushRecentFile(filePath)
	return tabID, nil
}

// GetChangelog returns the embedded CHANGELOG.md content.
func (a *App) GetChangelog() string {
	return getChangelog()
}

// SwitchTab hides all mpv windows and shows the requested tab's window.
// Pass an empty string to show the home screen (all windows hidden).
func (a *App) SwitchTab(tabID string) error {
	a.tabsMu.Lock()
	defer a.tabsMu.Unlock()

	for _, tab := range a.tabs {
		if tab.childHWND != 0 {
			setWindowVisibility(tab.childHWND, false)
		}
	}

	if tabID == "" {
		a.activeTabID = ""
		runtime.WindowSetTitle(a.ctx, "Sunset Video Player")
		return nil
	}

	tab, ok := a.tabs[tabID]
	if !ok {
		return fmt.Errorf("tab %s not found", tabID)
	}
	if tab.childHWND != 0 {
		a.positionChildWindow(tab.childHWND)
		setWindowVisibility(tab.childHWND, true)
	}
	a.activeTabID = tabID
	runtime.WindowSetTitle(a.ctx, "Sunset Video Player — "+filepath.Base(tab.filePath))
	return nil
}

// OpenFilePicker opens a native file dialog and returns the selected path (or "" if cancelled).
func (a *App) OpenFilePicker() (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Open Video",
		Filters: []runtime.FileFilter{
			{DisplayName: "Video Files", Pattern: "*.mp4;*.mkv;*.avi;*.mov;*.webm;*.flv;*.wmv;*.m4v;*.ts;*.m2ts"},
			{DisplayName: "All Files", Pattern: "*.*"},
		},
	})
	return path, err
}

// CloseTab kills the mpv process for the given tab.
func (a *App) CloseTab(tabID string) error {
	a.tabsMu.Lock()
	tab, ok := a.tabs[tabID]
	if !ok {
		a.tabsMu.Unlock()
		return nil
	}
	if tab.childHWND != 0 {
		setWindowVisibility(tab.childHWND, false)
	}
	delete(a.tabs, tabID)
	if a.activeTabID == tabID {
		a.activeTabID = ""
	}
	a.tabsMu.Unlock()

	// Quit via IPC first — stops audio immediately and lets mpv exit cleanly.
	// Kill() is a fallback for the case where IPC is already broken.
	_ = tab.writeIPC(`{"command": ["quit"]}` + "\n")

	tab.ipcMu.Lock()
	if tab.ipcConn != nil {
		tab.ipcConn.Close()
		tab.ipcConn = nil
	}
	tab.ipcMu.Unlock()

	if tab.mpvCmd != nil && tab.mpvCmd.Process != nil {
		a.emitDebug("CloseTab", fmt.Sprintf("killing pid=%d", tab.mpvCmd.Process.Pid))
		tab.mpvCmd.Process.Kill()
	}
	return nil
}

func (a *App) TogglePlayback(tabID string) error {
	a.tabsMu.RLock()
	tab, ok := a.tabs[tabID]
	a.tabsMu.RUnlock()
	if !ok {
		return fmt.Errorf("tab not found")
	}
	return tab.writeIPC(`{"command": ["cycle", "pause"]}` + "\n")
}

func (a *App) Seek(tabID string, pos float64) error {
	a.tabsMu.RLock()
	tab, ok := a.tabs[tabID]
	a.tabsMu.RUnlock()
	if !ok {
		return nil
	}
	tab.stateMu.RLock()
	dur := tab.duration
	tab.stateMu.RUnlock()
	if dur == 0 {
		return nil
	}
	return tab.writeIPC(fmt.Sprintf(`{"command": ["seek", %f, "absolute"]}`+"\n", pos*dur))
}

func (a *App) GetPlaybackInfo(tabID string) PlaybackInfo {
	a.tabsMu.RLock()
	tab, ok := a.tabs[tabID]
	a.tabsMu.RUnlock()
	if !ok {
		return PlaybackInfo{Paused: true}
	}
	tab.stateMu.RLock()
	defer tab.stateMu.RUnlock()
	return PlaybackInfo{
		TimePos:  tab.timePos,
		Duration: tab.duration,
		Paused:   tab.paused,
	}
}

// GetAllTabsState returns a map of tabID → isPlaying for tab indicators.
func (a *App) GetAllTabsState() map[string]bool {
	a.tabsMu.RLock()
	defer a.tabsMu.RUnlock()
	result := make(map[string]bool)
	for id, tab := range a.tabs {
		tab.stateMu.RLock()
		result[id] = !tab.paused && tab.duration > 0
		tab.stateMu.RUnlock()
	}
	return result
}

func (a *App) ToggleFullscreen() {
	if a.isFullscreen {
		runtime.WindowUnfullscreen(a.ctx)
		a.isFullscreen = false
		runtime.EventsEmit(a.ctx, "fullscreen-changed", false)
	} else {
		runtime.WindowFullscreen(a.ctx)
		a.isFullscreen = true
		runtime.EventsEmit(a.ctx, "fullscreen-changed", true)
	}
	// Reposition immediately for the y-offset flip; the frontend resize listener
	// will follow up with the correct final dimensions once the window settles.
	a.ResizeVideo()
}

func (a *App) GetVersion() string {
	return getAppVersion()
}

// positionChildWindow sizes and places hwnd so it fills the parent client area
// below the tab bar (or the whole area when fullscreen).
func (a *App) positionChildWindow(hwnd uintptr) {
	var r winRECT
	getClientRectW.Call(a.parentHWND, uintptr(unsafe.Pointer(&r)))
	w := uintptr(r.Right - r.Left)
	h := uintptr(r.Bottom - r.Top)
	yOff := uintptr(0)
	if !a.isFullscreen {
		yOff = uintptr(tabBarHeight)
	}
	moveWindowW.Call(hwnd, 0, yOff, w, h-yOff, 1)
}

// ResizeVideo repositions the active video window to match the current client
// size. Called by the frontend on window resize events.
func (a *App) ResizeVideo() {
	a.tabsMu.RLock()
	tab, ok := a.tabs[a.activeTabID]
	a.tabsMu.RUnlock()
	if !ok || tab.childHWND == 0 {
		return
	}
	a.positionChildWindow(tab.childHWND)
}

// GetRecentFiles returns up to displayRecentFiles recently-opened paths.
func (a *App) GetRecentFiles() []RecentEntry {
	entries, _ := loadRecentFiles()
	if len(entries) > displayRecentFiles {
		entries = entries[:displayRecentFiles]
	}
	if entries == nil {
		return []RecentEntry{}
	}
	return entries
}

// ClearRecentFiles wipes the recently-opened list.
func (a *App) ClearRecentFiles() {
	_ = saveRecentFiles(nil)
}

// GetAppDataDir returns the app data directory path (useful for diagnostics).
func (a *App) GetAppDataDir() string {
	dir, err := appDataDir()
	if err != nil {
		return "(error: " + err.Error() + ")"
	}
	return dir
}

// ── Win32 helpers ────────────────────────────────────────────────────────────

func getWailsHWND(title string) (uintptr, error) {
	titlePtr, err := syscall.UTF16PtrFromString(title)
	if err != nil {
		return 0, err
	}
	ret, _, callErr := findWindowW.Call(0, uintptr(unsafe.Pointer(titlePtr)))
	if ret == 0 {
		return 0, fmt.Errorf("FindWindowW: %w", callErr)
	}
	return ret, nil
}

func getDirectChildren(parent uintptr) []uintptr {
	var children []uintptr
	child, _, _ := getWindowW.Call(parent, gwChild)
	for child != 0 {
		children = append(children, child)
		child, _, _ = getWindowW.Call(child, gwHwndNext)
	}
	return children
}

func waitForNewChildHWND(parent uintptr, before []uintptr, timeout time.Duration) uintptr {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		for _, h := range getDirectChildren(parent) {
			isNew := true
			for _, b := range before {
				if h == b {
					isNew = false
					break
				}
			}
			if isNew {
				return h
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	return 0
}

func setWindowVisibility(hwnd uintptr, visible bool) {
	flag := swHide
	if visible {
		flag = swShow
	}
	showWindowW.Call(hwnd, flag)
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
