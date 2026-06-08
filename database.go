package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

var gDB *sql.DB

// VideoRecord holds data for one row in the videos table.
type VideoRecord struct {
	ID       int64
	Hash     string
	Filepath string
	LastPos  float64
}

func initDB() error {
	dir, err := appDataDir()
	if err != nil {
		return fmt.Errorf("appDataDir: %w", err)
	}
	dbPath := filepath.Join(dir, "db.sqlite")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return fmt.Errorf("open sqlite: %w", err)
	}
	// Single connection prevents SQLITE_BUSY under concurrent access.
	db.SetMaxOpenConns(1)
	const schema = `
		CREATE TABLE IF NOT EXISTS videos (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			hash        TEXT UNIQUE,
			filepath    TEXT UNIQUE,
			last_opened TEXT,
			last_pos    REAL NOT NULL DEFAULT 0,
			duration    REAL,
			created_at  TEXT NOT NULL DEFAULT (datetime('now'))
		);
	`
	if _, err = db.Exec(schema); err != nil {
		db.Close()
		return fmt.Errorf("create schema: %w", err)
	}
	gDB = db
	return nil
}

// dbUpsertFilepath upserts a filepath record (updating last_opened) and returns
// the full record including any existing hash and last_pos.
func dbUpsertFilepath(path, openedAt string) (*VideoRecord, error) {
	if gDB == nil {
		return nil, fmt.Errorf("db not initialised")
	}
	tx, err := gDB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`
		INSERT INTO videos(filepath, last_opened) VALUES(?, ?)
		ON CONFLICT(filepath) DO UPDATE SET last_opened=excluded.last_opened
	`, path, openedAt); err != nil {
		return nil, err
	}
	var r VideoRecord
	r.Filepath = path
	if err = tx.QueryRow(
		`SELECT id, COALESCE(hash,''), last_pos FROM videos WHERE filepath=?`, path,
	).Scan(&r.ID, &r.Hash, &r.LastPos); err != nil {
		return nil, err
	}
	return &r, tx.Commit()
}

func dbGetByHash(hash string) (*VideoRecord, error) {
	if gDB == nil {
		return nil, fmt.Errorf("db not initialised")
	}
	var r VideoRecord
	err := gDB.QueryRow(
		`SELECT id, hash, COALESCE(filepath,''), last_pos FROM videos WHERE hash=?`, hash,
	).Scan(&r.ID, &r.Hash, &r.Filepath, &r.LastPos)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func dbSetHash(id int64, hash string) error {
	if gDB == nil {
		return nil
	}
	_, err := gDB.Exec(`UPDATE videos SET hash=? WHERE id=?`, hash, id)
	return err
}

// dbMergeHashRecord updates the hash record's filepath/last_opened and deletes
// the stale filepath-only record. Used when a renamed file is re-opened.
func dbMergeHashRecord(hashID, filepathID int64, newFilepath, openedAt string) error {
	if gDB == nil {
		return nil
	}
	tx, err := gDB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if filepathID != hashID {
		if _, err = tx.Exec(`DELETE FROM videos WHERE id=?`, filepathID); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(
		`UPDATE videos SET filepath=?, last_opened=? WHERE id=?`,
		newFilepath, openedAt, hashID,
	); err != nil {
		return err
	}
	return tx.Commit()
}

func dbSavePosition(id int64, pos float64) error {
	if gDB == nil {
		return nil
	}
	_, err := gDB.Exec(`UPDATE videos SET last_pos=? WHERE id=?`, pos, id)
	return err
}

func dbGetRecents(limit int) ([]RecentEntry, error) {
	if gDB == nil {
		return []RecentEntry{}, nil
	}
	rows, err := gDB.Query(`
		SELECT filepath, COALESCE(last_opened,'')
		FROM videos
		WHERE filepath IS NOT NULL AND last_opened IS NOT NULL
		ORDER BY last_opened DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var entries []RecentEntry
	for rows.Next() {
		var e RecentEntry
		if rows.Scan(&e.Path, &e.OpenedAt) == nil {
			e.Filename = filepath.Base(e.Path)
			entries = append(entries, e)
		}
	}
	if entries == nil {
		return []RecentEntry{}, nil
	}
	return entries, nil
}

// dbClearRecents nullifies last_opened for all records so they disappear from
// the recents list while preserving hash and position data.
func dbClearRecents() error {
	if gDB == nil {
		return nil
	}
	_, err := gDB.Exec(`UPDATE videos SET last_opened=NULL`)
	return err
}

// hashVideoFile reads 3×64 KB chunks (start, middle, end) and returns their
// SHA-256 as a hex string. Survives renames; typically sub-millisecond.
func hashVideoFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	size, err := f.Seek(0, io.SeekEnd)
	if err != nil {
		return "", err
	}
	const chunk = 64 * 1024
	buf := make([]byte, chunk)
	h := sha256.New()
	for _, off := range []int64{0, size / 2, size - chunk} {
		if off < 0 {
			off = 0
		}
		if _, err := f.Seek(off, io.SeekStart); err != nil {
			return "", err
		}
		n, _ := f.Read(buf)
		h.Write(buf[:n])
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
