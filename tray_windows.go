//go:build windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"unsafe"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var (
	modShell32       = syscall.NewLazyDLL("shell32.dll")
	shellNotifyIconW = modShell32.NewProc("Shell_NotifyIconW")
	extractIconExW   = modShell32.NewProc("ExtractIconExW")

	createPopupMenuProc = modUser32.NewProc("CreatePopupMenu")
	appendMenuWProc     = modUser32.NewProc("AppendMenuW")
	trackPopupMenuProc  = modUser32.NewProc("TrackPopupMenu")
	destroyMenuProc     = modUser32.NewProc("DestroyMenu")
	getCursorPosProc    = modUser32.NewProc("GetCursorPos")
)

const (
	nimAdd    = uintptr(0)
	nimModify = uintptr(1)
	nimDelete = uintptr(2)

	nifMessage = uint32(0x00000001)
	nifIcon    = uint32(0x00000002)
	nifTip     = uint32(0x00000004)

	tpmRightButton = uintptr(0x0002)
	tpmReturnCmd   = uintptr(0x0100)
	tpmRightAlign  = uintptr(0x0008)

	mfString    = uintptr(0x00000000)
	mfSeparator = uintptr(0x00000800)

	menuItemOpen  = uintptr(101)
	menuItemClose = uintptr(100)

	wmLButtonUp = uintptr(0x0202)
	wmRButtonUp = uintptr(0x0205)
)

// notifyIconData mirrors NOTIFYICONDATAW (Vista+ size, x64 layout).
// Go inserts the same implicit padding as MSVC, so the layout matches exactly.
type notifyIconData struct {
	cbSize           uint32
	hWnd             uintptr
	uID              uint32
	uFlags           uint32
	uCallbackMessage uint32
	hIcon            uintptr
	szTip            [128]uint16
	dwState          uint32
	dwStateMask      uint32
	szInfo           [256]uint16
	uVersion         uint32
	szInfoTitle      [64]uint16
	dwInfoFlags      uint32
	guidItem         [16]byte
	hBalloonIcon     uintptr
}

func loadTrayIcon(exePath string) uintptr {
	exePtr, err := syscall.UTF16PtrFromString(exePath)
	if err != nil {
		return 0
	}
	var hLarge, hSmall uintptr
	extractIconExW.Call(
		uintptr(unsafe.Pointer(exePtr)),
		0,
		uintptr(unsafe.Pointer(&hLarge)),
		uintptr(unsafe.Pointer(&hSmall)),
		1,
	)
	if hLarge != 0 {
		return hLarge
	}
	return hSmall
}

func buildTrayTooltip(a *App) string {
	profile := a.GetProfileInfo()

	a.tabsMu.RLock()
	count := len(a.tabs)
	var activeFile string
	if a.activeTabID != "" {
		if tab, ok := a.tabs[a.activeTabID]; ok {
			activeFile = filepath.Base(tab.filePath)
		}
	}
	a.tabsMu.RUnlock()

	var tip string
	if profile.ID == "default" {
		tip = "LMP"
	} else {
		tip = "LMP (" + profile.Name + ")"
	}

	if count == 1 {
		tip += " - 1 tab open"
	} else {
		tip += fmt.Sprintf(" - %d tabs open", count)
	}

	if activeFile != "" {
		tip += " - " + activeFile
	}
	return tip
}

func initTray(a *App) error {
	if a.parentHWND == 0 {
		return fmt.Errorf("parentHWND not set")
	}
	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("os.Executable: %w", err)
	}
	hIcon := loadTrayIcon(exePath)
	a.trayHIcon = hIcon

	tip := buildTrayTooltip(a)
	tipW, _ := syscall.UTF16FromString(tip)
	if len(tipW) > 128 {
		tipW = tipW[:128]
		tipW[127] = 0
	}

	var nid notifyIconData
	nid.cbSize = uint32(unsafe.Sizeof(nid))
	nid.hWnd = a.parentHWND
	nid.uID = 1
	nid.uFlags = nifMessage | nifIcon | nifTip
	nid.uCallbackMessage = uint32(wmTrayIcon)
	nid.hIcon = hIcon
	copy(nid.szTip[:], tipW)

	ret, _, _ := shellNotifyIconW.Call(nimAdd, uintptr(unsafe.Pointer(&nid)))
	if ret == 0 {
		return fmt.Errorf("Shell_NotifyIconW NIM_ADD failed")
	}
	return nil
}

func destroyTray(a *App) {
	if a.parentHWND == 0 {
		return
	}
	var nid notifyIconData
	nid.cbSize = uint32(unsafe.Sizeof(nid))
	nid.hWnd = a.parentHWND
	nid.uID = 1
	shellNotifyIconW.Call(nimDelete, uintptr(unsafe.Pointer(&nid)))
}

func updateTrayTooltip(a *App) {
	if a.parentHWND == 0 {
		return
	}
	tip := buildTrayTooltip(a)
	tipW, _ := syscall.UTF16FromString(tip)
	if len(tipW) > 128 {
		tipW = tipW[:128]
		tipW[127] = 0
	}

	var nid notifyIconData
	nid.cbSize = uint32(unsafe.Sizeof(nid))
	nid.hWnd = a.parentHWND
	nid.uID = 1
	nid.uFlags = nifTip
	copy(nid.szTip[:], tipW)

	shellNotifyIconW.Call(nimModify, uintptr(unsafe.Pointer(&nid)))
}

func showTrayContextMenu(a *App) {
	hMenu, _, _ := createPopupMenuProc.Call()
	if hMenu == 0 {
		return
	}
	defer destroyMenuProc.Call(hMenu)

	openPtr, _ := syscall.UTF16PtrFromString("Open Instance")
	appendMenuWProc.Call(hMenu, mfString, menuItemOpen, uintptr(unsafe.Pointer(openPtr)))
	appendMenuWProc.Call(hMenu, mfSeparator, 0, 0)
	closePtr, _ := syscall.UTF16PtrFromString("Close")
	appendMenuWProc.Call(hMenu, mfString, menuItemClose, uintptr(unsafe.Pointer(closePtr)))

	var pt struct{ X, Y int32 }
	getCursorPosProc.Call(uintptr(unsafe.Pointer(&pt)))

	cmd, _, _ := trackPopupMenuProc.Call(
		hMenu,
		tpmRightButton|tpmReturnCmd|tpmRightAlign,
		uintptr(pt.X),
		uintptr(pt.Y),
		0,
		a.parentHWND,
		0,
	)
	// WM_NULL prevents the "phantom menu" bug on second right-click
	postMessageProc.Call(a.parentHWND, 0, 0, 0)

	switch cmd {
	case menuItemOpen:
		bringToFront(a)
	case menuItemClose:
		runtime.Quit(a.ctx)
	}
}

func handleTrayMessage(a *App, lParam uintptr) {
	switch lParam & 0xFFFF {
	case wmLButtonUp:
		bringToFront(a)
	case wmRButtonUp:
		showTrayContextMenu(a)
	}
}
