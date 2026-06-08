//go:build windows

package main

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
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
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var (
	modUser32           = syscall.NewLazyDLL("user32.dll")
	findWindowW         = modUser32.NewProc("FindWindowW")
	showWindowW         = modUser32.NewProc("ShowWindow")
	getWindowW          = modUser32.NewProc("GetWindow")
	getClientRectW      = modUser32.NewProc("GetClientRect")
	moveWindowW         = modUser32.NewProc("MoveWindow")
	getWindowLongW      = modUser32.NewProc("GetWindowLongW")
	setWindowLongW      = modUser32.NewProc("SetWindowLongW")
	setWindowPos        = modUser32.NewProc("SetWindowPos")
	getWindowRect       = modUser32.NewProc("GetWindowRect")
	monitorFromWin      = modUser32.NewProc("MonitorFromWindow")
	getMonitorInfoW     = modUser32.NewProc("GetMonitorInfoW")
	setWindowLongPtrW   = modUser32.NewProc("SetWindowLongPtrW")
	callWindowProcW     = modUser32.NewProc("CallWindowProcW")
)

const (
	swHide     = uintptr(0)
	swShow     = uintptr(8) // SW_SHOWNA — show without activating (preserves z-order)
	gwChild    = uintptr(5)
	gwHwndNext = uintptr(2)

	tabBarHeight = 36 // must match .tab-bar height in style.css

	gwlStyle           = uintptr(0xFFFFFFF0) // GWL_STYLE = -16 as uint
	wsOverlappedWindow = uint32(0x00CF0000)
	swpFrameChanged    = uintptr(0x0020)
	swpNozorder        = uintptr(0x0004)
	swpNomove          = uintptr(0x0002)
	swpNosize          = uintptr(0x0001)
	hwndTop             = uintptr(0)
	hwndBottom          = uintptr(1)
	monitorDefaultToNearest = uintptr(2)

	// SetWindowLongPtr index for replacing the window procedure
	gwlpWndProc = uintptr(0xFFFFFFFC) // GWLP_WNDPROC = -4 (lower 32 bits)

	// WM_SYSCOMMAND / SC_KEYMENU — suppress Alt-key system menu activation
	wmSysCommand = uintptr(0x0112)
	scKeyMenu    = uintptr(0xF100)
)

type winRECT struct{ Left, Top, Right, Bottom int32 }

// origWndProc holds the previous window procedure so we can forward non-intercepted messages.
var (
	origWndProc    uintptr
	wndProcCallback uintptr // kept alive so GC doesn't collect the closure
)

// wndProcSubclass intercepts WM_SYSCOMMAND/SC_KEYMENU to prevent Alt from opening
// the Win32 system menu (which would conflict with Alt+N tab shortcuts and be annoying).
func wndProcSubclass(hwnd, msg, wParam, lParam uintptr) uintptr {
	if msg == wmSysCommand && (wParam&0xFFF0) == scKeyMenu {
		return 0 // swallow — no system menu
	}
	ret, _, _ := callWindowProcW.Call(origWndProc, hwnd, msg, wParam, lParam)
	return ret
}

type monitorInfo struct {
	cbSize    uint32
	rcMonitor winRECT
	rcWork    winRECT
	dwFlags   uint32
}

// PlaybackInfo is returned to the frontend for a given tab.
type PlaybackInfo struct {
	TimePos  float64 `json:"time_pos"`
	Duration float64 `json:"duration"`
	Paused   bool    `json:"paused"`
	Volume   float64 `json:"volume"`
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
	volume   float64 // 0–100; defaults to 100
	dbID     int64   // videos.id; 0 until DB upsert completes
	hash     string  // hex SHA-256 of 3×64 KB chunks; "" until background hash completes
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
	fmt.Fprint(conn, `{"command": ["observe_property", 4, "volume"]}`+"\n")
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
				if v && t.dbID != 0 {
					pos, dbID := t.timePos, t.dbID
					go dbSavePosition(dbID, pos) //nolint:errcheck
				}
			}
		case "volume":
			if v, ok := msg["data"].(float64); ok {
				t.volume = v
			}
		}
		t.stateMu.Unlock()
	}
}

