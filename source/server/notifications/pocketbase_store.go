package notifications

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

type PocketBaseDispatchStore struct {
	app core.App
}

const notificationClaimTimeout = 15 * time.Minute

func NewPocketBaseDispatchStore(app core.App) *PocketBaseDispatchStore {
	return &PocketBaseDispatchStore{app: app}
}

func (store *PocketBaseDispatchStore) LoadPlanInputs(_ context.Context) ([]PlanInput, error) {
	settingsRecords, err := store.app.FindRecordsByFilter(
		"user_settings",
		"deletedAt=''",
		"created",
		1000,
		0,
	)
	if err != nil {
		return nil, err
	}

	inputs := make([]PlanInput, 0, len(settingsRecords))
	for _, settingsRecord := range settingsRecords {
		userID := settingsRecord.GetString("user")
		deviceRecords, err := store.app.FindRecordsByFilter(
			"devices",
			"user={:user} && deletedAt=''",
			"created",
			1000,
			0,
			dbx.Params{"user": userID},
		)
		if err != nil {
			return nil, err
		}
		itemRecords, err := store.app.FindRecordsByFilter(
			"items",
			"user={:user} && lifecycle='active' && deletedAt=''",
			"dueDate,name",
			5000,
			0,
			dbx.Params{"user": userID},
		)
		if err != nil {
			return nil, err
		}

		devices := make([]Device, 0, len(deviceRecords))
		for _, record := range deviceRecords {
			devices = append(devices, Device{
				ID:                        record.Id,
				DigestEnabled:             record.GetBool("digestEnabled"),
				ImportantRemindersEnabled: record.GetBool("importantRemindersEnabled"),
			})
		}
		items := make([]Item, 0, len(itemRecords))
		for _, record := range itemRecords {
			offsets := []int{}
			if err := decodeRecordJSON(record.Get("reminderOffsets"), &offsets); err != nil {
				return nil, fmt.Errorf("decode reminder offsets for item %s: %w", record.Id, err)
			}
			items = append(items, Item{
				ID:              record.Id,
				Name:            record.GetString("name"),
				DueDate:         record.GetString("dueDate"),
				Important:       record.GetBool("important"),
				ReminderOffsets: offsets,
				Lifecycle:       record.GetString("lifecycle"),
			})
		}

		inputs = append(inputs, PlanInput{
			UserID: userID,
			Settings: Settings{
				TimeZone:        settingsRecord.GetString("timeZone"),
				DueSoonDays:     settingsRecord.GetInt("dueSoonDays"),
				DigestTime:      settingsRecord.GetString("digestTime"),
				QuietHoursStart: settingsRecord.GetString("quietHoursStart"),
				QuietHoursEnd:   settingsRecord.GetString("quietHoursEnd"),
			},
			Devices: devices,
			Items:   items,
		})
	}

	return inputs, nil
}

func (store *PocketBaseDispatchStore) FindSubscription(_ context.Context, deviceID string) (Subscription, bool, error) {
	record, err := store.app.FindFirstRecordByFilter(
		"push_subscriptions",
		"device={:device} && enabled=true && deletedAt=''",
		dbx.Params{"device": deviceID},
	)
	if errors.Is(err, sql.ErrNoRows) {
		return Subscription{}, false, nil
	}
	if err != nil {
		return Subscription{}, false, err
	}
	keys := struct {
		P256DH string `json:"p256dh"`
		Auth   string `json:"auth"`
	}{}
	if err := decodeRecordJSON(record.Get("keys"), &keys); err != nil {
		return Subscription{}, false, err
	}
	return Subscription{
		ID:       record.Id,
		UserID:   record.GetString("user"),
		DeviceID: record.GetString("device"),
		Endpoint: record.GetString("endpoint"),
		P256DH:   keys.P256DH,
		Auth:     keys.Auth,
		Enabled:  record.GetBool("enabled"),
	}, true, nil
}

func (store *PocketBaseDispatchStore) Claim(_ context.Context, candidate Candidate, attemptedAt time.Time) (bool, error) {
	claimed := false
	err := store.app.RunInTransaction(func(transactionApp core.App) error {
		record, err := transactionApp.FindFirstRecordByFilter(
			"notification_log",
			"identity={:identity}",
			dbx.Params{"identity": candidate.Identity},
		)
		if errors.Is(err, sql.ErrNoRows) {
			collection, findErr := transactionApp.FindCollectionByNameOrId("notification_log")
			if findErr != nil {
				return findErr
			}
			record = core.NewRecord(collection)
			record.Set("user", candidate.UserID)
			record.Set("revision", 1)
			record.Set("fieldRevisions", map[string]int{"status": 1})
			record.Set("identity", candidate.Identity)
			record.Set("device", candidate.DeviceID)
			record.Set("kind", candidate.Kind)
			record.Set("payload", candidate.Payload)
			record.Set("status", "sending")
			record.Set("attempts", 1)
			record.Set("attemptedAt", attemptedAt.UTC().Format(time.RFC3339Nano))
			if saveErr := transactionApp.Save(record); saveErr != nil {
				return saveErr
			}
			claimed = true
			return nil
		}
		if err != nil {
			return err
		}
		status := record.GetString("status")
		if status == "sent" {
			return nil
		}
		if status == "sending" {
			lastAttempt := record.GetDateTime("attemptedAt").Time()
			if !lastAttempt.IsZero() && attemptedAt.Sub(lastAttempt) < notificationClaimTimeout {
				return nil
			}
		}
		record.Set("status", "sending")
		record.Set("attempts", record.GetInt("attempts")+1)
		record.Set("lastError", "")
		record.Set("attemptedAt", attemptedAt.UTC().Format(time.RFC3339Nano))
		record.Set("revision", record.GetInt("revision")+1)
		if saveErr := transactionApp.Save(record); saveErr != nil {
			return saveErr
		}
		claimed = true
		return nil
	})
	return claimed, err
}

func (store *PocketBaseDispatchStore) MarkSent(_ context.Context, identity string, sentAt time.Time) error {
	record, err := store.findLog(identity)
	if err != nil {
		return err
	}
	record.Set("status", "sent")
	record.Set("sentAt", sentAt.UTC().Format(time.RFC3339Nano))
	record.Set("lastError", "")
	record.Set("revision", record.GetInt("revision")+1)
	return store.app.Save(record)
}

func (store *PocketBaseDispatchStore) MarkFailed(_ context.Context, identity string, attemptedAt time.Time, message string) error {
	record, err := store.findLog(identity)
	if err != nil {
		return err
	}
	record.Set("status", "failed")
	record.Set("attemptedAt", attemptedAt.UTC().Format(time.RFC3339Nano))
	record.Set("lastError", message)
	record.Set("revision", record.GetInt("revision")+1)
	return store.app.Save(record)
}

func (store *PocketBaseDispatchStore) DisableSubscription(_ context.Context, subscriptionID string) error {
	record, err := store.app.FindRecordById("push_subscriptions", subscriptionID)
	if err != nil {
		return err
	}
	record.Set("enabled", false)
	record.Set("revision", record.GetInt("revision")+1)
	return store.app.Save(record)
}

func (store *PocketBaseDispatchStore) findLog(identity string) (*core.Record, error) {
	return store.app.FindFirstRecordByFilter(
		"notification_log",
		"identity={:identity}",
		dbx.Params{"identity": identity},
	)
}

func decodeRecordJSON(value any, target any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, target)
}
