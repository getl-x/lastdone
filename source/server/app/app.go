package app

import (
	"context"
	"net/http"
	"os"
	"time"

	"github.com/getl-x/lastdone/source/server/notifications"
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
		keys, err := notifications.LoadOrCreateVAPIDKeys(config.DataDir, nil)
		if err != nil {
			return err
		}
		dispatcher := notifications.Dispatcher{
			Store: notifications.NewPocketBaseDispatchStore(event.App),
			Sender: notifications.WebPushSender{
				Keys:       keys,
				Subscriber: config.VAPIDSubject,
			},
		}
		event.App.Cron().MustAdd("lastdone-notifications", "* * * * *", func() {
			if _, err := dispatcher.Run(context.Background(), time.Now()); err != nil {
				event.App.Logger().Error("notification dispatch failed", "error", err)
			}
		})
		notifications.RegisterRoutes(event, notifications.RouteConfig{
			PublicKey: keys.PublicKey,
		})
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
