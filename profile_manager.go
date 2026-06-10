package main

import (
    "os"
    "os/exec"
    "syscall"
)

// launchVisible spawns a new visible instance of this exe with the given args.
// Unlike launchDetached, it does not set HideWindow so the new Wails window appears.
func launchVisible(args ...string) error {
    exePath, err := os.Executable()
    if err != nil {
        return err
    }
    cmd := exec.Command(exePath, args...)
    cmd.Stdin = nil
    cmd.Stdout = nil
    cmd.Stderr = nil
    return cmd.Start()
}

func launchDetached(args ...string) error {

    exePath, err := os.Executable()
    if err != nil {
        return err
    }

    cmd := exec.Command(
        exePath,
        args...,
    )
    hideSubprocess(cmd)
    cmd.Stdin = nil
    cmd.Stdout = nil
    cmd.Stderr = nil
    cmd.SysProcAttr = &syscall.SysProcAttr{
        HideWindow: true,
    }

    return cmd.Start()
}

// is perhaps unnecessary, and also currently wrong
// func applyDetachment(cmd *exec.Cmd) {
//     switch runtime.GOOS {
//     case "windows":
//         cmd.SysProcAttr = &syscall.SysProcAttr{
//             CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | syscall.DETACH_PROCESS,
//             HideWindow: true,
//         }
//     case "linux", "darwin":
//         cmd.SysProcAttr = &syscall.SysProcAttr{
//             Setpgid: true,
//         }
//     }
// }
