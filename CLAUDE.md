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
│   ├── PassionPlayerWrapper  overlaid on active video tab
│   ├── PreferencesPage       page tab
│   ├── ManageProfilesPage    page tab
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

### Go (backend — root)

| File | Role |
|---|---|
| `main.go` | Entry point; CLI flags (`-profile`, `-tearoff`); profile validation; single-instance check; `wails.Run` |
| `app.go` | Exported Go methods; Win32 helpers; mpv subprocess management; hash/restore goroutines. **Windows-only** (`//go:build windows`) |
| `app_profiles.go` | Profile-related exported methods (`GetProfileInfo`, `GetProfiles`, `CreateProfile`, etc.) |
| `profiles.go` | `ProfileEntry` type; `loadProfiles`/`saveProfiles`; `generateProfileID` |
| `preferences.go` | `Preferences` struct; `loadPreferences`/`savePreferences` |
| `profile_manager.go` | `launchVisible(args...)` — spawns a new visible app instance (no HideWindow); `launchDetached` for mpv/ffmpeg |
| `singelinstance_windows.go` | Named-pipe single-instance server/client (note typo in filename: "singel") |
| `singleinstance_linux.go` | Unix-socket single-instance server/client |
| `platform_windows.go` | Windows-specific Win32 helpers |
| `platform_linux.go` | Linux stubs |
| `version.go` | `//go:embed wails.json` for version; `//go:embed docs/CHANGELOG.md` for changelog |

### Go (internal packages)

| Package | Role |
|---|---|
| `internal/db/db.go` | SQLite init; `VideoRecord` type; all DB CRUD helpers (`UpsertFilepath`, `SavePosition`, `GetRecents`, etc.); `HashVideoFile` |
| `internal/storage/storage.go` | `AppDataDir()`, `ProfileDataDir()` — platform-specific data paths; `RecentEntry` type |
| `internal/config/config.go` | CLI flag values (`Profile *string`) shared across packages |
| `internal/thumbs/` | Seek thumbnail generation (spritesheet + VTT) |

### Frontend

| File | Role |
|---|---|
| `frontend/src/App.jsx` | Root component — all global state, effects, keyboard shortcuts, tab logic |
| `frontend/src/style.css` | All CSS (single file) |
| `frontend/src/debug.js` | Global debug log store (`useSyncExternalStore`); `debugLog()` and `getDebugLogs()` callable from anywhere |
| `frontend/src/components/TabBar.jsx` | Tab bar, hamburger menu, profile flyout submenu, drag-reorder, tear-off detection |
| `frontend/src/components/HomeScreen.jsx` | Home screen with inline SVG logo, profile badge, drag-over overlay |
| `frontend/src/components/PassionPlayerWrapper.jsx` | Thin React wrapper around `PassionPlayer.js`; ref-based callbacks to avoid stale closures on tab switch |
| `frontend/src/passion_player/PassionPlayer.js` | **Pure-JS, no JSX** video player — Shadow DOM, self-contained CSS. Headless mode (no `<video>`) used with mpv; HTML5 mode available for standalone use |
| `frontend/src/components/ManageProfilesPage.jsx` | Profile list with drag-reorder, inline rename, color picker, open/delete; page-level delete modal |
| `frontend/src/components/PreferencesPage.jsx` | Settings form (seek thumbnails, single-instance, click-to-toggle, etc.) |
| `frontend/src/components/PlaylistPage.jsx` | Playlist manager with drag-reorder, random, play/remove |
| `frontend/src/components/RecentFilesOverlay.jsx` | Modal overlay showing recent files; opened with `Ctrl+R` |
| `frontend/src/components/Notification.jsx` | Transient in-player notification banner |
| `frontend/src/components/DebugPage.jsx` | Live log viewer |
| `frontend/src/components/ChangelogPage.jsx` | Renders embedded CHANGELOG.md |
| `frontend/wailsjs/go/main/App.js` | **Auto-generated** JS bindings — do not hand-edit unless `wails dev` isn't running |
| `frontend/wailsjs/go/main/App.d.ts` | **Auto-generated** TypeScript types |
| `frontend/wailsjs/go/models.ts` | **Auto-generated** model classes |

