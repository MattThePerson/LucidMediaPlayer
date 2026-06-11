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
	"sort"
	"strings"
	"sync"
	"time"

	"lucidmediaplayer/internal/db"
	"lucidmediaplayer/internal/storage"
	"lucidmediaplayer/internal/thumbs"
	"lucidmediaplayer/internal/config"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// windowRect is a portable rectangle type used for saved window bounds.
type windowRect struct{ Left, Top, Right, Bottom int32 }

var mediaExtensions = map[string]bool{
	".mp4": true, ".mkv": true, ".avi": true, ".mov": true,
	".webm": true, ".flv": true, ".wmv": true, ".m4v": true,
	".mpg": true, ".mpeg": true, ".ts": true, ".m2ts": true,
	".mp3": true, ".flac": true, ".ogg": true, ".wav": true,
	".aac": true, ".opus": true, ".m4a": true,
}

const tabBarHeight = 36 // must match .tab-bar { height: 36px } in style.css

// PlaybackInfo is returned to the frontend for a given tab.
type PlaybackInfo struct {
	TimePos  float64 `json:"time_pos"`
	Duration float64 `json:"duration"`
	Paused   bool    `json:"paused"`
	Volume   float64 `json:"volume"`
}

// mpvTrackRaw matches MPV's track-list JSON format (hyphenated field names from MPV IPC).
type mpvTrackRaw struct {
	ID               int    `json:"id"`
	Type             string `json:"type"`
	Title            string `json:"title"`
	Lang             string `json:"lang"`
	Codec            string `json:"codec"`
	Selected         bool   `json:"selected"`
	External         bool   `json:"external"`
	ExternalFilename string `json:"external-filename"`
}

// TrackInfo is the frontend representation of one media track.
type TrackInfo struct {
	ID               int    `json:"id"`
	Type             string `json:"type"`
	Title            string `json:"title"`
	Lang             string `json:"lang"`
	Codec            string `json:"codec"`
	Selected         bool   `json:"selected"`
	External         bool   `json:"external"`
	ExternalFilename string `json:"externalFilename"`
}

// SubtitleState holds the subtitle track list and active track ID for the frontend.
type SubtitleState struct {
	Tracks    []TrackInfo `json:"tracks"`
	ActiveSID int         `json:"activeSid"`
}

