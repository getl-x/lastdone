package notifications

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

type RouteConfig struct {
	PublicKey string
}

type subscriptionKeysRequest struct {
	P256DH string `json:"p256dh"`
	Auth   string `json:"auth"`
}

type subscriptionRequest struct {
	Endpoint string                  `json:"endpoint"`
	Keys     subscriptionKeysRequest `json:"keys"`
}

type subscribeRequest struct {
	DeviceID                  string              `json:"deviceId"`
	DeviceName                string              `json:"deviceName"`
	Platform                  string              `json:"platform"`
	DigestEnabled             bool                `json:"digestEnabled"`
	ImportantRemindersEnabled bool                `json:"importantRemindersEnabled"`
	Subscription              subscriptionRequest `json:"subscription"`
}

type preferencesRequest struct {
	DeviceID                  string `json:"deviceId"`
	DigestEnabled             bool   `json:"digestEnabled"`
	ImportantRemindersEnabled bool   `json:"importantRemindersEnabled"`
}

type deviceRequest struct {
	DeviceID string `json:"deviceId"`
}

type deviceState struct {
	DeviceID                  string `json:"deviceId"`
	DeviceName                string `json:"deviceName"`
	Platform                  string `json:"platform"`
	DigestEnabled             bool   `json:"digestEnabled"`
	ImportantRemindersEnabled bool   `json:"importantRemindersEnabled"`
	Enabled                   bool   `json:"enabled"`
}

func RegisterRoutes(event *core.ServeEvent, config RouteConfig) {
	event.Router.GET("/api/lastdone/push/config", func(request *core.RequestEvent) error {
		return request.JSON(http.StatusOK, map[string]string{"publicKey": config.PublicKey})
	}).Bind(apis.RequireAuth("users"))

	event.Router.POST("/api/lastdone/push/subscribe", func(request *core.RequestEvent) error {
		body := subscribeRequest{}
		if err := request.BindBody(&body); err != nil {
			return apis.NewBadRequestError("invalid push subscription", err)
		}
		state, err := subscribe(request.App, request.Auth.Id, body, time.Now())
		if err != nil {
			return apis.NewBadRequestError("could not save push subscription", err)
		}
		return request.JSON(http.StatusOK, state)
	}).Bind(apis.RequireAuth("users"))

	event.Router.PATCH("/api/lastdone/push/preferences", func(request *core.RequestEvent) error {
		body := preferencesRequest{}
		if err := request.BindBody(&body); err != nil {
			return apis.NewBadRequestError("invalid notification preferences", err)
		}
		state, err := updatePreferences(request.App, request.Auth.Id, body, time.Now())
		if errors.Is(err, sql.ErrNoRows) {
			return apis.NewNotFoundError("device not found", err)
		}
		if err != nil {
			return apis.NewBadRequestError("could not update notification preferences", err)
		}
		return request.JSON(http.StatusOK, state)
	}).Bind(apis.RequireAuth("users"))

	event.Router.POST("/api/lastdone/push/unsubscribe", func(request *core.RequestEvent) error {
		body := deviceRequest{}
		if err := request.BindBody(&body); err != nil {
			return apis.NewBadRequestError("invalid unsubscribe request", err)
		}
		state, err := unsubscribe(request.App, request.Auth.Id, body.DeviceID, time.Now())
		if errors.Is(err, sql.ErrNoRows) {
			return apis.NewNotFoundError("device not found", err)
		}
		if err != nil {
			return apis.NewBadRequestError("could not disable push subscription", err)
		}
		return request.JSON(http.StatusOK, state)
	}).Bind(apis.RequireAuth("users"))

	event.Router.GET("/api/lastdone/push/status", func(request *core.RequestEvent) error {
		state, err := loadDeviceState(
			request.App,
			request.Auth.Id,
			request.Request.URL.Query().Get("deviceId"),
		)
		if errors.Is(err, sql.ErrNoRows) {
			return apis.NewNotFoundError("device not found", err)
		}
		if err != nil {
			return apis.NewBadRequestError("could not load push status", err)
		}
		return request.JSON(http.StatusOK, state)
	}).Bind(apis.RequireAuth("users"))
}

