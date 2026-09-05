package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	_ "github.com/getl-x/lastdone/source/server/migrations"
)

func TestBootstrapAppliesMigrationsBacksUpAndMarksVersion(t *testing.T) {
	dataDir := t.TempDir()
	config := Config{
		DataDir:      dataDir,
		PublicDir:    t.TempDir(),
		AppVersion:   "1.0.0",
		VAPIDSubject: "https://lastdone.test",
	}

	application := New(config)
	if err := application.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	if _, err := application.FindCollectionByNameOrId("items"); err != nil {
		t.Fatalf("expected app migrations to create items: %v", err)
	}
	if err := application.ResetBootstrapState(); err != nil {
		t.Fatal(err)
	}

	marker, err := os.ReadFile(filepath.Join(dataDir, ".lastdone-version"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(marker)) != "1.0.0" {
		t.Fatalf("unexpected version marker %q", marker)
	}
	daily, err := filepath.Glob(filepath.Join(dataDir, "backups", "daily_lastdone_*.zip"))
	if err != nil {
		t.Fatal(err)
	}
	if len(daily) != 1 {
		t.Fatalf("expected one daily backup, got %d", len(daily))
	}

	config.AppVersion = "1.1.0"
	upgraded := New(config)
	if err := upgraded.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	if err := upgraded.ResetBootstrapState(); err != nil {
		t.Fatal(err)
	}
	preupgrade, err := filepath.Glob(
		filepath.Join(dataDir, "backups", "preupgrade_lastdone_*.zip"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(preupgrade) != 1 {
		t.Fatalf("expected one pre-upgrade backup, got %d", len(preupgrade))
	}
}