// App is the Wails application struct.
type App struct {
	ctx              context.Context
	parentHWND       uintptr
	tabsMu           sync.RWMutex
	tabs             map[string]*TabInstance
	activeTabID      string
	isFullscreen     bool
	savedWindowStyle uint32
	savedWindowRect  winRECT
	prefs            Preferences
}

func NewApp() *App {
	return &App{tabs: make(map[string]*TabInstance)}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.prefs = loadPreferences()
	if err := initDB(); err != nil {
		a.emitDebug("db", "initDB failed: "+err.Error())
	} else {
		a.emitDebug("db", "db opened")
	}
}

func (a *App) onDomReady(ctx context.Context) {
	if a.parentHWND != 0 {
		// dev hot-reload fires onDomReady again — HWND already found, skip
		a.emitDebug("startup", "onDomReady re-fired (dev reload), skipping")
		return
	}
	hwnd, err := getWailsHWND("Lucid Player")
	if err != nil {
		a.emitDebug("startup", "FindWindowW failed: "+err.Error())
		fmt.Println("HWND error:", err)
		return
	}
	a.parentHWND = hwnd
	a.emitDebug("startup", fmt.Sprintf("parentHWND=%d — ready", hwnd))

	// Subclass the window procedure to suppress Alt-key system menu (SC_KEYMENU).
	// This prevents Alt+Space from opening the Win32 system menu and allows
	// Alt+N shortcuts to work cleanly without the menu bar activating.
	wndProcCallback = syscall.NewCallback(wndProcSubclass)
	origWndProc, _, _ = setWindowLongPtrW.Call(a.parentHWND, gwlpWndProc, wndProcCallback)
	a.emitDebug("startup", fmt.Sprintf("wndproc subclassed, orig=%d", origWndProc))
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
	for tabID, tab := range a.tabs {
		tab.stateMu.RLock()
		pos, dbID := tab.timePos, tab.dbID
		tab.stateMu.RUnlock()
		if dbID != 0 {
			_ = dbSavePosition(dbID, pos)
			a.emitDebug("db", fmt.Sprintf("saved %.1fs for %s on shutdown", pos, tabID))
		}
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
		"--no-terminal",
		"--keep-open=yes",
		"--loop-file=inf",
		"--no-input-default-bindings", // prevent mpv from handling its own clicks/keys
		"--input-vo-keyboard=no",      // prevent mpv vo from consuming keyboard events
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
	// Push mpv to the bottom of the z-order so WebView2 (created earlier) stays on
	// top and captures all mouse input — prevents mpv's click-to-pause from firing.
	if childHWND != 0 {
		a.positionChildWindow(childHWND)
		setWindowVisibility(childHWND, false)
		setWindowPos.Call(childHWND, hwndBottom, 0, 0, 0, 0, swpNosize|swpNomove)
	}

	tab := &TabInstance{
		filePath:  filePath,
		mpvCmd:    cmd,
		ipcConn:   conn,
		childHWND: childHWND,
		paused:    true,
	}

	// Upsert filepath into DB immediately so recents are updated right away.
	// This also returns any previously saved hash and position for this path.
	now := time.Now().Format(time.RFC3339)
	var savedPos float64
	if rec, err := dbUpsertFilepath(filePath, now); err == nil {
		tab.dbID = rec.ID
		tab.hash = rec.Hash
		savedPos = rec.LastPos
		a.emitDebug("db", fmt.Sprintf("filepath upsert id=%d hash=%q", rec.ID, shortHash(rec.Hash)))
		if rec.Hash != "" && rec.LastPos > 0 {
			a.emitDebug("db", fmt.Sprintf("filepath hit — restoring %.1fs", rec.LastPos))
		} else if rec.Hash != "" {
			a.emitDebug("db", "filepath hit — no saved position")
		}
	} else {
		a.emitDebug("db", "filepath upsert error: "+err.Error())
	}

	// Register tab before starting goroutines so hashAndLookup can find it.
	a.tabsMu.Lock()
	a.tabs[tabID] = tab
	a.tabsMu.Unlock()

	go tab.startReader()

	if tab.hash != "" {
		// Known file: hash already in DB; restore position if any.
		if savedPos > 0 {
			go restorePosition(tab, savedPos)
		}
		go a.ensureThumbnails(tabID, tab, filePath, tab.hash, false, false)
	} else {
		// Unknown file or DB unavailable: hash in background.
		go a.hashAndLookup(tabID, filePath)
	}

	return tabID, nil
}

// restorePosition waits for mpv to load, then seeks to the saved position.
func restorePosition(tab *TabInstance, pos float64) {
	time.Sleep(600 * time.Millisecond)
	_ = tab.writeIPC(fmt.Sprintf(`{"command":["set_property","time-pos",%f]}`+"\n", pos))
}

// hashAndLookup hashes filePath in the background, checks the DB for a known
// record, and restores position if one is found.
func (a *App) hashAndLookup(tabID, filePath string) {
	start := time.Now()
	a.emitDebug("hash", "hashing: "+filepath.Base(filePath))

	hash, err := hashVideoFile(filePath)
	if err != nil {
		a.emitDebug("hash", "hash error: "+err.Error())
		return
	}
	elapsed := time.Since(start)
	a.emitDebug("hash", fmt.Sprintf("hashed %s in %dms → %s…", filepath.Base(filePath), elapsed.Milliseconds(), hash[:8]))

	a.tabsMu.RLock()
	tab, ok := a.tabs[tabID]
	a.tabsMu.RUnlock()
	if !ok {
		a.emitDebug("hash", "tab closed before hash completed, discarding")
		return
	}

	now := time.Now().Format(time.RFC3339)

	if rec, err := dbGetByHash(hash); err == nil {
		// Hash match: same video under a different path — merge records.
		a.emitDebug("db", fmt.Sprintf("hash hit — old path: %s", filepath.Base(rec.Filepath)))
		if mergeErr := dbMergeHashRecord(rec.ID, tab.dbID, filePath, now); mergeErr != nil {
			a.emitDebug("db", "merge error: "+mergeErr.Error())
		}
		tab.stateMu.Lock()
		tab.dbID = rec.ID
		tab.hash = hash
		tab.stateMu.Unlock()
		if rec.LastPos > 0 {
			a.emitDebug("db", fmt.Sprintf("restoring %.1fs (hash match)", rec.LastPos))
			go restorePosition(tab, rec.LastPos)
		}
	} else {
		// New video: record the hash on the existing filepath row.
		a.emitDebug("db", "new video — recording hash")
		tab.stateMu.Lock()
		tab.hash = hash
		tab.stateMu.Unlock()
		if tab.dbID != 0 {
			if setErr := dbSetHash(tab.dbID, hash); setErr != nil {
				a.emitDebug("db", "set hash error: "+setErr.Error())
			}
		}
	}

	go a.ensureThumbnails(tabID, tab, filePath, hash, false, false)
}

// shortHash returns the first 8 chars of a hash (for debug output), or "" if empty.
func shortHash(h string) string {
	if len(h) >= 8 {
		return h[:8]
	}
	return h
}

// ensureThumbnails checks the thumbnail cache for the given video and either
// notifies the frontend of existing data or generates new thumbnails.
// forceGenerate=true deletes existing files and regenerates unconditionally.
// Runs as a goroutine.
// ensureThumbnails checks the thumbnail cache and generates if needed.
//   forceGenerate=true  — delete existing files and regenerate (Shift+F5)
//   manualTrigger=true  — user pressed F5; generate even if autogenerate pref is off
// Runs as a goroutine.
func (a *App) ensureThumbnails(tabID string, tab *TabInstance, videoPath, hash string, forceGenerate, manualTrigger bool) {
	logFn := func(msg string) { a.emitDebug("thumbs", msg) }

	dir, err := mediaDir(hash)
	if err != nil {
		logFn("mediaDir error: " + err.Error())
		return
	}
	ssPath := filepath.Join(dir, "spritesheet.jpg")
	vttPath := filepath.Join(dir, "spritesheet.vtt")

	isCached := func() bool {
		_, e1 := os.Stat(ssPath)
		_, e2 := os.Stat(vttPath)
		return e1 == nil && e2 == nil
	}

	// Cache hit and not forced: notify frontend immediately, no generation needed.
	if isCached() && !forceGenerate {
		logFn("cache hit — notifying frontend")
		runtime.EventsEmit(a.ctx, "seek-thumbs-ready", tabID)
		return
	}

	// Determine whether to generate: force, manual trigger, or autogenerate pref.
	if !forceGenerate && !manualTrigger && !a.prefs.AutogenerateSeekThumbs {
		return
	}

	// Need to generate: poll for duration first.
	var duration float64
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		tab.stateMu.RLock()
		duration = tab.duration
		tab.stateMu.RUnlock()
		if duration > 0 {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	if duration <= 0 {
		logFn("duration unavailable, skipping thumbnail generation")
		return
	}

	if forceGenerate {
		os.Remove(ssPath)
		os.Remove(vttPath)
		logFn("force regeneration — deleted cached files")
	}

	a.emitDebug("thumbs", fmt.Sprintf("generating thumbnails for %s (%.0fs)", filepath.Base(videoPath), duration))
	runtime.EventsEmit(a.ctx, "seek-thumbs-generating", tabID)
	start := time.Now()

	skipped, err := generateThumbnails(videoPath, hash, duration, logFn)
	if err != nil {
		logFn("generation error: " + err.Error())
		return
	}
	if skipped {
		// Concurrent guard hit — the other goroutine will emit seek-thumbs-ready.
		return
	}
	logFn(fmt.Sprintf("thumbnails ready in %.1fs", time.Since(start).Seconds()))
	runtime.EventsEmit(a.ctx, "seek-thumbs-ready", tabID)
}

// GetPreferences returns the current user preferences.
func (a *App) GetPreferences() Preferences {
	return a.prefs
}

// SavePreferences persists the given preferences to disk and updates in-memory state.
func (a *App) SavePreferences(p Preferences) error {
	if err := savePreferences(p); err != nil {
		return err
	}
	a.prefs = p
	return nil
}

// StartSeekThumbnailGeneration triggers thumbnail generation for the given tab.
func (a *App) StartSeekThumbnailGeneration(tabID string) error {
	a.tabsMu.RLock()
	tab, ok := a.tabs[tabID]
	a.tabsMu.RUnlock()
	if !ok {
		return fmt.Errorf("tab not found")
	}
	tab.stateMu.RLock()
	hash := tab.hash
	tab.stateMu.RUnlock()
	if hash == "" {
		return fmt.Errorf("hash not available yet — try again in a moment")
	}
	go a.ensureThumbnails(tabID, tab, tab.filePath, hash, false, true)
	return nil
}

// RegenerateSeekThumbnails forces deletion and re-generation of seek thumbnails.
func (a *App) RegenerateSeekThumbnails(tabID string) error {
	a.tabsMu.RLock()
	tab, ok := a.tabs[tabID]
	a.tabsMu.RUnlock()
	if !ok {
		return fmt.Errorf("tab not found")
	}
	tab.stateMu.RLock()
	hash := tab.hash
	tab.stateMu.RUnlock()
	if hash == "" {
		return fmt.Errorf("hash not available yet")
	}
	go a.ensureThumbnails(tabID, tab, tab.filePath, hash, true, false)
	return nil
}

// GetSeekThumbnailData returns the VTT text and base64-encoded spritesheet for
// the given tab. Returns Ready=false if thumbnails are not yet generated or the
// tab's hash is not yet known.
func (a *App) GetSeekThumbnailData(tabID string) SeekThumbnailData {
	a.tabsMu.RLock()
	tab, ok := a.tabs[tabID]
	a.tabsMu.RUnlock()
	if !ok {
		return SeekThumbnailData{}
	}

	tab.stateMu.RLock()
	hash := tab.hash
	tab.stateMu.RUnlock()
	if hash == "" {
		return SeekThumbnailData{}
	}

	dir, err := mediaDir(hash)
	if err != nil {
		return SeekThumbnailData{}
	}
	vttBytes, err := os.ReadFile(filepath.Join(dir, "spritesheet.vtt"))
	if err != nil {
		return SeekThumbnailData{}
	}
	ssBytes, err := os.ReadFile(filepath.Join(dir, "spritesheet.jpg"))
	if err != nil {
		return SeekThumbnailData{}
	}
	return SeekThumbnailData{
		VTT:               string(vttBytes),
		SpritesheetBase64: "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(ssBytes),
		Ready:             true,
	}
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
		runtime.WindowSetTitle(a.ctx, "Lucid Player")
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
	runtime.WindowSetTitle(a.ctx, "Lucid Player - "+filepath.Base(tab.filePath))
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

	// Save playback position before closing.
	tab.stateMu.RLock()
	pos, dbID := tab.timePos, tab.dbID
	tab.stateMu.RUnlock()
	if dbID != 0 {
		_ = dbSavePosition(dbID, pos)
		a.emitDebug("db", fmt.Sprintf("saved position %.1fs on tab close", pos))
	}

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
	tab.stateMu.RLock()
	paused := tab.paused
	tab.stateMu.RUnlock()
	a.emitDebug("TogglePlayback", fmt.Sprintf("tabID=%s paused=%v → cycling", tabID, paused))
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
		return PlaybackInfo{Paused: true, Volume: 100}
	}
	tab.stateMu.RLock()
	defer tab.stateMu.RUnlock()
	vol := tab.volume
	if vol == 0 {
		vol = 100
	}
	return PlaybackInfo{
		TimePos:  tab.timePos,
		Duration: tab.duration,
		Paused:   tab.paused,
		Volume:   vol,
	}
}

// SetVolume adjusts the volume for the given tab (0–100).
func (a *App) SetVolume(tabID string, volume float64) error {
	a.tabsMu.RLock()
	tab, ok := a.tabs[tabID]
	a.tabsMu.RUnlock()
	if !ok {
		return fmt.Errorf("tab %s not found", tabID)
	}
	return tab.writeIPC(fmt.Sprintf(`{"command":["set_property","volume",%g]}`+"\n", volume))
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
		// Restore window style and saved position/size.
		setWindowLongW.Call(a.parentHWND, gwlStyle, uintptr(a.savedWindowStyle))
		setWindowPos.Call(a.parentHWND, hwndTop,
			uintptr(uint32(a.savedWindowRect.Left)),
			uintptr(uint32(a.savedWindowRect.Top)),
			uintptr(uint32(a.savedWindowRect.Right-a.savedWindowRect.Left)),
			uintptr(uint32(a.savedWindowRect.Bottom-a.savedWindowRect.Top)),
			swpFrameChanged|swpNozorder,
		)
		a.isFullscreen = false
		runtime.EventsEmit(a.ctx, "fullscreen-changed", false)
	} else {
		// Save current style and window rect before stripping decoration.
		style, _, _ := getWindowLongW.Call(a.parentHWND, gwlStyle)
		a.savedWindowStyle = uint32(style)
		getWindowRect.Call(a.parentHWND, uintptr(unsafe.Pointer(&a.savedWindowRect)))

		// Get the monitor rect that contains the window.
		hMon, _, _ := monitorFromWin.Call(a.parentHWND, monitorDefaultToNearest)
		var mi monitorInfo
		mi.cbSize = uint32(unsafe.Sizeof(mi))
		getMonitorInfoW.Call(hMon, uintptr(unsafe.Pointer(&mi)))

		// Remove title bar / borders, then cover the monitor.
		setWindowLongW.Call(a.parentHWND, gwlStyle, uintptr(a.savedWindowStyle&^wsOverlappedWindow))
		setWindowPos.Call(a.parentHWND, hwndTop,
			uintptr(uint32(mi.rcMonitor.Left)),
			uintptr(uint32(mi.rcMonitor.Top)),
			uintptr(uint32(mi.rcMonitor.Right-mi.rcMonitor.Left)),
			uintptr(uint32(mi.rcMonitor.Bottom-mi.rcMonitor.Top)),
			swpFrameChanged|swpNozorder,
		)
		a.isFullscreen = true
		runtime.EventsEmit(a.ctx, "fullscreen-changed", true)
	}
	// Defer ResizeVideo until the window has actually settled.
	time.AfterFunc(50*time.Millisecond, a.ResizeVideo)
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

// GetRecentFiles returns up to 10 recently-opened paths from the DB,
// filtered to only include files that currently exist on disk.
func (a *App) GetRecentFiles() []RecentEntry {
	entries, err := dbGetRecents(10)
	if err != nil {
		a.emitDebug("db", "GetRecentFiles error: "+err.Error())
		return []RecentEntry{}
	}
	out := entries[:0]
	for _, e := range entries {
		if _, err := os.Stat(e.Path); err == nil {
			out = append(out, e)
		}
	}
	return out
}

// ClearRecentFiles hides all entries from the recents list while preserving
// hash and position data.
func (a *App) ClearRecentFiles() {
	if err := dbClearRecents(); err != nil {
		a.emitDebug("db", "ClearRecentFiles error: "+err.Error())
	}
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