### Data / config

| Path | Contents |
|---|---|
| `wails.json` | App name, version (source of truth) |
| `docs/CHANGELOG.md` | User-facing changelog, embedded into the binary |
| `%APPDATA%\LucidMediaPlayer\profiles.json` | Global profile registry — ordered `[{id, name, color}]` |
| `%APPDATA%\LucidMediaPlayer\profiles\<id>\db.sqlite` | Per-profile SQLite database |
| `%APPDATA%\LucidMediaPlayer\profiles\<id>\settings.json` | Per-profile preferences |
| `%APPDATA%\LucidMediaPlayer\media\<hash>\` | Seek thumbnail spritesheet + VTT (global, not profile-specific) |

---

## Tab model

Tabs are frontend-only state in `App.jsx`:

```js
// { id: string, type: 'video'|'playlist'|'debug'|'changelog'|'preferences'|'manageprofiles', title: string }
const [tabs, setTabs] = useState([]);
```

- **Video tabs** have a matching entry in Go's `app.tabs` map (keyed by the same `id`). All Go methods (`SwitchTab`, `CloseTab`, etc.) operate on this id.
- **Playlist tabs** are frontend-managed; they may own a video tab (`videoTabId`) for the currently playing item.
- **Page tabs** (`debug`, `changelog`, `preferences`, `manageprofiles`) are frontend-only — Go doesn't know about them. When a page tab is active, the frontend calls `SwitchTab('')` to hide all mpv windows.
- Page tabs are singletons — opening one that already exists focuses it.

---

## Exported Go methods

### app.go

| Method | Purpose |
|---|---|
| `OpenVideo(path) → tabID` | Launches mpv, connects IPC, positions child window, upserts filepath in DB, starts background hash |
| `OpenPlaylistVideo(path) → tabID` | Like `OpenVideo` but keeps previous video tab running |
| `LoadFile(tabID, path)` | Replaces the file playing in an existing tab (for playlists) |
| `SwitchTab(tabID)` | Hides all child windows, shows the requested one; `""` = home screen |
| `CloseTab(tabID)` | Saves position to DB, sends IPC quit, closes conn, kills process |
| `TearOffTab(tabID)` | Saves position, closes tab, spawns new instance with same file via `launchVisible` |
| `TogglePlayback(tabID)` | Sends `cycle pause` via IPC |
| `Seek(tabID, pos)` | Absolute seek; `pos` is 0–1 fraction of duration |
| `GetPlaybackInfo(tabID) → PlaybackInfo` | Returns `{time_pos, duration, paused, volume}` from live IPC state |
| `GetAllTabsState() → map[id]bool` | Returns `isPlaying` for all tabs |
| `SetVolume(tabID, volume)` | Sets mpv volume (0–100) |
| `SetPlaybackSpeed(tabID, speed)` | Sets mpv playback speed |
| `SetVideoFilter(tabID, vfStr)` | Applies mpv video filter string |
| `FrameStep(tabID, direction)` | Single-frame step (+1 / -1) |
| `ToggleFullscreen()` | Wails fullscreen + emits `fullscreen-changed` event + calls `ResizeVideo()` |
| `ResizeVideo()` | `MoveWindow` on active child window to correct size/offset |
| `OpenFilePicker() → path` | Native single-file open dialog |
| `OpenFilePickerMultiple() → []path` | Native multi-file open dialog |
| `OpenFolderPicker() → path` | Native folder picker |
| `GetMediaFilesInFolder(path) → []path` | Lists media files in a directory |
| `GetVersion() → string` | From embedded `wails.json` |
| `GetChangelog() → string` | From embedded `docs/CHANGELOG.md` |
| `GetRecentFiles() → []RecentEntry` | Up to 10 entries from DB ordered by `last_opened DESC` |
| `ClearRecentFiles()` | Sets `last_opened=NULL` for all rows |
| `GetAppDataDir() → string` | Returns resolved AppData path (diagnostics) |
| `GetPreferences() → Preferences` | Reads `settings.json` for current profile |
| `SavePreferences(p)` | Writes `settings.json` for current profile |
| `StartSeekThumbnailGeneration(tabID)` | Triggers background thumbnail generation for the video |
| `RegenerateSeekThumbnails(tabID)` | Forces regeneration even if spritesheet exists |
| `GetSeekThumbnailData(tabID) → SeekThumbnailData` | Returns base64 spritesheet + VTT for the frontend |
| `GetSubtitleState(tabID) → SubtitleState` | Returns available tracks + active SID |
| `SetSubtitleTrack(tabID, sid)` | Switches subtitle track |
| `AddSubtitleFile(tabID, path)` | Loads an external subtitle file |
| `OpenSubtitleFilePicker() → path` | Native subtitle file picker |

### app_profiles.go

| Method | Purpose |
|---|---|
| `GetProfileInfo() → ProfileInfo` | Returns `{id, name, color}` for the active profile |
| `GetProfiles() → []ProfileEntry` | Full profile list from `profiles.json` |
| `CreateProfile(name, color) → ProfileEntry` | Adds new profile; ID = sanitized name |
| `RenameProfile(id, newName)` | Updates `name` in registry (ID/folder unchanged) |
| `SetProfileColor(id, color)` | Updates `color` in registry |
| `DeleteProfile(id)` | Removes from registry; cannot delete active profile; data folder left on disk |
| `ReorderProfiles(ids)` | Reorders registry to match supplied ID slice |
| `OpenProfile(id)` | Spawns new instance with `-profile <id>` via `launchVisible` |

---

## Profile system

- **Global registry**: `%APPDATA%\LucidMediaPlayer\profiles.json` — ordered `[{id, name, color}]`. Read/written by `profiles.go`.
- **Per-profile data**: `profiles/<id>/db.sqlite` + `settings.json` — determined by `internal/storage.ProfileDataDir()` using `*config.Profile`.
- **Profile ID**: sanitized display name at creation time (strips `<>:"/\|?*`, handles collisions). **Never changes on rename** — folder name is always the original ID.
- **CLI flags**: `-profile <id>` (default `"default"`); `-tearoff` (internal — skips single-instance check when spawning from a tab tear-off).
- **Multi-instance**: single-instance pipes are scoped to profile (`\\.\pipe\LucidMediaPlayer-<profileID>`), so multiple profiles can run simultaneously.
- **Tear-off**: dragging a video tab below y=80px calls `TearOffTab` → saves position → closes tab → `launchVisible(path, -profile, id, -tearoff)`. Position restores automatically via the DB hash/filepath lookup.

