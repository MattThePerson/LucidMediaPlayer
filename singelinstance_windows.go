//go:build windows

package main

import (
	"bufio"
	"strings"
	"time"

	"github.com/Microsoft/go-winio"
)

const instancePipeName = `\\.\pipe\LucidMediaPlayer-instance`

// trySendToExistingInstance dials the instance pipe and sends filePath.
// Returns true if an existing instance received it (caller should exit).
func trySendToExistingInstance(filePath string) bool {
	timeout := 500 * time.Millisecond
	conn, err := winio.DialPipe(instancePipeName, &timeout)
	if err != nil {
		return false
	}
	defer conn.Close()
	_, err = conn.Write([]byte(filePath + "\n"))
	return err == nil
}

// startInstanceServer listens for file paths sent by secondary instances.
// onFile is called in a goroutine for each received path.
// If the pipe name is already owned by another instance, this is a no-op.
func startInstanceServer(onFile func(string)) {
	l, err := winio.ListenPipe(instancePipeName, nil)
	if err != nil {
		// Another instance already owns the pipe — we're secondary, ignore.
		return
	}
	go func() {
		defer l.Close()
		for {
			conn, err := l.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				scanner := bufio.NewScanner(conn)
				if scanner.Scan() {
					path := strings.TrimSpace(scanner.Text())
					if path != "" {
						onFile(path)
					}
				}
			}()
		}
	}()
}
