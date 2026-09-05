package ops

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const versionMarkerName = ".lastdone-version"

var backupLock sync.Mutex

// BackupManager creates and prunes LastDone's local PocketBase backups.
type BackupManager struct {
	DataDir string
	Now     func() time.Time
	Create  func(context.Context, string) error
}

// EnsureDaily creates at most one backup for the current UTC date and retains seven.
func (manager BackupManager) EnsureDaily(ctx context.Context) error {
	backupLock.Lock()
	defer backupLock.Unlock()

	if err := manager.validate(); err != nil {
		return err
	}
	name := "daily_lastdone_" + manager.now().UTC().Format("20060102") + ".zip"
	path := filepath.Join(manager.DataDir, "backups", name)
	if _, err := os.Stat(path); err == nil {
		return manager.prune("daily_lastdone_*.zip", 7)
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect daily backup: %w", err)
	}
	if err := manager.Create(ctx, name); err != nil {
		return fmt.Errorf("create daily backup: %w", err)
	}
	return manager.prune("daily_lastdone_*.zip", 7)
}

// BeforeUpgrade creates a backup when an existing database starts under a new app version.
func (manager BackupManager) BeforeUpgrade(
	ctx context.Context,
	version string,
	databaseExists bool,
) (bool, error) {
	backupLock.Lock()
	defer backupLock.Unlock()

	if err := manager.validate(); err != nil {
		return false, err
	}
	version = strings.TrimSpace(version)
	if version == "" {
		return false, fmt.Errorf("app version is required")
	}
	if !databaseExists {
		return false, nil
	}

	previous, err := manager.readVersion()
	if err != nil {
		return false, err
	}
	if previous == version {
		return false, nil
	}

	name := "preupgrade_lastdone_" + manager.now().UTC().Format("20060102T150405.000000000Z") + ".zip"
	if err := manager.Create(ctx, name); err != nil {
		return false, fmt.Errorf("create pre-upgrade backup: %w", err)
	}
	if err := manager.prune("preupgrade_lastdone_*.zip", 3); err != nil {
		return false, err
	}
	return true, nil
}

// CreateManual creates a timestamped backup without changing automatic retention sets.
func (manager BackupManager) CreateManual(ctx context.Context) (string, error) {
	backupLock.Lock()
	defer backupLock.Unlock()

	if err := manager.validate(); err != nil {
		return "", err
	}
	name := "manual_lastdone_" + manager.now().UTC().Format("20060102T150405.000000000Z") + ".zip"
	if err := manager.Create(ctx, name); err != nil {
		return "", fmt.Errorf("create manual backup: %w", err)
	}
	return name, nil
}

// MarkVersion records the successfully started application version atomically.
func (manager BackupManager) MarkVersion(version string) error {
	version = strings.TrimSpace(version)
	if version == "" {
		return fmt.Errorf("app version is required")
	}
	if strings.ContainsAny(version, "\r\n") {
		return fmt.Errorf("app version must be a single line")
	}
	if strings.TrimSpace(manager.DataDir) == "" {
		return fmt.Errorf("data directory is required")
	}
	if err := os.MkdirAll(manager.DataDir, 0o700); err != nil {
		return fmt.Errorf("create data directory: %w", err)
	}

	temporary, err := os.CreateTemp(manager.DataDir, ".lastdone-version-*")
	if err != nil {
		return fmt.Errorf("create version marker: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("secure version marker: %w", err)
	}
	if _, err := temporary.WriteString(version + "\n"); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("write version marker: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("sync version marker: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close version marker: %w", err)
	}
	if err := os.Rename(temporaryPath, filepath.Join(manager.DataDir, versionMarkerName)); err != nil {
		return fmt.Errorf("replace version marker: %w", err)
	}
	return nil
}

func (manager BackupManager) validate() error {
	if strings.TrimSpace(manager.DataDir) == "" {
		return fmt.Errorf("data directory is required")
	}
	if manager.Create == nil {
		return fmt.Errorf("backup creator is required")
	}
	return nil
}

func (manager BackupManager) now() time.Time {
	if manager.Now != nil {
		return manager.Now()
	}
	return time.Now()
}

func (manager BackupManager) readVersion() (string, error) {
	contents, err := os.ReadFile(filepath.Join(manager.DataDir, versionMarkerName))
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("read version marker: %w", err)
	}
	return strings.TrimSpace(string(contents)), nil
}

func (manager BackupManager) prune(pattern string, keep int) error {
	files, err := filepath.Glob(filepath.Join(manager.DataDir, "backups", pattern))
	if err != nil {
		return fmt.Errorf("list backups: %w", err)
	}
	sort.Strings(files)
	for _, path := range files[:max(0, len(files)-keep)] {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove old backup %q: %w", filepath.Base(path), err)
		}
	}
	return nil
}
