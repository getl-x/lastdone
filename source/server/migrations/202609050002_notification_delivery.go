package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("notification_log")
		if err != nil {
			return err
		}
		collection.Fields.Add(
			&core.NumberField{Name: "attempts"},
			&core.TextField{Name: "lastError", Max: 1000},
			&core.DateField{Name: "attemptedAt"},
		)
		collection.CreateRule = nil
		collection.UpdateRule = nil
		collection.DeleteRule = nil
		if err := app.Save(collection); err != nil {
			return err
		}

		subscriptions, err := app.FindCollectionByNameOrId("push_subscriptions")
		if err != nil {
			return err
		}
		subscriptions.CreateRule = nil
		subscriptions.UpdateRule = nil
		subscriptions.DeleteRule = nil
		return app.Save(subscriptions)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("notification_log")
		if err != nil {
			return err
		}
		for _, name := range []string{"attempts", "lastError", "attemptedAt"} {
			field := collection.Fields.GetByName(name)
			if field != nil {
				collection.Fields.RemoveById(field.GetId())
			}
		}
		collection.CreateRule = types.Pointer("@request.body.user = @request.auth.id")
		collection.UpdateRule = types.Pointer(
			"user = @request.auth.id && (@request.body.user:isset = false || @request.body.user = @request.auth.id)",
		)
		collection.DeleteRule = types.Pointer("user = @request.auth.id")
		if err := app.Save(collection); err != nil {
			return err
		}

		subscriptions, err := app.FindCollectionByNameOrId("push_subscriptions")
		if err != nil {
			return err
		}
		subscriptions.CreateRule = types.Pointer("@request.body.user = @request.auth.id")
		subscriptions.UpdateRule = types.Pointer(
			"user = @request.auth.id && (@request.body.user:isset = false || @request.body.user = @request.auth.id)",
		)
		subscriptions.DeleteRule = types.Pointer("user = @request.auth.id")
		return app.Save(subscriptions)
	})
}
