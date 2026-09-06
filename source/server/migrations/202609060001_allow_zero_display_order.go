package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		return setDisplayOrderRequired(app, false)
	}, func(app core.App) error {
		return setDisplayOrderRequired(app, true)
	})
}

func setDisplayOrderRequired(app core.App, required bool) error {
	collection, err := app.FindCollectionByNameOrId("categories")
	if err != nil {
		return err
	}
	field, ok := collection.Fields.GetByName("displayOrder").(*core.NumberField)
	if !ok {
		return fmt.Errorf("categories.displayOrder is not a number field")
	}
	field.Required = required
	return app.Save(collection)
}
