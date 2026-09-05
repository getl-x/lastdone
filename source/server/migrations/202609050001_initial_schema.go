package migrations

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

var collectionNames = []string{
	"categories",
	"items",
	"completions",
	"skips",
	"devices",
	"user_settings",
	"push_subscriptions",
	"notification_log",
	"sync_changes",
	"processed_operations",
	"sync_conflicts",
}

func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if errors.Is(err, sql.ErrNoRows) {
			users = core.NewAuthCollection("users")
		} else if err != nil {
			return err
		}

		users.ListRule = types.Pointer("id = @request.auth.id")
		users.ViewRule = types.Pointer("id = @request.auth.id")
		users.UpdateRule = types.Pointer("id = @request.auth.id")
		users.DeleteRule = nil
		users.CreateRule = nil
		users.PasswordAuth.Enabled = true
		users.PasswordAuth.IdentityFields = []string{"username"}
		if users.Fields.GetByName("username") == nil {
			users.Fields.Add(&core.TextField{
				Name:        "username",
				Required:    true,
				Min:         3,
				Max:         64,
				Pattern:     `^[a-zA-Z0-9._-]+$`,
				Presentable: true,
			})
		}
		if email, ok := users.Fields.GetByName("email").(*core.EmailField); ok {
			email.Required = false
		}
		users.AddIndex("idx_users_username", true, "username", "")
		if err := app.Save(users); err != nil {
			return err
		}

		saveCollection := func(collection *core.Collection) error {
			if err := app.Save(collection); err != nil {
				return fmt.Errorf("save collection %s: %w", collection.Name, err)
			}
			return nil
		}

		categories := newCategoriesCollection(users)
		if err := saveCollection(categories); err != nil {
			return err
		}
		items := newItemsCollection(users, categories)
		if err := saveCollection(items); err != nil {
			return err
		}
		if err := saveCollection(newCompletionsCollection(users, items)); err != nil {
			return err
		}
		if err := saveCollection(newSkipsCollection(users, items)); err != nil {
			return err
		}
		devices := newDevicesCollection(users)
		if err := saveCollection(devices); err != nil {
			return err
		}
		for _, collection := range []*core.Collection{
			newSettingsCollection(users),
			newPushSubscriptionsCollection(users, devices),
			newNotificationLogCollection(users, devices),
			newSyncChangesCollection(users),
			newProcessedOperationsCollection(users),
			newSyncConflictsCollection(users),
		} {
			if err := saveCollection(collection); err != nil {
				return err
			}
		}

		return nil
	}, func(app core.App) error {
		for index := len(collectionNames) - 1; index >= 0; index-- {
			collection, err := app.FindCollectionByNameOrId(collectionNames[index])
			if err != nil {
				continue
			}
			if err := app.Delete(collection); err != nil {
				return err
			}
		}
		return nil
	})
}

func newOwnedCollection(name string, users *core.Collection) *core.Collection {
	collection := core.NewBaseCollection(name)
	collection.ListRule = types.Pointer("user = @request.auth.id")
	collection.ViewRule = types.Pointer("user = @request.auth.id")
	collection.CreateRule = types.Pointer("@request.body.user = @request.auth.id")
	collection.UpdateRule = types.Pointer(
		"user = @request.auth.id && (@request.body.user:isset = false || @request.body.user = @request.auth.id)",
	)
	collection.DeleteRule = types.Pointer("user = @request.auth.id")
	collection.Fields.Add(
		&core.RelationField{
			Name:          "user",
			Required:      true,
			MaxSelect:     1,
			CascadeDelete: true,
			CollectionId:  users.Id,
		},
		&core.NumberField{Name: "revision", Required: true},
		&core.DateField{Name: "deletedAt"},
		&core.AutodateField{Name: "created", OnCreate: true},
		&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
	)
	collection.AddIndex("idx_"+name+"_user", false, "user", "")

	return collection
}

