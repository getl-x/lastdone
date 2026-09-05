package notifications

import (
	"net/http"
	"strings"
	"testing"

	_ "github.com/getl-x/lastdone/source/server/migrations"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func notificationRouteFactory(
	headers map[string]string,
	seed func(t testing.TB, app *tests.TestApp, user *core.Record),
) func(testing.TB) *tests.TestApp {
	return func(t testing.TB) *tests.TestApp {
		application, err := tests.NewTestApp(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		runner := core.NewMigrationsRunner(application, core.AppMigrations)
		if _, err := runner.Up(); err != nil {
			application.Cleanup()
			t.Fatal(err)
		}
		users, err := application.FindCollectionByNameOrId("users")
		if err != nil {
			application.Cleanup()
			t.Fatal(err)
		}
		user := core.NewRecord(users)
		user.Id = "testuser0000001"
		user.Set("username", "test-user")
		user.SetPassword("correct-horse-battery-staple")
		if err := application.Save(user); err != nil {
			application.Cleanup()
			t.Fatal(err)
		}
		token, err := user.NewAuthToken()
		if err != nil {
			application.Cleanup()
			t.Fatal(err)
		}
		headers["Authorization"] = token
		if seed != nil {
			seed(t, application, user)
		}
		return application
	}
}

func notificationAnonymousFactory(t testing.TB) *tests.TestApp {
	application, err := tests.NewTestApp(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	runner := core.NewMigrationsRunner(application, core.AppMigrations)
	if _, err := runner.Up(); err != nil {
		application.Cleanup()
		t.Fatal(err)
	}
	return application
}

func registerNotificationTestRoutes(
	_ testing.TB,
	_ *tests.TestApp,
	event *core.ServeEvent,
) {
	RegisterRoutes(event, RouteConfig{PublicKey: "test-public-key"})
}

func TestNotificationConfigRequiresAuthentication(t *testing.T) {
	(&tests.ApiScenario{
		Name:            "rejects anonymous push config",
		Method:          http.MethodGet,
		URL:             "/api/lastdone/push/config",
		ExpectedStatus:  http.StatusUnauthorized,
		ExpectedContent: []string{`"status":401`},
		TestAppFactory:  notificationAnonymousFactory,
		BeforeTestFunc:  registerNotificationTestRoutes,
	}).Test(t)
}

func TestNotificationConfigReturnsVAPIDPublicKey(t *testing.T) {
	headers := map[string]string{}
	(&tests.ApiScenario{
		Name:            "returns authenticated push config",
		Method:          http.MethodGet,
		URL:             "/api/lastdone/push/config",
		Headers:         headers,
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"publicKey":"test-public-key"`},
		TestAppFactory:  notificationRouteFactory(headers, nil),
		BeforeTestFunc:  registerNotificationTestRoutes,
	}).Test(t)
}

func TestSubscribeCreatesOwnedDeviceAndSubscription(t *testing.T) {
	headers := map[string]string{}
	(&tests.ApiScenario{
		Name:   "registers browser push subscription",
		Method: http.MethodPost,
		URL:    "/api/lastdone/push/subscribe",
		Body: strings.NewReader(`{
			"deviceName":"My iPhone",
			"platform":"ios-pwa",
			"digestEnabled":true,
			"importantRemindersEnabled":true,
			"subscription":{
				"endpoint":"https://push.example/iphone",
				"keys":{"p256dh":"public-key","auth":"auth-secret"}
			}
		}`),
		Headers:         headers,
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"enabled":true`, `"platform":"ios-pwa"`},
		TestAppFactory:  notificationRouteFactory(headers, nil),
		BeforeTestFunc:  registerNotificationTestRoutes,
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			devices, err := app.FindRecordsByFilter("devices", "name='My iPhone'", "", 10, 0)
			if err != nil || len(devices) != 1 {
				t.Fatalf("expected one device, records=%d err=%v", len(devices), err)
			}
			subscriptions, err := app.FindRecordsByFilter("push_subscriptions", "device={:device}", "", 10, 0, map[string]any{"device": devices[0].Id})
			if err != nil || len(subscriptions) != 1 || !subscriptions[0].GetBool("enabled") {
				t.Fatalf("expected enabled subscription, records=%d err=%v", len(subscriptions), err)
			}
		},
	}).Test(t)
}

func TestNotificationPreferencesAndUnsubscribeUpdateOwnedDevice(t *testing.T) {
	seed := func(t testing.TB, app *tests.TestApp, user *core.Record) {
		device := saveOwnedRecord(t, app, "devices", "device000000001", user.Id, map[string]any{
			"name": "Desktop", "platform": "web", "digestEnabled": false,
			"importantRemindersEnabled": false, "lastSeenAt": "2026-09-05T00:00:00Z",
		})
		saveOwnedRecord(t, app, "push_subscriptions", "pushsub00000001", user.Id, map[string]any{
			"device": device.Id, "endpoint": "https://push.example/desktop",
			"keys": map[string]string{"p256dh": "public-key", "auth": "auth-secret"}, "enabled": true,
		})
	}

	t.Run("preferences", func(t *testing.T) {
		headers := map[string]string{}
		(&tests.ApiScenario{
			Name:   "updates notification preferences",
			Method: http.MethodPatch,
			URL:    "/api/lastdone/push/preferences",
			Body: strings.NewReader(`{
				"deviceId":"device000000001",
				"digestEnabled":true,
				"importantRemindersEnabled":true
			}`),
			Headers:         headers,
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`"digestEnabled":true`, `"importantRemindersEnabled":true`},
			TestAppFactory:  notificationRouteFactory(headers, seed),
			BeforeTestFunc:  registerNotificationTestRoutes,
		}).Test(t)
	})

	t.Run("device list", func(t *testing.T) {
		headers := map[string]string{}
		(&tests.ApiScenario{
			Name:            "lists owned notification devices",
			Method:          http.MethodGet,
			URL:             "/api/lastdone/push/devices",
			Headers:         headers,
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`"deviceName":"Desktop"`, `"enabled":true`},
			TestAppFactory:  notificationRouteFactory(headers, seed),
			BeforeTestFunc:  registerNotificationTestRoutes,
		}).Test(t)
	})

	t.Run("unsubscribe", func(t *testing.T) {
		headers := map[string]string{}
		(&tests.ApiScenario{
			Name:            "disables push subscription",
			Method:          http.MethodPost,
			URL:             "/api/lastdone/push/unsubscribe",
			Body:            strings.NewReader(`{"deviceId":"device000000001"}`),
			Headers:         headers,
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`"enabled":false`},
			TestAppFactory:  notificationRouteFactory(headers, seed),
			BeforeTestFunc:  registerNotificationTestRoutes,
		}).Test(t)
	})
}
