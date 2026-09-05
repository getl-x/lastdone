package sync

import (
	"context"
	"testing"

	_ "github.com/getl-x/lastdone/source/server/migrations"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

func TestPocketBaseStorePersistsOperationAndChangeAtomically(t *testing.T) {
	application := pocketbase.NewWithConfig(pocketbase.Config{
		DefaultDataDir: t.TempDir(),
	})
	if err := application.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	defer application.ResetBootstrapState()

	runner := core.NewMigrationsRunner(application, core.AppMigrations)
	if _, err := runner.Up(); err != nil {
		t.Fatal(err)
	}

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

	service := NewService(NewPocketBaseStore(application))
	operation := Operation{
		ID:           "01990101-1111-7111-8111-111111111111",
		Entity:       "categories",
		EntityID:     "category0000001",
		Action:       "create",
		BaseRevision: 0,
		Fields: map[string]any{
			"name":         "家居",
			"icon":         "house",
			"color":        "#B57B46",
			"displayOrder": 1,
			"lifecycle":    "active",
			"deletedAt":    nil,
		},
		CreatedAt: "2026-09-06T01:00:00.000Z",
	}

	if _, err := service.Push(context.Background(), user.Id, []Operation{operation}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Push(context.Background(), user.Id, []Operation{operation}); err != nil {
		t.Fatal(err)
	}

	category, err := application.FindRecordById("categories", operation.EntityID)
	if err != nil {
		t.Fatal(err)
	}
	if category.GetString("name") != "家居" || category.GetInt("revision") != 1 {
		t.Fatalf("unexpected category: %#v", category)
	}

	processedCount, err := application.CountRecords("processed_operations")
	if err != nil {
		t.Fatal(err)
	}
	changeCount, err := application.CountRecords("sync_changes")
	if err != nil {
		t.Fatal(err)
	}
	if processedCount != 1 || changeCount != 1 {
		t.Fatalf("expected one processed operation and one change, got %d and %d", processedCount, changeCount)
	}
}
