# Changelog

## [0.1.17] — 2026-06-08
- Add: "Open with" now works — file path passed via `os.Args[1]` is opened as a video tab on startup
- Add: "Open files in existing window" preference — when enabled, "Open with" sends the file to an already-running instance via a named pipe instead of launching a new window

## [0.1.16] — 2026-06-08
- Fix: F5 now correctly generates seek thumbnails — `StartSeekThumbnailGeneration` was being blocked by the autogenerate gate; added `manualTrigger` flag to `ensureThumbnails` to bypass pref for explicit user actions
- Fix: removed video controls overlay from home screen
- Fix: flares no longer trigger playback toggle on click (`pointer-events: auto` + `stopPropagation`)
- Fix: flares slide back up on dismiss (slide-up exit animation, managed in Notification component)
- Fix: flare dismiss timeout reduced to 2s
- Add: WorkingIndicator enlarged (18px), more visible, `pointer-events: auto` so `title` tooltip shows on hover
- Add: home screen shortcut hint text larger and clearer

## [0.1.15] — 2026-06-08
- Fix: F5 generates seek thumbnails only if not yet generated; Shift+F5 always regenerates
- Fix: flare (notification popup) properly centered using `margin: 0 auto` (was broken by transform conflict with slideDown animation)
- Fix: flares now have full-border color glow per type instead of left-border only
- Fix: WorkingIndicator is now a single-color subtle ring (was too colorful)
- Fix: "Generating..." flare auto-dismisses after 3s and has no spinner (WorkingIndicator handles background state)
- Add: WorkingIndicator has HTML title describing what's happening
- Add: Ctrl+O opens file picker (keyboard shortcut + dropdown item shows "Ctrl+O" right-aligned)
- Add: home screen shows "Ctrl+O — Open video" hint below version

## [0.1.14] — 2026-06-08
- Add: videos start playing on open; `--loop-file=inf` added to mpv (loop on by default)
- Fix: F5 on a video with existing thumbnails shows "exists — Shift+F5 to regenerate" instead of starting generation; Shift+F5 force-regenerates
- Fix: renamed video no longer shows "Press F5" prompt when thumbnails already exist (prompt delayed 1.5s, `ensureThumbnails` always emits `seek-thumbs-ready` on cache hit)
- Fix: recently-opened menu filters out files that no longer exist on disk
- Add: colorful rainbow spinning `WorkingIndicator` in video area top-right during background generation
- Add: notification popups now have type-specific accent colors (blue/amber/green/violet)
- Add: notification popup centered horizontally in video area
- Add: video controls overlay on home screen for visual testing
- Fix: `ensureThumbnails` skips duration poll on cache hits (immediate cache-hit notify)

## [0.1.13] — 2026-06-08
- Add: F5 triggers manual seek thumbnail generation (autogenerate defaults to OFF)
- Add: slide-down notification popup — "Press F5" prompt (3s), "Generating..." spinner, "Seek thumbnails ready!" (3s)
- Add: Preferences page (hamburger → Preferences) with "Autogenerate seek thumbnails" toggle
- Add: debug logging in thumbnail generation — ffmpeg path, frame count, ok/total, spritesheet KB
- Add: `StartSeekThumbnailGeneration`, `GetPreferences`, `SavePreferences` Wails methods
- Add: `seek-thumbs-generating` event emitted before generation begins; cache hits skip spinner

