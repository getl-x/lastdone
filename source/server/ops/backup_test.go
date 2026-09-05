package ops

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func parseTime(t *testing.T, value string) time.Time {
	t.Helper()
	result, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func testBackupManager(t *testing.T, directory string, now time.Time, calls *[]string) BackupManager {
	t.Helper()
	return BackupManager{
		DataDir: directory,
		Now:     func() time.Time { return now },
		Create: func(_ context.Context, name string) error {
			*calls = append(*calls, name)
			backupDir := filepath.Join(directory, "backups")
			if err := os.MkdirAll(backupDir, 0o700); err != nil {
				return err
			}
			return os.WriteFile(filepath.Join(backupDir, name), []byte(name), 0o600)
		},
	}
}

func TestBackupManagerCreatesOneDailyBackupAndRetainsSeven(t *testing.T) {
	directory := t.TempDir()
	calls := []string{}
	for day := 1; day <= 9; day++ {
		now := time.Date(2026, time.September, day, 3, 15, 0, 0, time.UTC)
		manager := testBackupManager(t, directory, now, &calls)
		if err := manager.EnsureDaily(context.Background()); err != nil {
			t.Fatal(err)
		}
		if err := manager.EnsureDaily(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if len(calls) != 9 {
		t.Fatalf("expected one backup per day, got %d", len(calls))
	}
	files, err := filepath.Glob(filepath.Join(directory, "backups", "daily_lastdone_*.zip"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 7 {
		t.Fatalf("expected seven daily backups, got %d", len(files))
	}
}

func TestBackupManagerCreatesPreUpgradeBeforeVersionChangeAndRetainsThree(t *testing.T) {
	directory := t.TempDir()
	dataPath := filepath.Join(directory, "data.db")
	if err := os.WriteFile(dataPath, []byte("database"), 0o600); err != nil {
		t.Fatal(err)
	}
	calls := []string{}
	manager := testBackupManager(
		t,
		directory,
		parseTime(t, "2026-09-05T00:00:00Z"),
		&calls,
	)
	if err := manager.MarkVersion("1.0.0"); err != nil {
		t.Fatal(err)
	}

	for index, version := range []string{"1.1.0", "1.2.0", "1.3.0", "1.4.0"} {
		manager.Now = func() time.Time {
			return parseTime(t, "2026-09-05T00:00:00Z").Add(time.Duration(index) * time.Minute)
		}
		created, err := manager.BeforeUpgrade(context.Background(), version, true)
		if err != nil {
			t.Fatal(err)
		}
		if !created {
			t.Fatalf("expected backup before %s", version)
		}
		if err := manager.MarkVersion(version); err != nil {
			t.Fatal(err)
		}
	}

	created, err := manager.BeforeUpgrade(context.Background(), "1.4.0", true)
	if err != nil {
		t.Fatal(err)
	}
	if created {
		t.Fatal("same version must not create another pre-upgrade backup")
	}
	files, err := filepath.Glob(filepath.Join(directory, "backups", "preupgrade_lastdone_*.zip"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 3 {
		t.Fatalf("expected three pre-upgrade backups, got %d", len(files))
	}
}
