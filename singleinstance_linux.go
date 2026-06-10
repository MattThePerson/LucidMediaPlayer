//go:build linux || darwin

package main

import (
	"bufio"
	"strings"
	"net"
	"os"
	// "time"

	// "github.com/Microsoft/go-winio"
)

const socketPath = "/tmp/lucidmediaplayer.sock"

func trySendToExistingInstance(filePath string) bool {
    conn, err := net.Dial("unix", socketPath)
    if err != nil {
        return false
    }
    defer conn.Close()

    _, err = conn.Write([]byte(filePath + "\n"))
    return err == nil
}

func startInstanceServer(onFile func(string)) {
    os.Remove(socketPath)

    l, err := net.Listen("unix", socketPath)
    if err != nil {
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
