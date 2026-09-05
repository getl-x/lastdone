package app

import (
	"net/http"
	"os"

	lastdonesync "github.com/getl-x/lastdone/source/server/sync"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

func New(config Config) *pocketbase.PocketBase {
	application := pocketbase.NewWithConfig(pocketbase.Config{
		DefaultDataDir: config.DataDir,
	})
	RegisterHooks(application, config)
	return application
}

func RegisterHooks(application core.App, config Config) {
	application.OnServe().BindFunc(func(event *core.ServeEvent) error {
		lastdonesync.RegisterRoutes(event)
		event.Router.GET("/api/lastdone/health", func(request *core.RequestEvent) error {
			return request.JSON(http.StatusOK, map[string]string{
				"status":          "ok",
				"appVersion":      config.AppVersion,
				"databaseVersion": DatabaseVersion,
			})
		})

		if _, err := os.Stat(config.PublicDir); err == nil {
			event.Router.GET(
				"/{path...}",
				apis.Static(os.DirFS(config.PublicDir), true),
			)
		}

		return event.Next()
	})
}
