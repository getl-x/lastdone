package notifications

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadOrCreateVAPIDKeysPersistsOneRestrictedKeyPair(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "nested", "pb_data")
	generated := 0
	generator := func() (string, string, error) {
		generated++
		return "public-key", "private-key", nil
	}

	first, err := LoadOrCreateVAPIDKeys(directory, generator)
	if err != nil {
		t.Fatal(err)
	}
	second, err := LoadOrCreateVAPIDKeys(directory, func() (string, string, error) {
		return "", "", errors.New("must not regenerate")
	})
	if err != nil {
		t.Fatal(err)
	}
	if first != second || generated != 1 {
		t.Fatalf("expected stable keys, first=%#v second=%#v generated=%d", first, second, generated)
	}

	info, err := os.Stat(filepath.Join(directory, vapidKeyFileName))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("expected 0600 key file, got %o", info.Mode().Perm())
	}
}

func TestLoadOrCreateVAPIDKeysRejectsInvalidFile(t *testing.T) {
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, vapidKeyFileName), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadOrCreateVAPIDKeys(directory, nil); err == nil {
		t.Fatal("expected invalid VAPID key file error")
	}
}
