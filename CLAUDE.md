# CLAUDE.md

## Responsibilities

### Versioning and changelog

- **Auto-bump PATCH** — after every set of changes, bump the patch version in `wails.json` and print the new version at the end of the response.
- **Auto-update CHANGELOG** — add a new `## [x.y.z] — YYYY-MM-DD` entry to `docs/CHANGELOG.md` describing what changed. Keep entries concise (one line per item).
- **"NOT bump patch"** — if the user explicitly says not to bump, leave `wails.json` unchanged and amend the current version's CHANGELOG entry instead.
- **MINOR/MAJOR** — bump only when the user explicitly requests it.

---

## Project overview

**AwesomeVideoPlayer** — a desktop video player built with [Wails v2](https://wails.io/) (Go backend + React/JSX frontend). Video playback uses **mpv** as a subprocess whose window is embedded into the Wails parent window via Win32 HWND (`--wid`). The UI (tabs, controls, overlays) is rendered by WebView2 on top.

### Tech stack

| Layer | Technology |
|---|---|
| Framework | Wails v2 (Go 1.21+) |
| Frontend | React 18, JSX, plain CSS (no Tailwind) |
| Bundler | Vite (managed by Wails) |
| Video backend | mpv subprocess, Win32 HWND embedding |
| IPC to mpv | Named pipe (`\\.\pipe\mpvsocket-<tabID>`) via `go-winio` |
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
│   ├── TabBar          36px, opaque dark background
│   ├── HomeScreen      shown when no tab is active
│   ├── VideoControls   overlay on the active video tab
│   ├── DebugPage       page tab
│   └── ChangelogPage   page tab
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
| `app.go` | All exported Go methods; Win32 helpers; mpv subprocess management. **Windows-only** (`//go:build windows`) |
| `storage.go` | Platform-specific AppData dir; `RecentEntry` type; load/save/push recent files. **No build constraint** (cross-platform) |
| `version.go` | `//go:embed wails.json` for version; `//go:embed docs/CHANGELOG.md` for changelog content |

### Frontend

| File | Role |
|---|---|
| `frontend/src/App.jsx` | Root component — all global state, effects, keyboard shortcuts, tab logic |
| `frontend/src/style.css` | All CSS (single file) |
| `frontend/src/debug.js` | Global debug log store (`useSyncExternalStore`); `debugLog()` callable from anywhere |
| `frontend/src/components/TabBar.jsx` | Tab bar, hamburger menu, Recently Opened submenu, drag-reorder |
| `frontend/src/components/HomeScreen.jsx` | Home screen with inline SVG logo, version link, drag-over overlay |
| `frontend/src/components/VideoControls.jsx` | Play/pause button, progress bar, time display — overlaid on active video |
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
| `%APPDATA%\AwesomeVideoPlayer\data\recent.json` | Recently opened files (max 20) |
| `%APPDATA%\AwesomeVideoPlayer\config\` | Future: `preferences.json`, `keybinds.json` |
| `%APPDATA%\AwesomeVideoPlayer\data\media\` | Future: seek thumbnails, audio waveforms, timeline data |

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
| `OpenVideo(path) → tabID` | Launches mpv, connects IPC, pre-positions child window, records recent |
| `SwitchTab(tabID)` | Hides all child windows, shows the requested one; `""` = home screen |
| `CloseTab(tabID)` | Sends IPC quit, closes conn, kills process |
| `TogglePlayback(tabID)` | Sends `cycle pause` via IPC |
| `Seek(tabID, pos)` | Absolute seek; `pos` is 0–1 fraction of duration |
| `GetPlaybackInfo(tabID) → PlaybackInfo` | Returns `{time_pos, duration, paused}` from live IPC state |
| `GetAllTabsState() → map[id]bool` | Returns `isPlaying` for all tabs (for tab indicators) |
| `ToggleFullscreen()` | Wails fullscreen + emits `fullscreen-changed` event + calls `ResizeVideo()` |
| `ResizeVideo()` | `MoveWindow` on active child window to correct size/offset |
| `OpenFilePicker() → path` | Native file open dialog |
| `GetVersion() → string` | From embedded `wails.json` |
| `GetChangelog() → string` | From embedded `docs/CHANGELOG.md` |
| `GetRecentFiles() → []RecentEntry` | Up to 10 entries from `data/recent.json` |
| `ClearRecentFiles()` | Wipes `data/recent.json` |
| `GetAppDataDir() → string` | Returns resolved AppData path (useful for diagnostics) |

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

---

## Debug logging

```js
// Frontend — callable from any component, no prop drilling needed
import { debugLog } from '../debug';
debugLog('MyComponent', 'something happened');

// Go backend
a.emitDebug("source", "message")
// → emits 'debug-log' event → JS EventsOn handler → debugLog()
```

View logs in the **Debug** page tab (hamburger → Debug).

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

The reader goroutine (`tab.startReader()`) updates `tab.timePos`, `tab.duration`, `tab.paused` under `stateMu`.

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Space` | Toggle playback (active video tab only) |
| `F` | Toggle fullscreen |
| `Ctrl+W` | Close active tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Cycle tabs |
| `Ctrl+Shift+PageUp/Down` | Move active tab left/right |
| Middle-click tab | Close tab |