func localDateField(name string, required bool) *core.TextField {
	return &core.TextField{
		Name:     name,
		Required: required,
		Min:      10,
		Max:      10,
		Pattern:  `^\d{4}-\d{2}-\d{2}$`,
	}
}

func newCategoriesCollection(users *core.Collection) *core.Collection {
	collection := newOwnedCollection("categories", users)
	collection.Fields.Add(
		&core.TextField{Name: "name", Required: true, Max: 100},
		&core.TextField{Name: "icon", Required: true, Max: 64},
		&core.TextField{Name: "color", Required: true, Max: 16},
		&core.NumberField{Name: "displayOrder", Required: true},
		&core.SelectField{
			Name:      "lifecycle",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"active", "archived"},
		},
	)
	collection.AddIndex("idx_categories_user_order", false, "user, displayOrder", "")
	return collection
}

func newItemsCollection(users *core.Collection, categories *core.Collection) *core.Collection {
	collection := newOwnedCollection("items", users)
	collection.Fields.Add(
		&core.TextField{Name: "name", Required: true, Max: 200},
		&core.RelationField{
			Name:          "category",
			Required:      true,
			MaxSelect:     1,
			CascadeDelete: false,
			CollectionId:  categories.Id,
		},
		&core.JSONField{Name: "schedule", Required: true, MaxSize: 4096},
		localDateField("initialDueDate", false),
		localDateField("dueDate", false),
		localDateField("lastCompletedDate", false),
		&core.TextField{Name: "lastCompletionId", Max: 32},
		&core.BoolField{Name: "important"},
		&core.JSONField{Name: "reminderOffsets", MaxSize: 2048},
		&core.SelectField{
			Name:      "lifecycle",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"active", "paused", "archived"},
		},
	)
	collection.AddIndex("idx_items_user_due", false, "user, dueDate", "")
	collection.AddIndex("idx_items_user_category", false, "user, category", "")
	return collection
}

func newCompletionsCollection(users *core.Collection, items *core.Collection) *core.Collection {
	collection := newOwnedCollection("completions", users)
	collection.Fields.Add(
		&core.RelationField{
			Name:          "item",
			Required:      true,
			MaxSelect:     1,
			CascadeDelete: true,
			CollectionId:  items.Id,
		},
		&core.DateField{Name: "completedAt", Required: true},
		localDateField("localDate", true),
		&core.TextField{Name: "note", Max: 500},
	)
	collection.AddIndex("idx_completions_item_time", false, "item, completedAt", "")
	return collection
}

func newSkipsCollection(users *core.Collection, items *core.Collection) *core.Collection {
	collection := newOwnedCollection("skips", users)
	collection.Fields.Add(
		&core.RelationField{
			Name:          "item",
			Required:      true,
			MaxSelect:     1,
			CascadeDelete: true,
			CollectionId:  items.Id,
		},
		localDateField("occurrenceDate", true),
		&core.TextField{Name: "note", Max: 500},
	)
	collection.AddIndex("idx_skips_item_occurrence", true, "item, occurrenceDate", "deletedAt = ''")
	return collection
}

func newDevicesCollection(users *core.Collection) *core.Collection {
	collection := newOwnedCollection("devices", users)
	collection.Fields.Add(
		&core.TextField{Name: "name", Required: true, Max: 100},
		&core.SelectField{
			Name:      "platform",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"web", "ios-pwa", "android"},
		},
		&core.BoolField{Name: "digestEnabled"},
		&core.BoolField{Name: "importantRemindersEnabled"},
		&core.DateField{Name: "lastSeenAt", Required: true},
	)
	return collection
}

func newSettingsCollection(users *core.Collection) *core.Collection {
	collection := newOwnedCollection("user_settings", users)
	collection.Fields.Add(
		&core.TextField{Name: "timeZone", Required: true, Max: 100},
		&core.NumberField{Name: "dueSoonDays", Required: true},
		&core.TextField{Name: "digestTime", Required: true, Max: 5},
		&core.TextField{Name: "quietHoursStart", Required: true, Max: 5},
		&core.TextField{Name: "quietHoursEnd", Required: true, Max: 5},
	)
	collection.AddIndex("idx_user_settings_user", true, "user", "")
	return collection
}

