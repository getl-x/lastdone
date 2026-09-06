package app

import (
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
)

func TestHealthRoute(t *testing.T) {
	scenario := tests.ApiScenario{
		Name:           "returns application health",
		Method:         http.MethodGet,
		URL:            "/api/lastdone/health",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"status":"ok"`,
			`"appVersion":"test-version"`,
			`"databaseVersion":"202609060001"`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			t.Helper()
			application, err := tests.NewTestApp(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			RegisterHooks(application, Config{
				DataDir:      t.TempDir(),
				PublicDir:    t.TempDir(),
				AppVersion:   "test-version",
				VAPIDSubject: "https://lastdone.test",
			})
			return application
		},
	}

	scenario.Test(t)
}
