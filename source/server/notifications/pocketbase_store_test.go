package notifications

import (
	"context"
	"testing"
	"time"

	_ "github.com/getl-x/lastdone/source/server/migrations"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

func newNotificationTestApp(t *testing.T) *pocketbase.PocketBase {
	t.Helper()
	application := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: t.TempDir()})
	if err := application.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { application.ResetBootstrapState() })
	runner := core.NewMigrationsRunner(application, core.AppMigrations)
	if _, err := runner.Up(); err != nil {
		t.Fatal(err)
	}
	return application
}

func saveOwnedRecord(
	t testing.TB,
	application core.App,
	collectionName string,
	id string,
	userID string,
	fields map[string]any,
) *core.Record {
	t.Helper()
	collection, err := application.FindCollectionByNameOrId(collectionName)
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(collection)
	if id != "" {
		record.Id = id
	}
	record.Set("user", userID)
	record.Set("revision", 1)
	record.Set("fieldRevisions", map[string]int{"seed": 1})
	for name, value := range fields {
		record.Set(name, value)
	}
	if err := application.Save(record); err != nil {
		t.Fatal(err)
	}
	return record
}

func seedNotificationRecords(t *testing.T, application core.App) (string, string) {
	t.Helper()
	users, err := application.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	user := core.NewRecord(users)
	user.Id = "testuser0000001"
	user.Set("username", "test-user")
	user.SetPassword("correct-horse-battery-staple")
	if err := application.Save(user); err != nil {
		t.Fatal(err)
	}

	category := saveOwnedRecord(t, application, "categories", "category0000001", user.Id, map[string]any{
		"name": "家居", "icon": "house", "color": "#B57B46", "displayOrder": 1, "lifecycle": "active",
	})
	saveOwnedRecord(t, application, "user_settings", "settings0000001", user.Id, map[string]any{
		"timeZone": "Asia/Shanghai", "dueSoonDays": 7, "digestTime": "09:00",
		"quietHoursStart": "22:00", "quietHoursEnd": "08:00",
	})
	device := saveOwnedRecord(t, application, "devices", "device000000001", user.Id, map[string]any{
		"name": "iPhone", "platform": "ios-pwa", "digestEnabled": true,
		"importantRemindersEnabled": true, "lastSeenAt": "2026-09-05T00:00:00Z",
	})
	saveOwnedRecord(t, application, "items", "item00000000001", user.Id, map[string]any{
		"name": "更换滤芯", "category": category.Id,
		"schedule": map[string]any{"type": "relative", "every": 90, "unit": "days"},
		"dueDate":  "2026-09-12", "important": true, "reminderOffsets": []int{7, 1, 0},
		"lifecycle": "active",
	})
	subscription := saveOwnedRecord(t, application, "push_subscriptions", "pushsub00000001", user.Id, map[string]any{
		"device": device.Id, "endpoint": "https://push.example/subscription-1",
		"keys": map[string]string{"p256dh": "public-key", "auth": "auth-secret"}, "enabled": true,
	})
	return user.Id, subscription.Id
}

func TestPocketBaseDispatchStoreLoadsInputsAndSubscription(t *testing.T) {
	application := newNotificationTestApp(t)
	userID, _ := seedNotificationRecords(t, application)
	store := NewPocketBaseDispatchStore(application)

	inputs, err := store.LoadPlanInputs(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(inputs) != 1 || inputs[0].UserID != userID || len(inputs[0].Items) != 1 || len(inputs[0].Devices) != 1 {
		t.Fatalf("unexpected inputs %#v", inputs)
	}
	if inputs[0].Items[0].ReminderOffsets[0] != 7 {
		t.Fatalf("unexpected reminder offsets %#v", inputs[0].Items[0].ReminderOffsets)
	}

	subscription, found, err := store.FindSubscription(context.Background(), "device000000001")
	if err != nil {
		t.Fatal(err)
	}
	if !found || subscription.P256DH != "public-key" || subscription.Auth != "auth-secret" {
		t.Fatalf("unexpected subscription %#v", subscription)
	}
}

func TestPocketBaseDispatchStoreClaimsAndRetriesAtomically(t *testing.T) {
	application := newNotificationTestApp(t)
	userID, subscriptionID := seedNotificationRecords(t, application)
	store := NewPocketBaseDispatchStore(application)
	now := fixedTime(t, "2026-09-05T01:00:00Z")
	candidate := Candidate{
		Identity: "identity-1", UserID: userID, DeviceID: "device000000001",
		Kind: KindImportant, DeliverAt: now, Payload: Payload{Title: "更换滤芯"},
	}

	claimed, err := store.Claim(context.Background(), candidate, now)
	if err != nil || !claimed {
		t.Fatalf("expected first claim, claimed=%v err=%v", claimed, err)
	}
	claimed, err = store.Claim(context.Background(), candidate, now)
	if err != nil || claimed {
		t.Fatalf("expected active claim to be skipped, claimed=%v err=%v", claimed, err)
	}
	claimed, err = store.Claim(context.Background(), candidate, now.Add(16*time.Minute))
	if err != nil || !claimed {
		t.Fatalf("expected stale claim to be recoverable, claimed=%v err=%v", claimed, err)
	}
	if err := store.MarkFailed(context.Background(), candidate.Identity, now.Add(16*time.Minute), "temporary"); err != nil {
		t.Fatal(err)
	}
	claimed, err = store.Claim(context.Background(), candidate, now.Add(17*time.Minute))
	if err != nil || !claimed {
		t.Fatalf("expected failed delivery to be retryable, claimed=%v err=%v", claimed, err)
	}
	if err := store.MarkSent(context.Background(), candidate.Identity, now.Add(17*time.Minute)); err != nil {
		t.Fatal(err)
	}
	claimed, err = store.Claim(context.Background(), candidate, now.Add(18*time.Minute))
	if err != nil || claimed {
		t.Fatalf("expected sent delivery to remain deduplicated, claimed=%v err=%v", claimed, err)
	}

	log, err := application.FindFirstRecordByFilter("notification_log", "identity='identity-1'")
	if err != nil {
		t.Fatal(err)
	}
	if log.GetString("status") != "sent" || log.GetInt("attempts") != 3 || log.GetString("lastError") != "" {
		t.Fatalf("unexpected notification log %#v", log)
	}

	if err := store.DisableSubscription(context.Background(), subscriptionID); err != nil {
		t.Fatal(err)
	}
	subscription, err := application.FindRecordById("push_subscriptions", subscriptionID)
	if err != nil {
		t.Fatal(err)
	}
	if subscription.GetBool("enabled") {
		t.Fatal("expected subscription to be disabled")
	}
}
