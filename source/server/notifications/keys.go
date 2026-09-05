package notifications

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	webpush "github.com/SherClockHolmes/webpush-go"
)

const vapidKeyFileName = "vapid_keys.json"

type VAPIDKeys struct {
	PublicKey  string `json:"publicKey"`
	PrivateKey string `json:"privateKey"`
}

type VAPIDKeyGenerator func() (publicKey string, privateKey string, err error)

func LoadOrCreateVAPIDKeys(dataDir string, generate VAPIDKeyGenerator) (VAPIDKeys, error) {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return VAPIDKeys{}, fmt.Errorf("create data directory: %w", err)
	}
	path := filepath.Join(dataDir, vapidKeyFileName)
	keys, err := readVAPIDKeys(path)
	if err == nil {
		if chmodErr := os.Chmod(path, 0o600); chmodErr != nil {
			return VAPIDKeys{}, fmt.Errorf("restrict VAPID key permissions: %w", chmodErr)
		}
		return keys, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return VAPIDKeys{}, err
	}

	if generate == nil {
		generate = func() (string, string, error) {
			privateKey, publicKey, err := webpush.GenerateVAPIDKeys()
			return publicKey, privateKey, err
		}
	}
	publicKey, privateKey, err := generate()
	if err != nil {
		return VAPIDKeys{}, fmt.Errorf("generate VAPID keys: %w", err)
	}
	keys = VAPIDKeys{PublicKey: publicKey, PrivateKey: privateKey}
	if err := validateVAPIDKeys(keys); err != nil {
		return VAPIDKeys{}, err
	}

	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, os.ErrExist) {
		return readVAPIDKeys(path)
	}
	if err != nil {
		return VAPIDKeys{}, fmt.Errorf("create VAPID key file: %w", err)
	}
	removeIncomplete := true
	defer func() {
		_ = file.Close()
		if removeIncomplete {
			_ = os.Remove(path)
		}
	}()
	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(keys); err != nil {
		return VAPIDKeys{}, fmt.Errorf("write VAPID key file: %w", err)
	}
	if err := file.Sync(); err != nil {
		return VAPIDKeys{}, fmt.Errorf("sync VAPID key file: %w", err)
	}
	if err := file.Close(); err != nil {
		return VAPIDKeys{}, fmt.Errorf("close VAPID key file: %w", err)
	}
	removeIncomplete = false
	return keys, nil
}

func readVAPIDKeys(path string) (VAPIDKeys, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return VAPIDKeys{}, err
	}
	keys := VAPIDKeys{}
	if err := json.Unmarshal(data, &keys); err != nil {
		return VAPIDKeys{}, fmt.Errorf("decode VAPID key file: %w", err)
	}
	if err := validateVAPIDKeys(keys); err != nil {
		return VAPIDKeys{}, err
	}
	return keys, nil
}

func validateVAPIDKeys(keys VAPIDKeys) error {
	if keys.PublicKey == "" || keys.PrivateKey == "" {
		return fmt.Errorf("VAPID key file is missing a public or private key")
	}
	return nil
}