func newPushSubscriptionsCollection(users *core.Collection, devices *core.Collection) *core.Collection {
	collection := newOwnedCollection("push_subscriptions", users)
	collection.Fields.Add(
		&core.RelationField{
			Name:          "device",
			Required:      true,
			MaxSelect:     1,
			CascadeDelete: true,
			CollectionId:  devices.Id,
		},
		&core.TextField{Name: "endpoint", Required: true, Max: 2048},
		&core.JSONField{Name: "keys", Required: true, MaxSize: 4096},
		&core.BoolField{Name: "enabled"},
	)
	collection.AddIndex("idx_push_subscriptions_endpoint", true, "endpoint", "deletedAt = ''")
	return collection
}

func newNotificationLogCollection(users *core.Collection, devices *core.Collection) *core.Collection {
	collection := newOwnedCollection("notification_log", users)
	collection.Fields.Add(
		&core.TextField{Name: "identity", Required: true, Max: 255},
		&core.RelationField{
			Name:          "device",
			Required:      true,
			MaxSelect:     1,
			CascadeDelete: true,
			CollectionId:  devices.Id,
		},
		&core.TextField{Name: "kind", Required: true, Max: 32},
		&core.JSONField{Name: "payload", MaxSize: 8192},
		&core.DateField{Name: "sentAt"},
		&core.TextField{Name: "status", Required: true, Max: 32},
	)
	collection.AddIndex("idx_notification_log_identity", true, "identity", "")
	return collection
}

func newSyncChangesCollection(users *core.Collection) *core.Collection {
	collection := newOwnedCollection("sync_changes", users)
	collection.ListRule = nil
	collection.ViewRule = nil
	collection.CreateRule = nil
	collection.UpdateRule = nil
	collection.DeleteRule = nil
	collection.Fields.Add(
		&core.NumberField{Name: "sequence", Required: true},
		&core.TextField{Name: "entity", Required: true, Max: 64},
		&core.TextField{Name: "entityId", Required: true, Max: 32},
		&core.JSONField{Name: "fields", MaxSize: 65536},
	)
	collection.AddIndex("idx_sync_changes_sequence", true, "sequence", "")
	collection.AddIndex("idx_sync_changes_user_sequence", false, "user, sequence", "")
	return collection
}

func newProcessedOperationsCollection(users *core.Collection) *core.Collection {
	collection := newOwnedCollection("processed_operations", users)
	collection.ListRule = nil
	collection.ViewRule = nil
	collection.CreateRule = nil
	collection.UpdateRule = nil
	collection.DeleteRule = nil
	collection.Fields.Add(
		&core.TextField{Name: "operationId", Required: true, Max: 64},
		&core.JSONField{Name: "result", Required: true, MaxSize: 65536},
	)
	collection.AddIndex("idx_processed_operations_id", true, "user, operationId", "")
	return collection
}

func newSyncConflictsCollection(users *core.Collection) *core.Collection {
	collection := newOwnedCollection("sync_conflicts", users)
	collection.Fields.Add(
		&core.TextField{Name: "operationId", Required: true, Max: 64},
		&core.TextField{Name: "entity", Required: true, Max: 64},
		&core.TextField{Name: "entityId", Required: true, Max: 32},
		&core.TextField{Name: "field", Required: true, Max: 100},
		&core.JSONField{Name: "localValue", MaxSize: 65536},
		&core.JSONField{Name: "serverValue", MaxSize: 65536},
		&core.NumberField{Name: "serverRevision", Required: true},
		&core.SelectField{
			Name:      "status",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"unresolved", "resolved"},
		},
		&core.DateField{Name: "resolvedAt"},
	)
	return collection
}