// TabInstance owns one mpv subprocess and its associated state.
type TabInstance struct {
	filePath  string
	mpvCmd    *exec.Cmd
	ipcConn   net.Conn
	ipcMu     sync.Mutex
	childHWND uintptr

	stateMu   sync.RWMutex
	timePos   float64
	duration  float64
	paused    bool
	volume    float64
	dbID      int64
	hash      string
	subText   string
	trackList []TrackInfo
	activeSid int
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

func (t *TabInstance) startReader(a *App, tabID string, watchEOF bool) {
	t.ipcMu.Lock()
	conn := t.ipcConn
	fmt.Fprint(conn, `{"command": ["observe_property", 1, "time-pos"]}`+"\n")
	fmt.Fprint(conn, `{"command": ["observe_property", 2, "duration"]}`+"\n")
	fmt.Fprint(conn, `{"command": ["observe_property", 3, "pause"]}`+"\n")
	fmt.Fprint(conn, `{"command": ["observe_property", 4, "volume"]}`+"\n")
	if watchEOF {
		fmt.Fprint(conn, `{"command": ["observe_property", 5, "eof-reached"]}`+"\n")
	}
	fmt.Fprint(conn, `{"command": ["observe_property", 6, "sub-text"]}`+"\n")
	fmt.Fprint(conn, `{"command": ["observe_property", 7, "track-list"]}`+"\n")
	fmt.Fprint(conn, `{"command": ["observe_property", 8, "sid"]}`+"\n")
	// Disable MPV's own subtitle rendering so the app displays subs via sub-text IPC property.
	fmt.Fprint(conn, `{"command": ["set_property", "sub-visibility", false]}`+"\n")
	t.ipcMu.Unlock()

	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 256*1024), 256*1024) // track-list can be large JSON
	for scanner.Scan() {
		var msg map[string]interface{}
		if json.Unmarshal(scanner.Bytes(), &msg) != nil {
			continue
		}
		if msg["event"] != "property-change" {
			continue
		}
		var eofSignal, emitSubText, emitSubTracks bool
		var subTextVal string
		var subTracksVal []TrackInfo
		var activeSidVal int

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
					go db.SavePosition(dbID, pos) //nolint:errcheck
				}
			}
		case "volume":
			if v, ok := msg["data"].(float64); ok {
				t.volume = v
			}
		case "eof-reached":
			if v, ok := msg["data"].(bool); ok && v {
				eofSignal = true
			}
		case "sub-text":
			text := ""
			if v, ok := msg["data"].(string); ok {
				text = v
			}
			if text != t.subText {
				t.subText = text
				subTextVal = text
				emitSubText = true
			}
		case "track-list":
			if data := msg["data"]; data != nil {
				if b, err := json.Marshal(data); err == nil {
					var raw []mpvTrackRaw
					if json.Unmarshal(b, &raw) == nil {
						tracks := make([]TrackInfo, len(raw))
						for i, r := range raw {
							tracks[i] = TrackInfo{
								ID: r.ID, Type: r.Type, Title: r.Title,
								Lang: r.Lang, Codec: r.Codec, Selected: r.Selected,
								External: r.External, ExternalFilename: r.ExternalFilename,
							}
						}
						t.trackList = tracks
						subTracksVal = tracks
						activeSidVal = t.activeSid
						emitSubTracks = true
					}
				}
			}
		case "sid":
			newSid := 0
			if data := msg["data"]; data != nil {
				if v, ok := data.(float64); ok {
					newSid = int(v)
				}
			}
			t.activeSid = newSid
			subTracksVal = t.trackList
			activeSidVal = newSid
			emitSubTracks = true
		}
		t.stateMu.Unlock()

		if eofSignal {
			runtime.EventsEmit(a.ctx, "playlist-video-ended", tabID)
		}
		if emitSubText {
			runtime.EventsEmit(a.ctx, "subtitle-text", map[string]string{"tabID": tabID, "text": subTextVal})
		}
		if emitSubTracks {
			runtime.EventsEmit(a.ctx, "subtitle-tracks", map[string]interface{}{
				"tabID":     tabID,
				"tracks":    subTracksVal,
				"activeSid": activeSidVal,
			})
		}
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
	savedWindowRect  windowRect
	prefs            Preferences
	startupFile      string
	domReady         bool // guards against double onDomReady fire in dev hot-reload
	trayHIcon        uintptr
	// profile          string
}

func NewApp() *App {
	return &App{tabs: make(map[string]*TabInstance)}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.prefs = loadPreferences()
	dir, err := storage.ProfileDataDir()
	if err != nil {
		a.emitDebug("db", "appDataDir failed: "+err.Error())
	} else if err := db.InitDB(filepath.Join(dir, "db.sqlite")); err != nil {
		a.emitDebug("db", "initDB failed: "+err.Error())
	} else {
		a.emitDebug("db", "db opened")
	}
	go startInstanceServer(func(path string) {
		runtime.EventsEmit(a.ctx, "open-file", path)
		bringToFront(a)
	})
}

func (a *App) onDomReady(ctx context.Context) {
	if a.domReady {
		a.emitDebug("startup", "onDomReady re-fired (dev reload), skipping")
		return
	}
	a.domReady = true

	hwnd, err := initPlatform(a)
	if err != nil {
		a.emitDebug("startup", "initPlatform failed: "+err.Error())
		fmt.Println("initPlatform error:", err)
		return
	}
	a.parentHWND = hwnd
	a.emitDebug("startup", fmt.Sprintf("parentHWND=%d — ready", hwnd))
	if err := initTray(a); err != nil {
		a.emitDebug("tray", "initTray failed: "+err.Error())
	}

	child, _, _ := getWindowProc.Call(hwnd, gwChild)
	if child != 0 {
		gWebviewHWND = child
		// PostMessage queues the focus request on the Win32 message thread.
		// Calling SetFocus directly from this goroutine would fail silently
		// because SetFocus requires the calling thread to own the window's message queue.
		postMessageProc.Call(hwnd, wmFocusWebview, 0, 0)
	}

	if a.startupFile != "" {
		runtime.EventsEmit(ctx, "open-file", a.startupFile)
		a.startupFile = ""
	}
}

