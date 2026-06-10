//go:build linux || darwin

package main

import (
	"bufio"
	"net"
	"os"
	"strings"

	"lucidmediaplayer/internal/config"
)

func instanceSocketPath() string {
	return "/tmp/lucidmediaplayer-" + *config.Profile + ".sock"
}

func trySendToExistingInstance(filePath string) bool {
	conn, err := net.Dial("unix", instanceSocketPath())
	if err != nil {
		return false
	}
	defer conn.Close()

	_, err = conn.Write([]byte(filePath + "\n"))
	return err == nil
}

func startInstanceServer(onFile func(string)) {
	os.Remove(instanceSocketPath())

	l, err := net.Listen("unix", instanceSocketPath())
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
