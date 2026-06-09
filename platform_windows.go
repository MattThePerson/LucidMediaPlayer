//go:build windows

package main

import (
	"fmt"
	"net"
	"os/exec"
	"syscall"
	"time"
	"unsafe"

	"github.com/Microsoft/go-winio"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var (
	modUser32           = syscall.NewLazyDLL("user32.dll")
	findWindowW         = modUser32.NewProc("FindWindowW")
	showWindowProc      = modUser32.NewProc("ShowWindow")
	getWindowProc       = modUser32.NewProc("GetWindow")
	getClientRectProc   = modUser32.NewProc("GetClientRect")
	moveWindowProc      = modUser32.NewProc("MoveWindow")
	getWindowLongProc   = modUser32.NewProc("GetWindowLongW")
	setWindowLongProc   = modUser32.NewProc("SetWindowLongW")
	setWindowPosProc    = modUser32.NewProc("SetWindowPos")
	getWindowRectProc   = modUser32.NewProc("GetWindowRect")
	monitorFromWinProc  = modUser32.NewProc("MonitorFromWindow")
	getMonitorInfoProc  = modUser32.NewProc("GetMonitorInfoW")
	setWindowLongPtrProc = modUser32.NewProc("SetWindowLongPtrW")
	callWindowProcProc  = modUser32.NewProc("CallWindowProcW")
	setForegroundProc   = modUser32.NewProc("SetForegroundWindow")
)

const (
	swHide     = uintptr(0)
	swShow     = uintptr(8) // SW_SHOWNA — show without activating
	gwChild    = uintptr(5)
	gwHwndNext = uintptr(2)

	gwlStyle           = uintptr(0xFFFFFFF0) // GWL_STYLE = -16 as uint
	wsOverlappedWindow = uint32(0x00CF0000)
	swpFrameChanged    = uintptr(0x0020)
	swpNozorder        = uintptr(0x0004)
	swpNomove          = uintptr(0x0002)
	swpNosize          = uintptr(0x0001)
	hwndTop            = uintptr(0)
	hwndBottom         = uintptr(1)
	wsMaximize         = uint32(0x01000000) // WS_MAXIMIZE
	swShowMaximized    = uintptr(3)         // SW_SHOWMAXIMIZED
	monitorDefaultToNearest = uintptr(2)

	gwlpWndProc  = uintptr(0xFFFFFFFC) // GWLP_WNDPROC = -4
	wmSysCommand = uintptr(0x0112)
	scKeyMenu    = uintptr(0xF100)
)

type monitorInfo struct {
	cbSize    uint32
	rcMonitor windowRect
	rcWork    windowRect
	dwFlags   uint32
}

var (
	origWndProc     uintptr
	wndProcCallback uintptr
)

func wndProcSubclass(hwnd, msg, wParam, lParam uintptr) uintptr {
	if msg == wmSysCommand && (wParam&0xFFF0) == scKeyMenu {
		return 0
	}
	ret, _, _ := callWindowProcProc.Call(origWndProc, hwnd, msg, wParam, lParam)
	return ret
}

// ipcPath returns the Windows named pipe path for a tab's mpv IPC socket.
func ipcPath(tabID string) string {
	return fmt.Sprintf(`\\.\pipe\mpvsocket-%s`, tabID)
}

// connectMPV connects to the mpv named pipe, retrying until timeout.
func connectMPV(path string, timeout time.Duration) (net.Conn, error) {
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

// mpvWindowArgs returns the mpv arguments for window embedding and IPC.
func mpvWindowArgs(parentHWND uintptr, ipcSocketPath string) []string {
	return []string{
		fmt.Sprintf("--wid=%d", parentHWND),
		fmt.Sprintf("--input-ipc-server=%s", ipcSocketPath),
	}
}

// hideSubprocess hides the console window for a subprocess.
func hideSubprocess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}

// initPlatform finds the Wails parent HWND and subclasses its window procedure.
// Returns the parent HWND on success.
func initPlatform(a *App) (uintptr, error) {
	titlePtr, err := syscall.UTF16PtrFromString("Lucid Player")
	if err != nil {
		return 0, err
	}
	ret, _, callErr := findWindowW.Call(0, uintptr(unsafe.Pointer(titlePtr)))
	if ret == 0 {
		return 0, fmt.Errorf("FindWindowW: %w", callErr)
	}
	hwnd := ret

	wndProcCallback = syscall.NewCallback(wndProcSubclass)
	origWndProc, _, _ = setWindowLongPtrProc.Call(hwnd, gwlpWndProc, wndProcCallback)

	return hwnd, nil
}

// getChildren returns all direct child HWNDs of parent.
func getChildren(parent uintptr) []uintptr {
	var children []uintptr
	child, _, _ := getWindowProc.Call(parent, gwChild)
	for child != 0 {
		children = append(children, child)
		child, _, _ = getWindowProc.Call(child, gwHwndNext)
	}
	return children
}

// waitForChild polls until a new child HWND appears under parent (not in before),
// or until timeout elapses.
func waitForChild(parent uintptr, before []uintptr, timeout time.Duration) uintptr {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		for _, h := range getChildren(parent) {
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

// prepareChild positions, hides, and pushes a new mpv child window to the bottom
// of the z-order so WebView2 stays on top.
func prepareChild(a *App, child uintptr) {
	repositionChild(a, child)
	hideChild(child)
	setWindowPosProc.Call(child, hwndBottom, 0, 0, 0, 0, swpNosize|swpNomove)
}

// showChild makes a child window visible without activating it.
func showChild(child uintptr) {
	showWindowProc.Call(child, swShow)
}

// hideChild hides a child window.
func hideChild(child uintptr) {
	showWindowProc.Call(child, swHide)
}

// repositionChild sizes and places child so it fills the parent client area
// below the tab bar (or the whole area when fullscreen).
func repositionChild(a *App, child uintptr) {
	var r windowRect
	getClientRectProc.Call(a.parentHWND, uintptr(unsafe.Pointer(&r)))
	w := uintptr(r.Right - r.Left)
	h := uintptr(r.Bottom - r.Top)
	yOff := uintptr(0)
	if !a.isFullscreen {
		yOff = uintptr(tabBarHeight)
	}
	moveWindowProc.Call(child, 0, yOff, w, h-yOff, 1)
}

// bringToFront restores and focuses the parent window.
func bringToFront(a *App) {
	if a.parentHWND == 0 {
		return
	}
	showWindowProc.Call(a.parentHWND, uintptr(9)) // SW_RESTORE
	setForegroundProc.Call(a.parentHWND)
}

// platformToggleFullscreen toggles borderless fullscreen on Windows.
func platformToggleFullscreen(a *App) {
	if a.isFullscreen {
		setWindowLongProc.Call(a.parentHWND, gwlStyle, uintptr(a.savedWindowStyle))
		if a.savedWindowStyle&wsMaximize != 0 {
			// Window was maximized before fullscreen. GetWindowRect on a maximized
			// window captures coords that include invisible frame borders and can
			// extend to the full monitor height (past the taskbar). Using those
			// coords with SetWindowPos would leave the window covering the taskbar.
			// ShowWindow(SW_SHOWMAXIMIZED) lets Windows recalculate the correct
			// maximized rect for the work area (taskbar excluded).
			showWindowProc.Call(a.parentHWND, swShowMaximized)
		} else {
			setWindowPosProc.Call(a.parentHWND, hwndTop,
				uintptr(uint32(a.savedWindowRect.Left)),
				uintptr(uint32(a.savedWindowRect.Top)),
				uintptr(uint32(a.savedWindowRect.Right-a.savedWindowRect.Left)),
				uintptr(uint32(a.savedWindowRect.Bottom-a.savedWindowRect.Top)),
				swpFrameChanged|swpNozorder,
			)
		}
		a.isFullscreen = false
		runtime.EventsEmit(a.ctx, "fullscreen-changed", false)
	} else {
		style, _, _ := getWindowLongProc.Call(a.parentHWND, gwlStyle)
		a.savedWindowStyle = uint32(style)
		getWindowRectProc.Call(a.parentHWND, uintptr(unsafe.Pointer(&a.savedWindowRect)))

		hMon, _, _ := monitorFromWinProc.Call(a.parentHWND, monitorDefaultToNearest)
		var mi monitorInfo
		mi.cbSize = uint32(unsafe.Sizeof(mi))
		getMonitorInfoProc.Call(hMon, uintptr(unsafe.Pointer(&mi)))

		setWindowLongProc.Call(a.parentHWND, gwlStyle, uintptr(a.savedWindowStyle&^wsOverlappedWindow))
		setWindowPosProc.Call(a.parentHWND, hwndTop,
			uintptr(uint32(mi.rcMonitor.Left)),
			uintptr(uint32(mi.rcMonitor.Top)),
			uintptr(uint32(mi.rcMonitor.Right-mi.rcMonitor.Left)),
			uintptr(uint32(mi.rcMonitor.Bottom-mi.rcMonitor.Top)),
			swpFrameChanged|swpNozorder,
		)
		a.isFullscreen = true
		runtime.EventsEmit(a.ctx, "fullscreen-changed", true)
	}
	time.AfterFunc(50*time.Millisecond, a.ResizeVideo)
}

// platformResizeVideo repositions the active mpv window after a resize event.
func platformResizeVideo(a *App) {
	a.tabsMu.RLock()
	tab, ok := a.tabs[a.activeTabID]
	a.tabsMu.RUnlock()
	if !ok || tab.childHWND == 0 {
		return
	}
	repositionChild(a, tab.childHWND)
}