func (a *App) GetDebugHUDInfo() map[string]string {
	return map[string]string{
		"win32": getWin32DebugString(a.parentHWND),
	}
}

func (a *App) emitDebug(source, message string) {
	runtime.EventsEmit(a.ctx, "debug-log", map[string]string{
		"source":  source,
		"message": message,
	})
}

func (a *App) shutdown(ctx context.Context) {
	destroyTray(a)
	a.tabsMu.Lock()
	defer a.tabsMu.Unlock()
	for tabID, tab := range a.tabs {
		tab.stateMu.RLock()
		pos, dbID := tab.timePos, tab.dbID
		tab.stateMu.RUnlock()
		if dbID != 0 {
			_ = db.SavePosition(dbID, pos)
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

// openMpvTab is the shared implementation for OpenVideo and OpenPlaylistVideo.
func (a *App) openMpvTab(filePath string, loopFile bool, watchEOF bool) (string, error) {
	label := "OpenVideo"
	if watchEOF {
		label = "OpenPlaylistVideo"
	}
	a.emitDebug(label, "starting: "+filePath)
	tabID := fmt.Sprintf("tab-%d", time.Now().UnixNano())
	socketPath := ipcPath(tabID)

	before := getChildren(a.parentHWND)

	now := time.Now().Format(time.RFC3339)
	var savedPos float64
	var dbID int64
	var hash string
	if rec, err := db.UpsertFilepath(filePath, now); err == nil {
		dbID = rec.ID
		hash = rec.Hash
		savedPos = rec.LastPos
		a.emitDebug("db", fmt.Sprintf("filepath upsert id=%d hash=%q", rec.ID, shortHash(rec.Hash)))
		if rec.Hash != "" && rec.LastPos > 0 {
			a.emitDebug("db", fmt.Sprintf("filepath hit — starting at %.1fs", rec.LastPos))
		} else if rec.Hash != "" {
			a.emitDebug("db", "filepath hit — no saved position")
		}
	} else {
		a.emitDebug("db", "filepath upsert error: "+err.Error())
	}

	args := []string{
		"--no-terminal",
		"--keep-open=yes",
		"--no-input-default-bindings",
		"--input-vo-keyboard=no",
	}
	args = append(args, mpvWindowArgs(a.parentHWND, socketPath)...)
	if loopFile {
		args = append(args, "--loop-file=inf")
	}
	if hash != "" && savedPos > 0 {
		args = append(args, fmt.Sprintf("--start=%f", savedPos))
	}
	args = append(args, filePath)

	cmd := exec.Command("mpv", args...)
	hideSubprocess(cmd)

	if err := cmd.Start(); err != nil {
		a.emitDebug(label, "mpv start failed: "+err.Error())
		return "", fmt.Errorf("mpv start: %w", err)
	}
	a.emitDebug(label, fmt.Sprintf("mpv pid=%d, connecting IPC...", cmd.Process.Pid))

	conn, err := connectMPV(socketPath, 5*time.Second)
	if err != nil {
		cmd.Process.Kill()
		a.emitDebug(label, "IPC connect failed: "+err.Error())
		return "", fmt.Errorf("IPC connect: %w", err)
	}

	childHWND := waitForChild(a.parentHWND, before, 3*time.Second)
	a.emitDebug(label, fmt.Sprintf("childHWND=%d tabID=%s", childHWND, tabID))

	if childHWND != 0 {
		prepareChild(a, childHWND)
	}

	tab := &TabInstance{
		filePath:  filePath,
		mpvCmd:    cmd,
		ipcConn:   conn,
		childHWND: childHWND,
		paused:    true,
		dbID:      dbID,
		hash:      hash,
	}

	a.tabsMu.Lock()
	a.tabs[tabID] = tab
	a.tabsMu.Unlock()

	go tab.startReader(a, tabID, watchEOF)

	if tab.hash != "" {
		go a.ensureThumbnails(tabID, tab, filePath, tab.hash, false, false)
	} else {
		go a.hashAndLookup(tabID, filePath)
	}

	return tabID, nil
}

// OpenVideo launches a new mpv instance for the given file and returns a tabID.
func (a *App) OpenVideo(filePath string) (string, error) {
	return a.openMpvTab(filePath, true, false)
}

// OpenPlaylistVideo launches an mpv instance without looping, for playlist use.
func (a *App) OpenPlaylistVideo(filePath string) (string, error) {
	return a.openMpvTab(filePath, false, true)
}

// LoadFile replaces the playing file in an existing mpv tab (playlist advance).
func (a *App) LoadFile(tabID, filePath string) error {
	a.tabsMu.RLock()
	tab, ok := a.tabs[tabID]
	a.tabsMu.RUnlock()
	if !ok {
		return fmt.Errorf("tab %s not found", tabID)
	}

	now := time.Now().Format(time.RFC3339)
	if rec, err := db.UpsertFilepath(filePath, now); err == nil {
		tab.stateMu.Lock()
		tab.dbID = rec.ID
		tab.hash = rec.Hash
		tab.filePath = filePath
		tab.stateMu.Unlock()
	}

	pathJSON, _ := json.Marshal(filePath)
	return tab.writeIPC(fmt.Sprintf(`{"command": ["loadfile", %s, "replace"]}`, string(pathJSON)) + "\n")
}

func restorePosition(tab *TabInstance, pos float64) {
	time.Sleep(600 * time.Millisecond)
	_ = tab.writeIPC(fmt.Sprintf(`{"command":["set_property","time-pos",%f]}`+"\n", pos))
}

func (a *App) hashAndLookup(tabID, filePath string) {
	start := time.Now()
	a.emitDebug("hash", "hashing: "+filepath.Base(filePath))

	hash, err := db.HashVideoFile(filePath)
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

	if rec, err := db.GetByHash(hash); err == nil {
		a.emitDebug("db", fmt.Sprintf("hash hit — old path: %s", filepath.Base(rec.Filepath)))
		if mergeErr := db.MergeHashRecord(rec.ID, tab.dbID, filePath, now); mergeErr != nil {
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
		a.emitDebug("db", "new video — recording hash")
		tab.stateMu.Lock()
		tab.hash = hash
		tab.stateMu.Unlock()
		if tab.dbID != 0 {
			if setErr := db.SetHash(tab.dbID, hash); setErr != nil {
				a.emitDebug("db", "set hash error: "+setErr.Error())
			}
		}
	}

	go a.ensureThumbnails(tabID, tab, filePath, hash, false, false)
}

func shortHash(h string) string {
	if len(h) >= 8 {
		return h[:8]
	}
	return h
}

func (a *App) ensureThumbnails(tabID string, tab *TabInstance, videoPath, hash string, forceGenerate, manualTrigger bool) {
	logFn := func(msg string) { a.emitDebug("thumbs", msg) }

	dir, err := storage.MediaDir(hash)
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

	if isCached() && !forceGenerate {
		logFn("cache hit — notifying frontend")
		runtime.EventsEmit(a.ctx, "seek-thumbs-ready", tabID)
		return
	}

	if !forceGenerate && !manualTrigger && !a.prefs.AutogenerateSeekThumbs {
		return
	}

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

	skipped, err := thumbs.GenerateThumbnails(dir, videoPath, duration, logFn)
	if err != nil {
		logFn("generation error: " + err.Error())
		return
	}
	if skipped {
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

// GetSeekThumbnailData returns the VTT text and base64-encoded spritesheet for the given tab.
func (a *App) GetSeekThumbnailData(tabID string) thumbs.SeekThumbnailData {
	a.tabsMu.RLock()
	tab, ok := a.tabs[tabID]
	a.tabsMu.RUnlock()
	if !ok {
		return thumbs.SeekThumbnailData{}
	}

	tab.stateMu.RLock()
	hash := tab.hash
	tab.stateMu.RUnlock()
	if hash == "" {
		return thumbs.SeekThumbnailData{}
	}

	dir, err := storage.MediaDir(hash)
	if err != nil {
		return thumbs.SeekThumbnailData{}
	}
	vttBytes, err := os.ReadFile(filepath.Join(dir, "spritesheet.vtt"))
	if err != nil {
		return thumbs.SeekThumbnailData{}
	}
	ssBytes, err := os.ReadFile(filepath.Join(dir, "spritesheet.jpg"))
	if err != nil {
		return thumbs.SeekThumbnailData{}
	}
	return thumbs.SeekThumbnailData{
		VTT:               string(vttBytes),
		SpritesheetBase64: "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(ssBytes),
		Ready:             true,
	}
}

// FileEntry is one item in a directory listing returned to the frontend.
type FileEntry struct {
	Name          string  `json:"name"`
	Path          string  `json:"path"`
	IsDir         bool    `json:"isDir"`
	Size          int64   `json:"size"`
	DateModified  string  `json:"dateModified"`
	DateCreated   string  `json:"dateCreated"`
	Extension     string  `json:"extension"`
	IsMedia       bool    `json:"isMedia"`
	HasSeekThumbs bool    `json:"hasSeekThumbs"`
	Duration      float64 `json:"duration"`
}

var fileThumbnailCache sync.Map // map[string]string: path → "data:image/jpeg;base64,..."

// GetFolderContents returns all subdirectories and media files in folderPath with metadata.
func (a *App) GetFolderContents(folderPath string) ([]FileEntry, error) {
	entries, err := os.ReadDir(folderPath)
	if err != nil {
		return nil, err
	}
	appDataDir, _ := storage.AppDataDir()
	var result []FileEntry
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			continue
		}
		ext := strings.ToLower(filepath.Ext(e.Name()))
		isMedia := !e.IsDir() && mediaExtensions[ext]
		if !e.IsDir() && !isMedia {
			continue
		}
		modTime := info.ModTime().UTC().Format(time.RFC3339)
		fe := FileEntry{
			Name:         e.Name(),
			Path:         filepath.Join(folderPath, e.Name()),
			IsDir:        e.IsDir(),
			Size:         info.Size(),
			DateModified: modTime,
			DateCreated:  getFileCreatedTime(info, modTime),
			Extension:    ext,
			IsMedia:      isMedia,
		}
		if isMedia && appDataDir != "" {
			hash, duration, found := db.GetVideoMetaByPath(fe.Path)
			if found {
				fe.Duration = duration
				if hash != "" {
					spritesheet := filepath.Join(appDataDir, "media", hash, "spritesheet.jpg")
					if _, serr := os.Stat(spritesheet); serr == nil {
						fe.HasSeekThumbs = true
					}
				}
			}
		}
		result = append(result, fe)
	}
	if result == nil {
		result = []FileEntry{}
	}
	return result, nil
}

// GetFileThumbnail extracts a single JPEG frame from filePath via ffmpeg and returns
// it as a base64 data URI. Results are cached in memory for the process lifetime.
func (a *App) GetFileThumbnail(filePath string) (string, error) {
	if v, ok := fileThumbnailCache.Load(filePath); ok {
		return v.(string), nil
	}
	ffmpegPath, err := exec.LookPath("ffmpeg")
	if err != nil {
		return "", fmt.Errorf("ffmpeg not found")
	}
	data, err := exec.Command(ffmpegPath,
		"-ss", "5", "-i", filePath,
		"-frames:v", "1", "-vf", "scale=320:-2",
		"-f", "mjpeg", "-q:v", "5", "pipe:1",
	).Output()
	if err != nil || len(data) == 0 {
		// Fallback: extract first frame without seeking (for very short files)
		data, err = exec.Command(ffmpegPath,
			"-i", filePath,
			"-frames:v", "1", "-vf", "scale=320:-2",
			"-f", "mjpeg", "-q:v", "5", "pipe:1",
		).Output()
		if err != nil || len(data) == 0 {
			return "", fmt.Errorf("thumbnail extraction failed")
		}
	}
	result := "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(data)
	fileThumbnailCache.Store(filePath, result)
	return result, nil
}

// GetSeekThumbnailDataByPath returns seek thumbnail data for a file path, looking up
// its hash from the database. Use this when no tab is open for the file.
func (a *App) GetSeekThumbnailDataByPath(filePath string) thumbs.SeekThumbnailData {
	hash, _, found := db.GetVideoMetaByPath(filePath)
	if !found || hash == "" {
		return thumbs.SeekThumbnailData{}
	}
	dir, err := storage.MediaDir(hash)
	if err != nil {
		return thumbs.SeekThumbnailData{}
	}
	vttBytes, err := os.ReadFile(filepath.Join(dir, "spritesheet.vtt"))
	if err != nil {
		return thumbs.SeekThumbnailData{}
	}
	ssBytes, err := os.ReadFile(filepath.Join(dir, "spritesheet.jpg"))
	if err != nil {
		return thumbs.SeekThumbnailData{}
	}
	return thumbs.SeekThumbnailData{
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
func (a *App) SwitchTab(tabID string) error {
	a.tabsMu.Lock()
	defer a.tabsMu.Unlock()

	for _, tab := range a.tabs {
		if tab.childHWND != 0 {
			hideChild(tab.childHWND)
		}
	}

	if tabID == "" {
		a.activeTabID = ""
		runtime.WindowSetTitle(a.ctx, "Lucid Media Player")
		go updateTrayTooltip(a)
		return nil
	}

	tab, ok := a.tabs[tabID]
	if !ok {
		return fmt.Errorf("tab %s not found", tabID)
	}
	if tab.childHWND != 0 {
		repositionChild(a, tab.childHWND)
		showChild(tab.childHWND)
	}
	a.activeTabID = tabID
	runtime.WindowSetTitle(a.ctx, "Lucid Media Player - "+filepath.Base(tab.filePath))
	go updateTrayTooltip(a)
	return nil
}

// OpenFilePicker opens a native file dialog and returns the selected path.
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

// OpenFilePickerMultiple opens a native multi-select file dialog.
func (a *App) OpenFilePickerMultiple() ([]string, error) {
	paths, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Add Files to Playlist",
		Filters: []runtime.FileFilter{
			{DisplayName: "Media Files", Pattern: "*.mp4;*.mkv;*.avi;*.mov;*.webm;*.flv;*.wmv;*.m4v;*.ts;*.m2ts;*.mp3;*.flac;*.ogg;*.wav;*.aac;*.opus;*.m4a"},
			{DisplayName: "All Files", Pattern: "*.*"},
		},
	})
	return paths, err
}

// OpenFolderPicker opens a native folder selection dialog.
func (a *App) OpenFolderPicker() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Folder",
	})
}

// GetMediaFilesInFolder returns non-recursively all media files in a directory, sorted by name.
func (a *App) GetMediaFilesInFolder(folderPath string) ([]string, error) {
	entries, err := os.ReadDir(folderPath)
	if err != nil {
		return nil, err
	}
	var files []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if mediaExtensions[strings.ToLower(filepath.Ext(e.Name()))] {
			files = append(files, filepath.Join(folderPath, e.Name()))
		}
	}
	sort.Strings(files)
	return files, nil
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
		hideChild(tab.childHWND)
	}
	delete(a.tabs, tabID)
	if a.activeTabID == tabID {
		a.activeTabID = ""
	}
	a.tabsMu.Unlock()

	tab.stateMu.RLock()
	pos, dbID := tab.timePos, tab.dbID
	tab.stateMu.RUnlock()
	if dbID != 0 {
		_ = db.SavePosition(dbID, pos)
		a.emitDebug("db", fmt.Sprintf("saved position %.1fs on tab close", pos))
	}

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
	go updateTrayTooltip(a)
	return nil
}

