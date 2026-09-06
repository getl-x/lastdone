package sync

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

type PocketBaseStore struct {
	app core.App
}

func NewPocketBaseStore(app core.App) *PocketBaseStore {
	return &PocketBaseStore{app: app}
}

func (store *PocketBaseStore) RunInTransaction(ctx context.Context, fn func(Store) error) error {
	return store.app.RunInTransaction(func(transactionApp core.App) error {
		return fn(&PocketBaseStore{app: transactionApp})
	})
}

func (store *PocketBaseStore) FindProcessed(_ context.Context, userID string, operationID string) (OperationResult, bool, error) {
	record, err := store.app.FindFirstRecordByFilter(
		"processed_operations",
		"user={:user} && operationId={:operationId}",
		dbx.Params{"user": userID, "operationId": operationID},
	)
	if errors.Is(err, sql.ErrNoRows) {
		return OperationResult{}, false, nil
	}
	if err != nil {
		return OperationResult{}, false, err
	}

	var result OperationResult
	if err := decodeJSON(record.Get("result"), &result); err != nil {
		return OperationResult{}, false, err
	}
	return result, true, nil
}

func (store *PocketBaseStore) SaveProcessed(_ context.Context, userID string, result OperationResult) error {
	collection, err := store.app.FindCollectionByNameOrId("processed_operations")
	if err != nil {
		return err
	}
	record := core.NewRecord(collection)
	record.Set("user", userID)
	record.Set("revision", 1)
	record.Set("fieldRevisions", map[string]int{"result": 1})
	record.Set("operationId", result.OperationID)
	record.Set("result", result)
	return store.app.Save(record)
}

func collectionName(entity string) (string, error) {
	switch entity {
	case "categories", "items", "completions", "skips", "devices":
		return entity, nil
	case "settings":
		return "user_settings", nil
	default:
		return "", fmt.Errorf("unsupported sync entity %q", entity)
	}
}

func externalFieldName(name string) string {
	switch name {
	case "category":
		return "categoryId"
	case "item":
		return "itemId"
	default:
		return name
	}
}

func internalFieldName(name string) string {
	switch name {
	case "categoryId":
		return "category"
	case "itemId":
		return "item"
	default:
		return name
	}
}

func (store *PocketBaseStore) FindDocument(_ context.Context, userID string, entity string, entityID string) (Document, bool, error) {
	collection, err := collectionName(entity)
	if err != nil {
		return Document{}, false, err
	}
	record, err := store.app.FindRecordById(collection, entityID)
	if errors.Is(err, sql.ErrNoRows) {
		return Document{}, false, nil
	}
	if err != nil {
		return Document{}, false, err
	}
	if record.GetString("user") != userID {
		return Document{}, false, fmt.Errorf("document belongs to another user")
	}

	fields := make(map[string]any)
	for _, field := range record.Collection().Fields {
		name := field.GetName()
		switch name {
		case "id", "user", "revision", "fieldRevisions", "created", "updated":
			continue
		}
		fields[externalFieldName(name)] = record.Get(name)
	}
	fieldRevisions := map[string]int{}
	if err := decodeJSON(record.Get("fieldRevisions"), &fieldRevisions); err != nil {
		return Document{}, false, err
	}

	return Document{
		ID:             entityID,
		UserID:         userID,
		Entity:         entity,
		Revision:       record.GetInt("revision"),
		Fields:         fields,
		FieldRevisions: fieldRevisions,
	}, true, nil
}

func (store *PocketBaseStore) SaveDocument(_ context.Context, document Document) error {
	collectionName, err := collectionName(document.Entity)
	if err != nil {
		return err
	}
	collection, err := store.app.FindCollectionByNameOrId(collectionName)
	if err != nil {
		return err
	}
	record, err := store.app.FindRecordById(collection, document.ID)
	if errors.Is(err, sql.ErrNoRows) {
		record = core.NewRecord(collection)
		record.Id = document.ID
	} else if err != nil {
		return err
	}

	record.Set("user", document.UserID)
	record.Set("revision", document.Revision)
	record.Set("fieldRevisions", document.FieldRevisions)
	for name, value := range document.Fields {
		switch name {
		case "id", "userId", "revision", "fieldRevisions", "createdAt", "updatedAt":
			continue
		}
		record.Set(internalFieldName(name), value)
	}
	return store.app.Save(record)
}

func (store *PocketBaseStore) NextSequence(_ context.Context) (int64, error) {
	var current int64
	err := store.app.DB().NewQuery("SELECT COALESCE(MAX(sequence), 0) FROM sync_changes").Row(&current)
	return current + 1, err
}

func (store *PocketBaseStore) SaveChange(_ context.Context, change Change) error {
	collection, err := store.app.FindCollectionByNameOrId("sync_changes")
	if err != nil {
		return err
	}
	record := core.NewRecord(collection)
	record.Set("user", change.UserID)
	record.Set("revision", 1)
	record.Set("fieldRevisions", map[string]int{"fields": 1})
	record.Set("sequence", change.Sequence)
	record.Set("entity", change.Entity)
	record.Set("entityId", change.EntityID)
	record.Set("action", change.Action)
	record.Set("recordRevision", change.Revision)
	record.Set("fields", change.Fields)
	return store.app.Save(record)
}

