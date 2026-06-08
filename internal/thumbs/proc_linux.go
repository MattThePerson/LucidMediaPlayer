//go:build linux || darwin

package thumbs

import "os/exec"

func hideSubprocess(_ *exec.Cmd) {}
