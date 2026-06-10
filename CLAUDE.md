# CLAUDE.md

## Responsibilities

### Versioning and changelog

- **Auto-bump PATCH** — after every set of changes, bump the patch version in `wails.json` and print the new version at the end of the response.
- **Auto-update CHANGELOG** — add a new `## [x.y.z] — YYYY-MM-DD` entry to `docs/CHANGELOG.md` describing what changed. Keep entries concise (one line per item).
- **"NOT bump patch"** — if the user explicitly says not to bump, leave `wails.json` unchanged and amend the current version's CHANGELOG entry instead.
- **MINOR/MAJOR** — bump only when the user explicitly requests it.

---

## Project overview

**Lucid Media Player** — a desktop video player built with [Wails v2](https://wails.io/) (Go backend + React/JSX frontend). Video playback uses **mpv** as a subprocess whose window is embedded into the Wails parent window via Win32 HWND (`--wid`). The UI (tabs, controls, overlays) is rendered by WebView2 on top.

### Tech stack

| Layer | Technology |
|---|---|
| Framework | Wails v2 (Go 1.25+) |
| Frontend | React 18, JSX, plain CSS (no Tailwind) |
| Bundler | Vite (managed by Wails) |
| Video backend | mpv subprocess, Win32 HWND embedding |
| IPC to mpv | Named pipe (`\\.\pipe\mpvsocket-<tabID>`) via `go-winio` |
| Database | SQLite via `modernc.org/sqlite` (pure Go, no CGO) |
| Font | Nunito (local woff2) |

### Dev workflow

```
wails dev          # hot-reload dev server (auto-regenerates wailsjs bindings)
wails build        # production binary
```

`wails dev` auto-generates `frontend/wailsjs/go/main/App.js`, `App.d.ts`, and
`frontend/wailsjs/go/models.ts` from Go exported methods. If you add a new Go
method, restart `wails dev` (or wait for it to detect the change) to get the
binding. You can also write the binding manually in those files as a stopgap.

---

## Architecture

```
Wails window  (Win32 parent HWND)
├── WebView2  (transparent, always on top — renders the React UI)
│   ├── TabBar                36px, opaque dark background
│   ├── HomeScreen            shown when no tab is active
│   ├── PassionPlayerWrapper  React wrapper around PassionPlayer.js; overlaid on active video tab
│   ├── DebugPage             page tab
│   └── ChangelogPage         page tab
└── mpv child windows   one per open video tab, shown/hidden behind WebView2
```

- The WebView2 layer is **transparent** (`WebviewIsTransparent: true` + CSS `background: transparent`) so the mpv windows show through when no opaque React element covers them.
- mpv child windows are **siblings** of the WebView2 window (both are children of the Wails parent HWND), not children of WebView2.
- Tab switching = `ShowWindow(SW_SHOW / SW_HIDE)` on the corresponding child HWND.
- The mpv window must be offset by the tab bar height using `MoveWindow` — see **Critical constants** below.

---

## File map

### Go (backend)

| File | Role |
|---|---|
| `main.go` | Wails app entry point, options (DragAndDrop, Windows transparency) |
| `app.go` | All exported Go methods; Win32 helpers; mpv subprocess management; hash/restore goroutines. **Windows-only** (`//go:build windows`) |
| `database.go` | SQLite init (`db.sqlite`); `VideoRecord` type; all DB CRUD helpers; `hashVideoFile` |
| `storage.go` | Platform-specific AppData dir (`LucidMediaPlayer`); `RecentEntry` type. **No build constraint** |
| `version.go` | `//go:embed wails.json` for version; `//go:embed docs/CHANGELOG.md` for changelog content |

### Frontend

| File | Role |
|---|---|
| `frontend/src/App.jsx` | Root component — all global state, effects, keyboard shortcuts, tab logic |
| `frontend/src/style.css` | All CSS (single file) |
| `frontend/src/debug.js` | Global debug log store (`useSyncExternalStore`); `debugLog()` and `getDebugLogs()` callable from anywhere |
| `frontend/src/components/TabBar.jsx` | Tab bar, hamburger menu, Recently Opened submenu, drag-reorder |
| `frontend/src/components/HomeScreen.jsx` | Home screen with inline SVG logo, version link, drag-over overlay |
| `frontend/src/components/PassionPlayerWrapper.jsx` | Thin React wrapper around `PassionPlayer.js`; ref-based callbacks to avoid stale closure on tab switch |
| `frontend/src/passion_player/PassionPlayer.js` | **Pure-JS, no JSX, no jQuery** video player — Shadow DOM, fully self-contained CSS via `getStyles()`. Supports headless mode (no `<video>`, external callbacks) for use with mpv backend. Also usable standalone in non-React projects (symlink-friendly). |
| `frontend/src/components/DebugPage.jsx` | Live log viewer using `useDebugLogs()` hook |
| `frontend/src/components/ChangelogPage.jsx` | Renders embedded CHANGELOG.md with simple line parser |
| `frontend/wailsjs/go/main/App.js` | **Auto-generated** JS bindings — do not hand-edit unless `wails dev` isn't running |
| `frontend/wailsjs/go/main/App.d.ts` | **Auto-generated** TypeScript types |
| `frontend/wailsjs/go/models.ts` | **Auto-generated** model classes (`PlaybackInfo`, `RecentEntry`) |

### Data / config

| Path | Contents |
|---|---|
| `wails.json` | App name, version (source of truth for version number) |
| `docs/CHANGELOG.md` | User-facing changelog, embedded into the binary |
| `%APPDATA%\LucidMediaPlayer\db.sqlite` | SQLite database — videos table (hash, filepath, last_pos, etc.) |
| `%APPDATA%\LucidMediaPlayer\config\` | Future: `preferences.json`, `keybinds.json` |
| `%APPDATA%\LucidMediaPlayer\media\<hash>\` | Future: seek thumbnails, waveform data per video |

---

## Tab model

Tabs are frontend-only state in `App.jsx`:

```js
// { id: string, type: 'video'|'debug'|'changelog', title: string }
const [tabs, setTabs] = useState([]);
```

- **Video tabs** have a matching entry in Go's `app.tabs` map (keyed by the same `id`). All Go methods (`SwitchTab`, `CloseTab`, etc.) operate on this id.
- **Page tabs** (`debug`, `changelog`) are frontend-only — Go doesn't know about them. When a page tab is active, the frontend calls `SwitchTab('')` to hide all mpv windows.
- Page tabs are singletons — opening one that already exists focuses it instead of creating a duplicate.

---

## Exported Go methods (app.go)

| Method | Purpose |
|---|---|
| `OpenVideo(path) → tabID` | Launches mpv, connects IPC, pre-positions child window, upserts filepath in DB, starts background hash |
| `SwitchTab(tabID)` | Hides all child windows, shows the requested one; `""` = home screen |
| `CloseTab(tabID)` | Saves position to DB, sends IPC quit, closes conn, kills process |
| `TogglePlayback(tabID)` | Sends `cycle pause` via IPC |
| `Seek(tabID, pos)` | Absolute seek; `pos` is 0–1 fraction of duration |
| `GetPlaybackInfo(tabID) → PlaybackInfo` | Returns `{time_pos, duration, paused}` from live IPC state |
| `GetAllTabsState() → map[id]bool` | Returns `isPlaying` for all tabs (for tab indicators) |
| `ToggleFullscreen()` | Wails fullscreen + emits `fullscreen-changed` event + calls `ResizeVideo()` |
| `ResizeVideo()` | `MoveWindow` on active child window to correct size/offset |
| `OpenFilePicker() → path` | Native file open dialog |
| `GetVersion() → string` | From embedded `wails.json` |
| `GetChangelog() → string` | From embedded `docs/CHANGELOG.md` |
| `GetRecentFiles() → []RecentEntry` | Up to 10 entries from DB ordered by `last_opened DESC` |
| `ClearRecentFiles()` | Sets `last_opened=NULL` for all rows (preserves hash + position data) |
| `GetAppDataDir() → string` | Returns resolved AppData path (useful for diagnostics) |

---

## Database (database.go)

### Schema

```sql
CREATE TABLE IF NOT EXISTS videos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    hash        TEXT UNIQUE,       -- NULL until background hash completes
    filepath    TEXT UNIQUE,       -- last known path; updated on rename detection
    last_opened TEXT,              -- RFC3339; NULL means hidden from recents
    last_pos    REAL NOT NULL DEFAULT 0,
    duration    REAL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Key CRUD helpers

| Function | Purpose |
|---|---|
| `initDB()` | Opens/creates `db.sqlite`, runs `CREATE TABLE IF NOT EXISTS` |
| `dbUpsertFilepath(path, openedAt)` | Upserts filepath row, returns full `*VideoRecord` (including any saved hash/pos) |
| `dbGetByHash(hash)` | Looks up a record by file hash |
| `dbSetHash(id, hash)` | Writes hash onto an existing filepath row |
| `dbMergeHashRecord(hashID, fpID, newPath, openedAt)` | Deletes stale filepath row, updates hash row's path — used on rename detection |
| `dbSavePosition(id, pos)` | `UPDATE videos SET last_pos=?` |
| `dbGetRecents(limit)` | `SELECT ... ORDER BY last_opened DESC LIMIT ?` |
| `dbClearRecents()` | `UPDATE videos SET last_opened=NULL` |

### File hashing

`hashVideoFile(path)` in `database.go` reads **3×64 KB chunks** (start, middle, end of file) and returns a SHA-256 hex string. Sub-millisecond for typical files; the same hash is produced regardless of filename or path, so data survives renames and moves.

### Open-video DB flow

1. `dbUpsertFilepath(path, now)` — immediate; updates recents and returns any existing record.
2. If the record already has a `hash`: known file — restore `last_pos` if > 0 via `restorePosition` (600ms delayed IPC seek).
3. If no hash: start `hashAndLookup` goroutine in background:
   - Hash file → if hash matches an existing DB row, merge records and restore position.
   - If no match, write the hash onto the current filepath row (`dbSetHash`).

### Position save triggers

- **On pause** (IPC `property-change pause=true`): `go dbSavePosition(dbID, timePos)` from `startReader`.
- **On tab close** (`CloseTab`): synchronous `dbSavePosition` before IPC quit.
- **On shutdown**: synchronous `dbSavePosition` for all open tabs.

### `TabInstance` DB fields

```go
dbID int64  // videos.id; 0 until DB upsert completes
hash string // hex SHA-256; "" until background hash completes
```

Both fields are written before goroutines start (or under `stateMu`) to avoid data races.

---

## PassionPlayer (frontend/src/passion_player/PassionPlayer.js)

Pure-JS, no JSX, no jQuery. Uses Shadow DOM so styles are fully encapsulated. CSS is inlined in `getStyles()` — the file is self-contained with no external dependencies, making it safe to symlink into other (non-React) projects.

### Modes

- **HTML5 mode**: pass `src` option — creates a real `<video>` element inside Shadow DOM.
- **Headless mode** (used in Wails): no `<video>`; UI reflects external state via `setState()` and fires `onPlay`/`onPause`/`onSeek`/`onFullscreen` callbacks.

### Key API

```js
new PassionPlayer({
    hostEl: domElement,        // mount target (React ref or getElementById result)
    onPlay, onPause,           // fired when user clicks play/pause
    onSeek: pos => ...,        // pos is 0–1 fraction
    onFullscreen: () => ...,
    disable_keybinds: true,    // skip internal Space/F handlers (host manages shortcuts)
})

player.setState({ currentTime, duration, paused })  // push mpv state into UI
player.toggle_playback()   // programmatic toggle
player.destroy()           // cleanup (called by React unmount)
```

### Shadow DOM init guard

```js
// Handles React Strict Mode double-mount — shadow root persists across destroy()
this.shadow = this.root_element.shadowRoot ?? this.root_element.attachShadow({ mode: 'open' });
this.shadow.innerHTML = '';
```

### PassionPlayerWrapper.jsx

Thin React wrapper in `frontend/src/components/`. Uses **ref-based callbacks** so the long-lived `PassionPlayer` instance always calls the current tab's functions even after tab switches:

```jsx
const onTogglePlaybackRef = useRef(onTogglePlayback);
onTogglePlaybackRef.current = onTogglePlayback; // updated every render
```

Mount-once `useEffect` creates the player; a `[info]` effect calls `setState`.

---

## Critical constants and invariants

### `tabBarHeight = 36` (app.go)

Must match the `.tab-bar { height: 36px }` CSS value. Used in `positionChildWindow` to offset the mpv child window below the tab bar. **If you change the CSS height, update the Go constant too.**

### File drop: use JS-side `OnFileDrop`, not Go's `runtime.OnFileDrop`

```js
// CORRECT — works with WebView2
import { OnFileDrop } from '../wailsjs/runtime/runtime';
OnFileDrop((x, y, paths) => { ... }, false);

// WRONG — Go's OnFileDrop only handles Win32 WM_DROPFILES, never fires with WebView2
runtime.OnFileDrop(ctx, callback, false)
```

`DisableWebViewDrop: false` in `main.go` is required for the JS-side API to receive drops.

### `onDomReady` double-fire guard

In dev mode, hot reload fires `onDomReady` again. Guard:
```go
func (a *App) onDomReady(ctx context.Context) {
    if a.parentHWND != 0 { return }  // already initialized
    ...
}
```

### Play/pause indicator lag

After calling `TogglePlayback`, the frontend immediately schedules a 50ms re-poll of `GetPlaybackInfo` + `GetAllTabsState` to update both the button icon and the tab indicator without waiting for the next 500ms / 1000ms poll cycle.

### Window resize debounce

The `window.resize` listener uses a **200ms debounce** before calling `ResizeVideo()`. A shorter debounce causes mpv's renderer to restart on every resize event, creating severe glitching. During active drag the video may briefly cover the tab bar (mpv auto-resizes to fill the parent); the correct position is restored when the debounce fires. The proper long-term fix is a wrapper window approach.

### AppData folder name is PascalCase

The AppData directory is `LucidMediaPlayer` (no spaces). The window title is `"Lucid Media Player"` (with spaces). Do not confuse the two — the folder name must not have spaces.

---

## Debug logging

```js
// Frontend — callable from any component, no prop drilling needed
import { debugLog } from '../debug';
debugLog('MyComponent', 'something happened');

// Get all logs (e.g. for clipboard copy)
import { getDebugLogs } from '../debug';

// Go backend
a.emitDebug("source", "message")
// → emits 'debug-log' event → JS EventsOn handler → debugLog()
```

View logs in the **Debug** page tab (hamburger → Debug). `Ctrl+Shift+C` copies all entries to clipboard.

---

## IPC: mpv named pipe

Each video tab gets `\\.\pipe\mpvsocket-<tabID>`. Communication is newline-delimited JSON.

```go
// Send command
tab.writeIPC(`{"command": ["cycle", "pause"]}` + "\n")

// Observer setup (in startReader goroutine)
{"command": ["observe_property", 1, "time-pos"]}
{"command": ["observe_property", 2, "duration"]}
{"command": ["observe_property", 3, "pause"]}
```

The reader goroutine (`tab.startReader()`) updates `tab.timePos`, `tab.duration`, `tab.paused` under `stateMu`. It also fires `dbSavePosition` asynchronously when `pause=true` is received.

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Space` | Toggle playback (active video tab only) |
| `F` | Toggle fullscreen |
| `F3` | Open Debug tab |
| `Ctrl+W` | Close active tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Cycle tabs |
| `Ctrl+Shift+PageUp/Down` | Move active tab left/right |
| `Ctrl+Shift+C` | Copy all debug log entries to clipboard |
| Middle-click tab | Close tab |