// TearOffTab saves position, closes the tab, and spawns a new instance with the same file.
func (a *App) TearOffTab(tabID string) error {
	a.tabsMu.RLock()
	tab, ok := a.tabs[tabID]
	a.tabsMu.RUnlock()
	if !ok {
		return nil
	}
	filePath := tab.filePath
	if err := a.CloseTab(tabID); err != nil {
		return err
	}
	return launchVisible(filePath, "-profile", *config.Profile, "-tearoff")
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

func (a *App) SetPaused(tabID string, paused bool) error {
	a.tabsMu.RLock()
	tab, ok := a.tabs[tabID]
	a.tabsMu.RUnlock()
	if !ok {
		return fmt.Errorf("tab not found")
	}
	val := "true"
	if !paused {
		val = "false"
	}
	return tab.writeIPC(`{"command": ["set_property", "pause", ` + val + `]}` + "\n")
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
	platformToggleFullscreen(a)
}

func (a *App) GetVersion() string {
	return getAppVersion()
}

func (a *App) GetProfile() string {
    return *config.Profile
}

// ResizeVideo repositions the active video window after a window resize event.
func (a *App) ResizeVideo() {
	platformResizeVideo(a)
}

// GetRecentFiles returns all recently-opened paths from the DB,
// filtered to only include files that currently exist on disk.
func (a *App) GetRecentFiles() []db.RecentEntry {
	entries, err := db.GetRecents(0)
	if err != nil {
		a.emitDebug("db", "GetRecentFiles error: "+err.Error())
		return []db.RecentEntry{}
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
	if err := db.ClearRecents(); err != nil {
		a.emitDebug("db", "ClearRecentFiles error: "+err.Error())
	}
}

// GetAppDataDir returns the app data directory path (useful for diagnostics).
func (a *App) GetAppDataDir() string {
	dir, err := storage.AppDataDir()
	if err != nil {
		return "(error: " + err.Error() + ")"
	}
	return dir
}

// GetSubtitleState returns the current subtitle track list and active SID for the given tab.
func (a *App) GetSubtitleState(tabID string) SubtitleState {
	a.tabsMu.RLock()
	tab, ok := a.tabs[tabID]
	a.tabsMu.RUnlock()
	if !ok {
		return SubtitleState{}
	}
	tab.stateMu.RLock()
	defer tab.stateMu.RUnlock()
	return SubtitleState{Tracks: tab.trackList, ActiveSID: tab.activeSid}
}

// SetSubtitleTrack selects a subtitle track by ID; sid=0 disables subtitles.
func (a *App) SetSubtitleTrack(tabID string, sid int) error {
	a.tabsMu.RLock()
	tab, ok := a.tabs[tabID]
	a.tabsMu.RUnlock()
	if !ok {
		return fmt.Errorf("tab %s not found", tabID)
	}
	if sid == 0 {
		return tab.writeIPC(`{"command":["set_property","sid","no"]}` + "\n")
	}
	return tab.writeIPC(fmt.Sprintf(`{"command":["set_property","sid",%d]}`, sid) + "\n")
}

// AddSubtitleFile loads an external subtitle file into the given tab.
func (a *App) AddSubtitleFile(tabID, path string) error {
	a.tabsMu.RLock()
	tab, ok := a.tabs[tabID]
	a.tabsMu.RUnlock()
	if !ok {
		return fmt.Errorf("tab %s not found", tabID)
	}
	pathJSON, _ := json.Marshal(path)
	return tab.writeIPC(fmt.Sprintf(`{"command":["sub-add",%s]}`, string(pathJSON)) + "\n")
}

// FrameStep advances or reverses by one frame (mpv native command).
func (a *App) FrameStep(tabID string, direction int) {
	a.tabsMu.RLock()
	tab, ok := a.tabs[tabID]
	a.tabsMu.RUnlock()
	if !ok {
		return
	}
	cmd := `{"command": ["frame-step"]}` + "\n"
	if direction < 0 {
		cmd = `{"command": ["frame-back-step"]}` + "\n"
	}
	_ = tab.writeIPC(cmd)
}

// SetPlaybackSpeed sets the playback speed multiplier for the given tab.
func (a *App) SetPlaybackSpeed(tabID string, speed float64) {
	a.tabsMu.RLock()
	tab, ok := a.tabs[tabID]
	a.tabsMu.RUnlock()
	if !ok {
		return
	}
	_ = tab.writeIPC(fmt.Sprintf(`{"command": ["set_property", "speed", %g]}`+"\n", speed))
}

func (a *App) SetVideoFilter(tabID string, vfStr string) {
	a.tabsMu.RLock()
	tab, ok := a.tabs[tabID]
	a.tabsMu.RUnlock()
	if !ok {
		return
	}
	_ = tab.writeIPC(fmt.Sprintf(`{"command": ["vf", "set", %q]}`+"\n", vfStr))
}

// RenameVideoFile renames the underlying file on disk for the given tab and reloads
// all affected tabs (any tab whose filePath matches the old path) from their saved positions.
func (a *App) RenameVideoFile(initiatingTabID, newStem string) (string, error) {
	newStem = strings.TrimSpace(newStem)
	if newStem == "" {
		return "", fmt.Errorf("filename cannot be empty")
	}
	if strings.ContainsAny(newStem, `<>:"/\|?*`) {
		return "", fmt.Errorf("filename contains invalid characters")
	}

	a.tabsMu.RLock()
	tab, ok := a.tabs[initiatingTabID]
	a.tabsMu.RUnlock()
	if !ok {
		return "", fmt.Errorf("tab not found")
	}

	tab.stateMu.RLock()
	oldPath := tab.filePath
	tab.stateMu.RUnlock()

	dir := filepath.Dir(oldPath)
	ext := filepath.Ext(oldPath)
	newPath := filepath.Join(dir, newStem+ext)

	if newPath == oldPath {
		return oldPath, nil
	}
	if _, err := os.Stat(newPath); err == nil {
		return "", fmt.Errorf("a file with that name already exists")
	}

	// Capture state for every tab playing this file before the rename.
	type tabState struct {
		id     string
		tab    *TabInstance
		pos    float64
		paused bool
		dbID   int64
	}
	a.tabsMu.RLock()
	var affected []tabState
	for id, t := range a.tabs {
		t.stateMu.RLock()
		if t.filePath == oldPath {
			affected = append(affected, tabState{id: id, tab: t, pos: t.timePos, paused: t.paused, dbID: t.dbID})
		}
		t.stateMu.RUnlock()
	}
	a.tabsMu.RUnlock()

	if err := os.Rename(oldPath, newPath); err != nil {
		return "", fmt.Errorf("rename failed: %w", err)
	}

	newPathJSON, _ := json.Marshal(newPath)
	activeID := a.activeTabID

	for _, ts := range affected {
		opts := fmt.Sprintf("start=%.3f", ts.pos)
		if ts.paused {
			opts += ",pause=yes"
		}
		optsJSON, _ := json.Marshal(opts)
		_ = ts.tab.writeIPC(fmt.Sprintf(
			`{"command": ["loadfile", %s, "replace", %s]}`,
			string(newPathJSON), string(optsJSON),
		) + "\n")

		ts.tab.stateMu.Lock()
		ts.tab.filePath = newPath
		ts.tab.stateMu.Unlock()

		if ts.dbID != 0 {
			if err := db.UpdateFilepathByID(ts.dbID, newPath); err != nil {
				a.emitDebug("rename", "db update error: "+err.Error())
			}
		}

		if ts.id == activeID {
			runtime.WindowSetTitle(a.ctx, "Lucid Media Player - "+filepath.Base(newPath))
		}
	}

	a.emitDebug("rename", fmt.Sprintf("renamed %s → %s (%d tab(s))", filepath.Base(oldPath), filepath.Base(newPath), len(affected)))
	return newPath, nil
}

// RevealInExplorer opens the platform file manager with the given file selected.
func (a *App) RevealInExplorer(path string) {
	path = filepath.FromSlash(path)
	a.emitDebug("reveal", fmt.Sprintf("path=%q", path))
	platformRevealFile(a, path)
}

// OpenSubtitleFilePicker opens a native file dialog for selecting a subtitle file.
func (a *App) OpenSubtitleFilePicker() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Open Subtitle File",
		Filters: []runtime.FileFilter{
			{DisplayName: "Subtitle Files", Pattern: "*.srt;*.ass;*.ssa;*.vtt;*.sub;*.idx"},
			{DisplayName: "All Files", Pattern: "*.*"},
		},
	})
}