---

## Database (internal/db/db.go)

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

### File hashing

`HashVideoFile(path)` reads **3×64 KB chunks** (start, middle, end) and returns a SHA-256 hex string. Sub-millisecond for typical files; same hash regardless of filename, so data survives renames and moves.

### Open-video DB flow

1. `UpsertFilepath(path, now)` — immediate; updates recents, returns existing record if any.
2. If record has a `hash`: restore `last_pos` via `restorePosition` (600ms delayed IPC seek).
3. If no hash: background `hashAndLookup` goroutine → merge records on hash match, or write hash onto filepath row.

### Position save triggers

- **On pause** (IPC `property-change pause=true`): async `SavePosition` from `startReader`.
- **On tab close / tear-off**: synchronous `SavePosition` before IPC quit.
- **On shutdown**: synchronous `SavePosition` for all open tabs.

---

## PassionPlayer (frontend/src/passion_player/PassionPlayer.js)

Pure-JS, no JSX. Uses Shadow DOM with inlined CSS (`getStyles()`) — fully self-contained, safe to symlink into non-React projects.

- **HTML5 mode**: pass `src` option → real `<video>` inside Shadow DOM.
- **Headless mode** (used in Wails): no `<video>`; UI driven by `player.setState({currentTime, duration, paused})` and fires `onPlay`/`onPause`/`onSeek`/`onFullscreen` callbacks.
- Shadow root persists across `destroy()` (React Strict Mode safe): `this.shadow = el.shadowRoot ?? el.attachShadow({mode:'open'}); this.shadow.innerHTML = '';`

