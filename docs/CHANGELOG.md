# Changelog

## [0.0.2] — 2026-06-07
- Fix app icon not displaying: switched from `<img src>` asset URL to inline SVG component (avoids WebView2 loading issues)
- Fix closed tab video frame lingering: `CloseTab` now hides the child window before removing it from the map

## [0.0.1] — 2026-06-07
- Initial tab system with home screen, file drop, hamburger menu, and fullscreen support
- mpv subprocess per tab embedded via Win32 HWND; background audio while switching tabs
- Named pipe IPC for playback control and state polling
- Added `OpenFilePicker` native file dialog wired to "Open File..." menu item
- Window title updates to active filename for debugging
