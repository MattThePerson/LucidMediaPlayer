# Changelog

## [0.1.6] — 2026-06-08
- SQLite database at `%APPDATA%\SunsetVideoPlayer\db.sqlite` (modernc.org/sqlite, no CGO)
- Fix AppData folder name: `"Sunset Video Player"` (spaces) → `"SunsetVideoPlayer"` (PascalCase)
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
- Platform-specific AppData directory (`%APPDATA%\AwesomeVideoPlayer\` on Windows; `~/.config/…` on Linux; `~/Library/…` on macOS)
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