`PassionPlayerWrapper.jsx` uses **ref-based callbacks** (`onTogglePlaybackRef.current = onTogglePlayback`) so the long-lived player instance always calls the current tab's handlers after tab switches. Mount-once `useEffect` creates the player; a `[info]` effect calls `setState`.

---

## Critical constants and invariants

### `tabBarHeight = 36` (app.go)

Must match `.tab-bar { height: 36px }` in CSS. Used in `positionChildWindow` to offset the mpv child window below the tab bar. **If you change the CSS height, update the Go constant too.**

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

After `TogglePlayback`, the frontend immediately schedules a 50ms re-poll of `GetPlaybackInfo` + `GetAllTabsState` to update the button icon and tab indicator without waiting for the next 500ms / 1000ms poll cycle.

### Window resize debounce

The `window.resize` listener uses a **200ms debounce** before calling `ResizeVideo()`. A shorter debounce causes mpv's renderer to restart on every resize event, creating severe glitching. During active drag the video may briefly cover the tab bar (mpv auto-resizes); the correct position is restored when the debounce fires.

### AppData folder name is PascalCase

The AppData directory is `LucidMediaPlayer` (no spaces). The window title is `"Lucid Media Player"` (with spaces). Do not confuse the two — the folder name must not have spaces.

---

## Debug logging

```js
import { debugLog } from '../debug';
debugLog('MyComponent', 'something happened');

// Go backend
a.emitDebug("source", "message")  // → emits 'debug-log' event → JS EventsOn → debugLog()
```

View logs in the **Debug** page tab (hamburger → Debug). `Ctrl+Shift+C` copies all entries to clipboard.

---

## IPC: mpv named pipe

Each video tab gets `\\.\pipe\mpvsocket-<tabID>`. Newline-delimited JSON. The reader goroutine (`startReader`) updates `tab.timePos`, `tab.duration`, `tab.paused` under `stateMu` and fires `SavePosition` asynchronously when `pause=true` is received. Observed properties: `time-pos` (id 1), `duration` (id 2), `pause` (id 3).

---

## Longevity concerns

| Component | Risk | Notes |
|---|---|---|
| **mpv IPC protocol** | Low | JSON IPC format stable since ~2014; no breaking changes in a decade |
| **mpv HWND embedding** (`--wid`) | Medium–High | Win32-specific; does not work on Wayland at all; X11 XEmbed is legacy and GTK4 dropped it. The proper fix is **libmpv + render API**, but that requires CGO and a bundled `.dll`/`.so`, and integrating a GL render surface with WebView2 is a near-rewrite of the UI stack |
| **Wails v2** | Medium | Wails v2→v3 had significant breaking changes (new runtime API, different window model). Upgrading would touch `main.go`, `app.go`, all `runtime.*` calls, and the JS bindings |
| **`go-winio`** | Low | Stable, Microsoft-maintained; named pipes are a Win32 primitive unlikely to change |
| **`modernc.org/sqlite`** | Low | Pure-Go SQLite; tracks upstream SQLite releases; no CGO |
| **React + plain CSS** | Very low | CSS is a W3C standard; React is dominant and stable. The most durable layer in the stack |
| **WebView2 (Windows)** | Low | Evergreen, auto-updated with Edge; Microsoft has strong backward-compat guarantees |
| **WebKit2GTK (Linux)** | Low–Medium | Wails uses it on Linux; version requirements can drift with distros |

**mpv vs. libmpv:** The current subprocess approach works indefinitely on Windows. For true cross-platform (especially Wayland), the right path is `libmpv` with its render API — mpv renders frames into a GL context you provide, with no OS window embedding needed. Go binding: `github.com/gen2brain/go-mpv`. Tradeoffs: requires CGO (breaks pure-Go build), requires bundling `libmpv.dll`/`.so` (~30MB), and feeding frames from a GL context into WebView2 is non-trivial. A proper libmpv integration would likely mean replacing WebView2 with a native GL window and a different UI toolkit.

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
| `Ctrl+R` | Open Recent Files overlay |
| `Ctrl+Shift+C` | Copy all debug log entries to clipboard |
| Middle-click tab | Close tab |
| Drag tab below y=80px | Tear off video tab to new window |
