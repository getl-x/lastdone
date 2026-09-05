package ops

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCheckHealthAcceptsLastDoneHealthResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"status":"ok","appVersion":"1.0.0"}`))
	}))
	defer server.Close()

	client := &http.Client{Timeout: time.Second}
	if err := CheckHealth(t.Context(), client, server.URL); err != nil {
		t.Fatal(err)
	}
}

func TestCheckHealthRejectsBadStatusAndInvalidPayload(t *testing.T) {
	for name, handler := range map[string]http.HandlerFunc{
		"bad status": func(response http.ResponseWriter, _ *http.Request) {
			response.WriteHeader(http.StatusServiceUnavailable)
		},
		"bad payload": func(response http.ResponseWriter, _ *http.Request) {
			_, _ = response.Write([]byte(`{"status":"starting"}`))
		},
	} {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(handler)
			defer server.Close()
			if err := CheckHealth(t.Context(), server.Client(), server.URL); err == nil {
				t.Fatal("expected health check failure")
			}
		})
	}
}
