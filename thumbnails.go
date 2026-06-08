//go:build windows

package main

import (
	"bytes"
	"fmt"
	"image"
	"image/draw"
	"image/jpeg"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"syscall"
)

const (
	thumbCount      = 100
	thumbHeight     = 120 // px; ~214×120 at 16:9
	maxThumbWorkers = 8
)

// SeekThumbnailData is the payload sent to the frontend for seek thumbnail display.
type SeekThumbnailData struct {
	VTT               string `json:"vtt"`
	SpritesheetBase64 string `json:"spritesheetBase64"` // "data:image/jpeg;base64,..."
	Ready             bool   `json:"ready"`
}

// thumbsInProgress prevents duplicate concurrent generation for the same hash.
var thumbsInProgress sync.Map

// ffmpegPath returns the path to ffmpeg, preferring a copy next to the executable.
func ffmpegPath() (string, error) {
	if exe, err := os.Executable(); err == nil {
		candidate := filepath.Join(filepath.Dir(exe), "ffmpeg.exe")
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}
	path, err := exec.LookPath("ffmpeg")
	if err != nil {
		return "", fmt.Errorf("ffmpeg not found alongside app or in PATH")
	}
	return path, nil
}

// extractFrame extracts one JPEG frame at time t (seconds) using fast-seek (-ss before -i).
// Output is piped to stdout so no temp files are written to disk.
func extractFrame(ffmpegBin, videoPath string, t float64, w, h int) (image.Image, error) {
	filter := fmt.Sprintf(
		"scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2",
		w, h, w, h,
	)
	cmd := exec.Command(ffmpegBin,
		"-loglevel", "warning",
		"-ss", fmt.Sprintf("%.3f", t),
		"-i", videoPath,
		"-frames:v", "1",
		"-vf", filter,
		"-f", "mjpeg",
		"-q:v", "5",
		"pipe:1",
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("ffmpeg at %.1fs: %w (stderr: %s)", t, err, stderr.String())
	}
	img, err := jpeg.Decode(&stdout)
	if err != nil {
		return nil, fmt.Errorf("jpeg decode at %.1fs: %w", t, err)
	}
	return img, nil
}

// buildSpritesheet composites frames into a near-square grid and returns the
// composed image and the matching WEBVTT text.
func buildSpritesheet(frames []image.Image, w, h int, duration float64) (image.Image, string) {
	count := len(frames)
	cols := int(math.Ceil(math.Sqrt(float64(count))))
	rows := int(math.Ceil(float64(count) / float64(cols)))

	ss := image.NewRGBA(image.Rect(0, 0, cols*w, rows*h))

	var vtt bytes.Buffer
	fmt.Fprint(&vtt, "WEBVTT\n\n")

	for i, img := range frames {
		col := i % cols
		row := i / cols
		if img != nil {
			draw.Draw(ss, image.Rect(col*w, row*h, (col+1)*w, (row+1)*h), img, image.Point{}, draw.Src)
		}
		start := float64(i) * duration / float64(count)
		end := float64(i+1) * duration / float64(count)
		fmt.Fprintf(&vtt, "%s --> %s\nspritesheet.jpg#xywh=%d,%d,%d,%d\n\n",
			formatVTTTime(start), formatVTTTime(end), col*w, row*h, w, h)
	}
	return ss, vtt.String()
}

func formatVTTTime(s float64) string {
	h := int(s) / 3600
	m := (int(s) % 3600) / 60
	sec := s - float64(h*3600+m*60)
	return fmt.Sprintf("%02d:%02d:%06.3f", h, m, sec)
}

// tlog calls logFn if non-nil.
func tlog(logFn func(string), msg string) {
	if logFn != nil {
		logFn(msg)
	}
}

// generateThumbnails extracts thumbCount frames with a parallel worker pool,
// assembles them into a spritesheet, and writes spritesheet.jpg + spritesheet.vtt
// to media/<hash>/. Returns (true, nil) if skipped (cache hit or concurrent guard),
// (false, nil) on successful fresh generation, or (false, err) on failure.
func generateThumbnails(videoPath, hash string, duration float64, logFn func(string)) (bool, error) {
	dir, err := mediaDir(hash)
	if err != nil {
		return false, fmt.Errorf("mediaDir: %w", err)
	}
	ssPath := filepath.Join(dir, "spritesheet.jpg")
	vttPath := filepath.Join(dir, "spritesheet.vtt")

	// Cache hit: skip generation if both output files already exist.
	if _, e1 := os.Stat(ssPath); e1 == nil {
		if _, e2 := os.Stat(vttPath); e2 == nil {
			tlog(logFn, "cache hit — skipping")
			return true, nil
		}
	}

	// Prevent duplicate concurrent generation for the same video hash.
	if _, loaded := thumbsInProgress.LoadOrStore(hash, struct{}{}); loaded {
		tlog(logFn, "generation already in progress, skipping")
		return true, nil
	}
	defer thumbsInProgress.Delete(hash)

	ffmpeg, err := ffmpegPath()
	if err != nil {
		return false, err
	}
	tlog(logFn, "ffmpeg: "+ffmpeg)

	thumbW := int(math.Round(float64(thumbHeight) * 16.0 / 9.0))
	if thumbW%2 != 0 {
		thumbW++
	}
	cols := int(math.Ceil(math.Sqrt(float64(thumbCount))))
	tlog(logFn, fmt.Sprintf("extracting %d frames (%d×%d grid, %d×%dpx)", thumbCount, cols, cols, thumbW, thumbHeight))

	// Sample points offset by 0.5 so we never land exactly on t=0 (likely a black frame).
	timestamps := make([]float64, thumbCount)
	for i := range timestamps {
		timestamps[i] = (float64(i) + 0.5) * duration / float64(thumbCount)
	}

	frames := make([]image.Image, thumbCount)

	jobs := make(chan int, thumbCount)
	for i := range timestamps {
		jobs <- i
	}
	close(jobs)

	workers := min(maxThumbWorkers, runtime.NumCPU())
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for idx := range jobs {
				img, err := extractFrame(ffmpeg, videoPath, timestamps[idx], thumbW, thumbHeight)
				if err == nil {
					frames[idx] = img // safe: each goroutine writes a unique index
				}
			}
		}()
	}
	wg.Wait()

	var okCnt int
	for _, img := range frames {
		if img != nil {
			okCnt++
		}
	}
	tlog(logFn, fmt.Sprintf("frames done — %d/%d ok", okCnt, thumbCount))

	spritesheet, vttContent := buildSpritesheet(frames, thumbW, thumbHeight, duration)

	f, err := os.Create(ssPath)
	if err != nil {
		return false, fmt.Errorf("create spritesheet: %w", err)
	}
	if encErr := jpeg.Encode(f, spritesheet, &jpeg.Options{Quality: 88}); encErr != nil {
		f.Close()
		os.Remove(ssPath)
		return false, fmt.Errorf("encode spritesheet: %w", encErr)
	}
	f.Close()

	if err := os.WriteFile(vttPath, []byte(vttContent), 0o644); err != nil {
		return false, fmt.Errorf("write vtt: %w", err)
	}
	if fi, err := os.Stat(ssPath); err == nil {
		tlog(logFn, fmt.Sprintf("spritesheet written — %d KB", fi.Size()/1024))
	}
	return false, nil
}