func (store *PocketBaseStore) SaveConflict(_ context.Context, conflict Conflict) error {
	collection, err := store.app.FindCollectionByNameOrId("sync_conflicts")
	if err != nil {
		return err
	}
	record := core.NewRecord(collection)
	record.Set("user", conflict.UserID)
	record.Set("revision", 1)
	record.Set("fieldRevisions", map[string]int{"status": 1})
	record.Set("conflictId", conflict.ID)
	record.Set("operationId", conflict.ID[:len(conflict.ID)-len(conflict.Field)-1])
	record.Set("entity", conflict.Entity)
	record.Set("entityId", conflict.EntityID)
	record.Set("field", conflict.Field)
	record.Set("localValue", conflict.LocalValue)
	record.Set("serverValue", conflict.ServerValue)
	record.Set("serverRevision", conflict.ServerRevision)
	record.Set("status", conflict.Status)
	if conflict.ResolvedAt != nil {
		record.Set("resolvedAt", *conflict.ResolvedAt)
	}
	return store.app.Save(record)
}

func (store *PocketBaseStore) FindConflict(_ context.Context, userID string, conflictID string) (Conflict, bool, error) {
	record, err := store.app.FindFirstRecordByFilter(
		"sync_conflicts",
		"user={:user} && conflictId={:conflictId}",
		dbx.Params{"user": userID, "conflictId": conflictID},
	)
	if errors.Is(err, sql.ErrNoRows) {
		return Conflict{}, false, nil
	}
	if err != nil {
		return Conflict{}, false, err
	}
	return conflictFromRecord(record, userID), true, nil
}

func (store *PocketBaseStore) MarkFieldConflictsResolved(_ context.Context, userID string, entity string, entityID string, field string, resolvedAt string) error {
	records, err := store.app.FindRecordsByFilter(
		"sync_conflicts",
		"user={:user} && entity={:entity} && entityId={:entityId} && field={:field} && status='unresolved'",
		"created",
		1000,
		0,
		dbx.Params{
			"user": userID, "entity": entity, "entityId": entityID, "field": field,
		},
	)
	if err != nil {
		return err
	}
	for _, record := range records {
		record.Set("status", "resolved")
		record.Set("resolvedAt", resolvedAt)
		record.Set("revision", record.GetInt("revision")+1)
		if err := store.app.Save(record); err != nil {
			return err
		}
	}
	return nil
}

func (store *PocketBaseStore) ListChanges(_ context.Context, userID string, after int64, limit int) ([]Change, bool, error) {
	records, err := store.app.FindRecordsByFilter(
		"sync_changes",
		"user={:user} && sequence>{:after}",
		"sequence",
		limit+1,
		0,
		dbx.Params{"user": userID, "after": after},
	)
	if err != nil {
		return nil, false, err
	}
	hasMore := len(records) > limit
	if hasMore {
		records = records[:limit]
	}
	changes := make([]Change, 0, len(records))
	for _, record := range records {
		fields := map[string]any{}
		if err := decodeJSON(record.Get("fields"), &fields); err != nil {
			return nil, false, err
		}
		changes = append(changes, Change{
			Sequence: record.GetInt64("sequence"),
			UserID:   userID,
			Entity:   record.GetString("entity"),
			EntityID: record.GetString("entityId"),
			Action:   record.GetString("action"),
			Revision: record.GetInt("recordRevision"),
			Fields:   fields,
		})
	}
	return changes, hasMore, nil
}

func (store *PocketBaseStore) ListConflicts(_ context.Context, userID string, limit int) ([]Conflict, error) {
	records, err := store.app.FindRecordsByFilter(
		"sync_conflicts",
		"user={:user}",
		"-status,-created",
		limit,
		0,
		dbx.Params{"user": userID},
	)
	if err != nil {
		return nil, err
	}
	conflicts := make([]Conflict, 0, len(records))
	for _, record := range records {
		conflicts = append(conflicts, conflictFromRecord(record, userID))
	}
	return conflicts, nil
}

func conflictFromRecord(record *core.Record, userID string) Conflict {
	var resolvedAt *string
	if value := record.GetString("resolvedAt"); value != "" {
		resolvedAt = &value
	}
	return Conflict{
		ID:             record.GetString("conflictId"),
		UserID:         userID,
		Entity:         record.GetString("entity"),
		EntityID:       record.GetString("entityId"),
		Field:          record.GetString("field"),
		LocalValue:     record.Get("localValue"),
		ServerValue:    record.Get("serverValue"),
		ServerRevision: record.GetInt("serverRevision"),
		Status:         record.GetString("status"),
		CreatedAt:      record.GetString("created"),
		ResolvedAt:     resolvedAt,
	}
}

func decodeJSON(value any, target any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, target)
}
