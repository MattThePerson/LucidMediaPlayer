# Changelog

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
