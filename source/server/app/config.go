package app

import "os"

const DatabaseVersion = "202609050002"

type Config struct {
	DataDir      string
	PublicDir    string
	AppVersion   string
	VAPIDSubject string
}

func DefaultConfig() Config {
	return Config{
		DataDir:      envOrDefault("LASTDONE_DATA_DIR", "pb_data"),
		PublicDir:    envOrDefault("LASTDONE_PUBLIC_DIR", "pb_public"),
		AppVersion:   envOrDefault("LASTDONE_VERSION", "dev"),
		VAPIDSubject: envOrDefault("LASTDONE_VAPID_SUBJECT", "https://lastdone.local"),
	}
}

func envOrDefault(name string, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