## [0.1.12] — 2026-06-08
- Add: seek thumbnail hover preview — ffmpeg fast-seek generates a 100-frame spritesheet cached per video hash in `%APPDATA%\LucidPlayer\media\<hash>\`
- Add: `setSeekThumbs(vtt, dataURL)` data-push API on PassionPlayer (replaces URL/fetch path); Go reads and base64-encodes files, no HTTP server needed
- Add: `GetSeekThumbnailData(tabID)` Wails method; `seek-thumbs-ready` event notifies frontend when generation completes

## [0.1.11] — 2026-06-08
- Rename: "Sunset Video Player" → "Lucid Player"; AppData dir `SunsetVideoPlayer` → `LucidPlayer`; exe output `LucidPlayer`

## [0.1.10] — 2026-06-08
- Fix: clicking progress bar no longer triggers play/pause toggle (missing stopPropagation let click bubble to player div)

## [0.1.9] — 2026-06-08
- Fix: double-toggle on click — React Strict Mode caused PassionPlayer to double-register click listeners via async init() race; `_destroyed` guard after await prevents stale init from adding DOM elements/listeners
- Fix: debug logs appearing 4x — EventsOn listeners were never cleaned up on re-render; now using returned unsubscribe functions
- Fix: window title uses regular dash instead of em-dash
- Fix: progress bar restored to bottom edge (was accidentally moved in control bar restructure)

## [0.1.8] — 2026-06-08
- Fix: unified controls bar — play button, volume, and time display now aligned in a single row at bottom-left; fullscreen button added at bottom-right
- Add: Alt+1–9 switches to tab by index
- Add: Alt+Space system menu suppressed via Win32 window proc subclass (SC_KEYMENU intercepted)
- Debug: added debug log traces for toggle playback (Go, PassionPlayerWrapper, App.jsx) to diagnose double-toggle

## [0.1.7] — 2026-06-08
- Fix: progress bar and time display now update correctly (field mapping time_pos → currentTime)
- Fix: double-toggle on click/button resolved (disabled mpv built-in bindings, HWND z-order, click handler timer cancel)
- Fix: fullscreen now uses custom Win32 toggle — window chrome (title bar, buttons) reliably restored on exit
- Add: volume slider in player controls (IPC-based mpv volume)
- Add: Ctrl+Shift+T reopens last closed tab
- Add: Escape exits fullscreen
- Add: S key toggles playback; Arrow/A/D keys jump ±7s; Shift+A/D jump ±2s
- Add: app version shown next to Changelog in hamburger menu
- Add: Quit option in hamburger menu
- Add: dragging a tab activates it on drop; drag ghost stays within tab bar

## [0.1.6] — 2026-06-08
- SQLite database at `%APPDATA%\LucidPlayer\db.sqlite` (modernc.org/sqlite, no CGO)
- Fix AppData folder name: `"Sunset Video Player"` (spaces) → `"LucidPlayer"` (PascalCase)
- Save/restore playback position: saves on pause, tab close, and shutdown; restores on re-open
- Hash-based video identity: 3×64 KB SHA-256 so data survives file renames/moves
- Recents now stored in DB (last_opened column) instead of `recent.json`

## [0.1.5] — 2026-06-08
- Fix PassionPlayer styles not loading: reuse existing shadow root instead of calling attachShadow twice (React Strict Mode double-mount)

## [0.1.4] — 2026-06-08
- Move PassionPlayer.js back to src/passion_player/ — static import, no Vite/Rollup workarounds needed
- Inline all CSS into getStyles() — PassionPlayer.js is now fully self-contained (no external CSS file)

## [0.1.3] — 2026-06-08
- Fix vite build: mark /PassionPlayer.js as external in rollupOptions so Rollup doesn't try to bundle it

## [0.1.2] — 2026-06-08
- Move PassionPlayer.js to frontend/public/ — single source, no duplicate CSS; wrapper uses dynamic import('/PassionPlayer.js')

## [0.1.1] — 2026-06-08
- PassionPlayer: add play/pause button (bottom-left, ▶/⏸); updates on toggle, external setState, and native video play/pause events

## [0.1.0] — 2026-06-08
- Rename project to "Sunset Video Player"
- Window title, home screen, AppData directory, exe output all updated; folder rename pending

## [0.0.18] — 2026-06-08
- Fix black video: PassionPlayer background was opaque black, blocking mpv HWND window
- Fix second-tab controls first tab: ref-based callbacks in PassionPlayerWrapper so the long-lived PassionPlayer instance always calls the current tab's functions
- F3 opens Debug tab
- Ctrl+Shift+C copies all debug log entries to clipboard

## [0.0.17] — 2026-06-07
- Replace VideoControls with PassionPlayer (pure-JS, no jQuery, Shadow DOM)
- PassionPlayer supports headless mode: external play/pause/seek/fullscreen callbacks + `setState()` for mpv state injection
- PassionPlayer accepts `hostEl` for React ref mounting; `disable_keybinds` option for host-managed shortcuts
- PassionPlayer.css served from `frontend/public/` at `/PassionPlayer.css`

## [0.0.16] — 2026-06-07
- Increase resize debounce from 16ms to 200ms to eliminate MoveWindow spam during drag

## [0.0.15] — 2026-06-07
- Fix video covered by tab bar: use MoveWindow to offset mpv child window by 36px (tab bar height)
- Position is applied on open, on tab switch, on window resize (16ms debounce), and on fullscreen toggle

## [0.0.14] — 2026-06-07
- Recently Opened is now a hover fly-out submenu (▸) instead of an inline list

## [0.0.13] — 2026-06-07
- Platform-specific AppData directory (`%APPDATA%\LucidPlayer\` on Windows; `~/.config/…` on Linux; `~/Library/…` on macOS)
- Recently opened files stored in `data/recent.json` (max 20, deduplicated, most-recent-first)
- Hamburger dropdown shows "Recent" section with last 10 files; click to reopen, "Clear" to wipe list
- `GetAppDataDir()` exposed for diagnostics (visible in debug output)

## [0.0.12] — 2026-06-07
- Fix play/pause indicator lag: re-poll GetPlaybackInfo + GetAllTabsState 50ms after toggling

## [0.0.11] — 2026-06-07
- Tab drag reorder: X-position only (document-level dragover), works when mouse leaves tab bar vertically
- Tab play indicator reserves space always (no layout shift when ▶ appears/disappears)
- Changelog scrollbar now at window edge (full-width scroll container, inner max-width wrapper)

## [0.0.10] — 2026-06-07
- Tabs now have uniform width (flex, max 200px) and shrink equally when many are open
- Remove italic styling from page tabs (Debug, Changelog)
- Drag-to-reorder tabs; drop indicator via opacity; uses HTML5 drag API with relatedTarget guard
- Ctrl+Shift+PageUp / PageDown to move the active tab left or right
- Middle-click any tab to close it

## [0.0.9] — 2026-06-07
- Logo glow: increased radii (12/40/100/200px) and reduced opacity for wider, softer spread

## [0.0.8] — 2026-06-07
- Remove static "Drop a video" hint text
- Add drag-over overlay: blurred backdrop, dashed border, arrow + "Drop to play"
- Fix logo glow: add tight inner layer (6px) to restore brightness at large radii

## [0.0.7] — 2026-06-07
- Version text default brightness raised; hover no longer changes colour, only reveals underline
- Logo glow radii tripled (8/20/40px → 24/60/120px)

## [0.0.6] — 2026-06-07
- Home screen version text is clickable and opens the Changelog tab
- Home screen logo has a soft white glow via layered `drop-shadow` filters

## [0.0.5] — 2026-06-07
- Fix drag-drop: switch from Go `runtime.OnFileDrop` to JS `OnFileDrop` (the correct Wails v2 API for WebView2 drops)
- Revert `DisableWebViewDrop` to `false` (required for JS `OnFileDrop` to receive events)
- Guard `onDomReady` against double-fire on dev hot reload
- Extract `openVideoPath` shared function used by drag-drop, file picker, and future callers

## [0.0.4] — 2026-06-07
- Fix drag-drop: set `DisableWebViewDrop: true` so Wails' `OnFileDrop` fires instead of WebView2 consuming the drop
- Fix audio persisting after tab close: send IPC `quit` command before killing the process

## [0.0.3] — 2026-06-07
- Add Debug page tab: live log viewer with auto-scroll and Clear button
- Add Changelog page tab: renders embedded CHANGELOG.md
- Global `debugLog(source, msg)` store (no prop drilling, `useSyncExternalStore`)
- Go emits `debug-log` events for startup, HWND discovery, OnFileDrop, and OpenVideo lifecycle
- Unified tab model: video, debug, and changelog tabs share one `tabs` array
- Page tabs (debug/changelog) are singletons — reopening focuses existing tab

## [0.0.2] — 2026-06-07
- Fix app icon not displaying: switched from `<img src>` asset URL to inline SVG component (avoids WebView2 loading issues)
- Fix closed tab video frame lingering: `CloseTab` now hides the child window before removing it from the map

## [0.0.1] — 2026-06-07
- Initial tab system with home screen, file drop, hamburger menu, and fullscreen support
- mpv subprocess per tab embedded via Win32 HWND; background audio while switching tabs
- Named pipe IPC for playback control and state polling
- Added `OpenFilePicker` native file dialog wired to "Open File..." menu item
- Window title updates to active filename for debugging
