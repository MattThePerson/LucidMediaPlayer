//go:build windows

package thumbs

import (
	"os/exec"
	"syscall"
)

func hideSubprocess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
