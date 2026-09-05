package sync

import (
	"context"
	"sort"
)

type MemoryStore struct {
	documents map[string]Document
	processed map[string]OperationResult
	changes   []Change
	conflicts []Conflict
	sequence  int64
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		documents: make(map[string]Document),
		processed: make(map[string]OperationResult),
	}
}

func storeKey(parts ...string) string {
	var key string
	for _, part := range parts {
		key += "\x00" + part
	}
	return key
}

func copyMap(source map[string]any) map[string]any {
	result := make(map[string]any, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

func copyRevisions(source map[string]int) map[string]int {
	result := make(map[string]int, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

func copyDocument(document Document) Document {
	document.Fields = copyMap(document.Fields)
	document.FieldRevisions = copyRevisions(document.FieldRevisions)
	return document
}

func (store *MemoryStore) RunInTransaction(_ context.Context, fn func(Store) error) error {
	return fn(store)
}

func (store *MemoryStore) FindProcessed(_ context.Context, userID string, operationID string) (OperationResult, bool, error) {
	result, ok := store.processed[storeKey(userID, operationID)]
	return result, ok, nil
}

func (store *MemoryStore) SaveProcessed(_ context.Context, userID string, result OperationResult) error {
	store.processed[storeKey(userID, result.OperationID)] = result
	return nil
}

func (store *MemoryStore) FindDocument(_ context.Context, userID string, entity string, entityID string) (Document, bool, error) {
	document, ok := store.documents[storeKey(userID, entity, entityID)]
	if !ok {
		return Document{}, false, nil
	}
	return copyDocument(document), true, nil
}

func (store *MemoryStore) SaveDocument(_ context.Context, document Document) error {
	store.documents[storeKey(document.UserID, document.Entity, document.ID)] = copyDocument(document)
	return nil
}

func (store *MemoryStore) NextSequence(_ context.Context) (int64, error) {
	store.sequence++
	return store.sequence, nil
}

func (store *MemoryStore) SaveChange(_ context.Context, change Change) error {
	change.Fields = copyMap(change.Fields)
	store.changes = append(store.changes, change)
	return nil
}

func (store *MemoryStore) SaveConflict(_ context.Context, conflict Conflict) error {
	store.conflicts = append(store.conflicts, conflict)
	return nil
}

func (store *MemoryStore) ListChanges(_ context.Context, userID string, after int64, limit int) ([]Change, bool, error) {
	filtered := make([]Change, 0)
	for _, change := range store.changes {
		if change.UserID == userID && change.Sequence > after {
			filtered = append(filtered, change)
		}
	}
	sort.Slice(filtered, func(left int, right int) bool {
		return filtered[left].Sequence < filtered[right].Sequence
	})
	hasMore := len(filtered) > limit
	if hasMore {
		filtered = filtered[:limit]
	}
	return filtered, hasMore, nil
}

func (store *MemoryStore) ListConflicts(_ context.Context, userID string) ([]Conflict, error) {
	result := make([]Conflict, 0)
	for _, conflict := range store.conflicts {
		if conflict.UserID == userID && conflict.Status == "unresolved" {
			result = append(result, conflict)
		}
	}
	return result, nil
}

func (store *MemoryStore) Document(userID string, entity string, entityID string) (Document, bool) {
	document, ok, _ := store.FindDocument(context.Background(), userID, entity, entityID)
	return document, ok
}

func (store *MemoryStore) Changes() []Change {
	result := make([]Change, len(store.changes))
	copy(result, store.changes)
	return result
}
