package ops

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

type healthResponse struct {
	Status     string `json:"status"`
	AppVersion string `json:"appVersion"`
}

// CheckHealth verifies that a running LastDone server is ready to serve traffic.
func CheckHealth(ctx context.Context, client *http.Client, baseURL string) error {
	if client == nil {
		client = http.DefaultClient
	}

	healthURL, err := resolveHealthURL(baseURL)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, healthURL, nil)
	if err != nil {
		return fmt.Errorf("create health request: %w", err)
	}
	response, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("request health endpoint: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return fmt.Errorf("health endpoint returned %s", response.Status)
	}

	var payload healthResponse
	decoder := json.NewDecoder(io.LimitReader(response.Body, 64*1024))
	if err := decoder.Decode(&payload); err != nil {
		return fmt.Errorf("decode health response: %w", err)
	}
	if payload.Status != "ok" || strings.TrimSpace(payload.AppVersion) == "" {
		return fmt.Errorf("health endpoint is not ready")
	}
	return nil
}

func resolveHealthURL(baseURL string) (string, error) {
	value := strings.TrimSpace(baseURL)
	if value == "" {
		return "", fmt.Errorf("health URL is required")
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return "", fmt.Errorf("parse health URL: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("health URL must use http or https")
	}
	if parsed.Host == "" {
		return "", fmt.Errorf("health URL must include a host")
	}
	if parsed.Path == "" || parsed.Path == "/" {
		parsed.Path = "/api/lastdone/health"
	}
	return parsed.String(), nil
}