func subscribe(app core.App, userID string, body subscribeRequest, now time.Time) (deviceState, error) {
	body.DeviceName = strings.TrimSpace(body.DeviceName)
	body.DeviceID = strings.TrimSpace(body.DeviceID)
	body.Subscription.Endpoint = strings.TrimSpace(body.Subscription.Endpoint)
	body.Subscription.Keys.P256DH = strings.TrimSpace(body.Subscription.Keys.P256DH)
	body.Subscription.Keys.Auth = strings.TrimSpace(body.Subscription.Keys.Auth)
	if body.DeviceName == "" || !validPlatform(body.Platform) {
		return deviceState{}, errors.New("device name and supported platform are required")
	}
	if body.Subscription.Endpoint == "" || body.Subscription.Keys.P256DH == "" || body.Subscription.Keys.Auth == "" {
		return deviceState{}, errors.New("subscription endpoint and keys are required")
	}

	var state deviceState
	err := app.RunInTransaction(func(transactionApp core.App) error {
		device, err := findOwnedDevice(transactionApp, userID, body.DeviceID)
		if errors.Is(err, sql.ErrNoRows) && body.DeviceID != "" {
			return err
		}
		if errors.Is(err, sql.ErrNoRows) {
			device = nil
		} else if err != nil {
			return err
		}

		subscription, err := transactionApp.FindFirstRecordByFilter(
			"push_subscriptions",
			"endpoint={:endpoint}",
			dbx.Params{"endpoint": body.Subscription.Endpoint},
		)
		if err == nil {
			if subscription.GetString("user") != userID {
				return errors.New("subscription endpoint belongs to another user")
			}
			if device == nil {
				device, err = findOwnedDevice(transactionApp, userID, subscription.GetString("device"))
				if err != nil {
					return err
				}
			}
		} else if !errors.Is(err, sql.ErrNoRows) {
			return err
		} else {
			subscription = nil
		}

		if device == nil {
			collection, findErr := transactionApp.FindCollectionByNameOrId("devices")
			if findErr != nil {
				return findErr
			}
			device = core.NewRecord(collection)
			device.Set("user", userID)
			device.Set("revision", 1)
			device.Set("fieldRevisions", map[string]int{
				"name": 1, "platform": 1, "digestEnabled": 1,
				"importantRemindersEnabled": 1, "lastSeenAt": 1,
			})
		} else {
			device.Set("revision", device.GetInt("revision")+1)
		}
		device.Set("name", body.DeviceName)
		device.Set("platform", body.Platform)
		device.Set("digestEnabled", body.DigestEnabled)
		device.Set("importantRemindersEnabled", body.ImportantRemindersEnabled)
		device.Set("lastSeenAt", now.UTC().Format(time.RFC3339Nano))
		if err := transactionApp.Save(device); err != nil {
			return err
		}

		if subscription == nil {
			collection, findErr := transactionApp.FindCollectionByNameOrId("push_subscriptions")
			if findErr != nil {
				return findErr
			}
			subscription = core.NewRecord(collection)
			subscription.Set("user", userID)
			subscription.Set("revision", 1)
			subscription.Set("fieldRevisions", map[string]int{
				"endpoint": 1, "keys": 1, "enabled": 1,
			})
		} else {
			subscription.Set("revision", subscription.GetInt("revision")+1)
		}
		subscription.Set("device", device.Id)
		subscription.Set("endpoint", body.Subscription.Endpoint)
		subscription.Set("keys", map[string]string{
			"p256dh": body.Subscription.Keys.P256DH,
			"auth":   body.Subscription.Keys.Auth,
		})
		subscription.Set("enabled", true)
		if err := transactionApp.Save(subscription); err != nil {
			return err
		}
		state = stateFromDevice(device, true)
		return nil
	})
	return state, err
}

func updatePreferences(app core.App, userID string, body preferencesRequest, now time.Time) (deviceState, error) {
	device, err := findOwnedDevice(app, userID, body.DeviceID)
	if err != nil {
		return deviceState{}, err
	}
	device.Set("digestEnabled", body.DigestEnabled)
	device.Set("importantRemindersEnabled", body.ImportantRemindersEnabled)
	device.Set("lastSeenAt", now.UTC().Format(time.RFC3339Nano))
	device.Set("revision", device.GetInt("revision")+1)
	if err := app.Save(device); err != nil {
		return deviceState{}, err
	}
	enabled, err := hasEnabledSubscription(app, device.Id)
	if err != nil {
		return deviceState{}, err
	}
	return stateFromDevice(device, enabled), nil
}

func unsubscribe(app core.App, userID string, deviceID string, now time.Time) (deviceState, error) {
	device, err := findOwnedDevice(app, userID, deviceID)
	if err != nil {
		return deviceState{}, err
	}
	records, err := app.FindRecordsByFilter(
		"push_subscriptions",
		"user={:user} && device={:device} && deletedAt=''",
		"",
		100,
		0,
		dbx.Params{"user": userID, "device": device.Id},
	)
	if err != nil {
		return deviceState{}, err
	}
	for _, record := range records {
		record.Set("enabled", false)
		record.Set("revision", record.GetInt("revision")+1)
		if err := app.Save(record); err != nil {
			return deviceState{}, err
		}
	}
	device.Set("lastSeenAt", now.UTC().Format(time.RFC3339Nano))
	device.Set("revision", device.GetInt("revision")+1)
	if err := app.Save(device); err != nil {
		return deviceState{}, err
	}
	return stateFromDevice(device, false), nil
}

func loadDeviceState(app core.App, userID string, deviceID string) (deviceState, error) {
	device, err := findOwnedDevice(app, userID, deviceID)
	if err != nil {
		return deviceState{}, err
	}
	enabled, err := hasEnabledSubscription(app, device.Id)
	if err != nil {
		return deviceState{}, err
	}
	return stateFromDevice(device, enabled), nil
}

func findOwnedDevice(app core.App, userID string, deviceID string) (*core.Record, error) {
	if deviceID == "" {
		return nil, sql.ErrNoRows
	}
	return app.FindFirstRecordByFilter(
		"devices",
		"id={:id} && user={:user} && deletedAt=''",
		dbx.Params{"id": deviceID, "user": userID},
	)
}

func hasEnabledSubscription(app core.App, deviceID string) (bool, error) {
	_, err := app.FindFirstRecordByFilter(
		"push_subscriptions",
		"device={:device} && enabled=true && deletedAt=''",
		dbx.Params{"device": deviceID},
	)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func stateFromDevice(device *core.Record, enabled bool) deviceState {
	return deviceState{
		DeviceID:                  device.Id,
		DeviceName:                device.GetString("name"),
		Platform:                  device.GetString("platform"),
		DigestEnabled:             device.GetBool("digestEnabled"),
		ImportantRemindersEnabled: device.GetBool("importantRemindersEnabled"),
		Enabled:                   enabled,
	}
}

func validPlatform(platform string) bool {
	return platform == "web" || platform == "ios-pwa" || platform == "android"
}
