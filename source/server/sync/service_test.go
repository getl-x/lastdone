package sync

import (
	"context"
	"testing"
)

func TestPushIsIdempotent(t *testing.T) {
	store := NewMemoryStore()
	service := NewService(store)
	operation := Operation{
		ID:           "operation-1",
		Entity:       "items",
		EntityID:     "item-1",
		Action:       "create",
		BaseRevision: 0,
		Fields:       map[string]any{"name": "更换滤芯", "important": false},
		CreatedAt:    "2026-09-06T01:00:00.000Z",
	}

	first, err := service.Push(context.Background(), "user-1", []Operation{operation})
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.Push(context.Background(), "user-1", []Operation{operation})
	if err != nil {
		t.Fatal(err)
	}

	if len(first.AppliedOperationIDs) != 1 || len(second.AppliedOperationIDs) != 1 {
		t.Fatalf("operation was not acknowledged on replay: %#v %#v", first, second)
	}
	if len(store.Changes()) != 1 {
		t.Fatalf("replay created duplicate changes: %#v", store.Changes())
	}
}

func TestDisjointPatchesMergeAndSameFieldConflicts(t *testing.T) {
	store := NewMemoryStore()
	service := NewService(store)
	create := Operation{
		ID:           "create-item",
		Entity:       "items",
		EntityID:     "item-1",
		Action:       "create",
		BaseRevision: 0,
		Fields:       map[string]any{"name": "原名称", "important": false},
		CreatedAt:    "2026-09-06T01:00:00.000Z",
	}
	if _, err := service.Push(context.Background(), "user-1", []Operation{create}); err != nil {
		t.Fatal(err)
	}

	operations := []Operation{
		{
			ID:           "rename",
			Entity:       "items",
			EntityID:     "item-1",
			Action:       "update",
			BaseRevision: 1,
			Fields:       map[string]any{"name": "新名称"},
			CreatedAt:    "2026-09-06T01:00:01.000Z",
		},
		{
			ID:           "make-important",
			Entity:       "items",
			EntityID:     "item-1",
			Action:       "update",
			BaseRevision: 1,
			Fields:       map[string]any{"important": true},
			CreatedAt:    "2026-09-06T01:00:02.000Z",
		},
	}
	response, err := service.Push(context.Background(), "user-1", operations)
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Conflicts) != 0 {
		t.Fatalf("disjoint patches conflicted: %#v", response.Conflicts)
	}

	document, ok := store.Document("user-1", "items", "item-1")
	if !ok {
		t.Fatal("item was not stored")
	}
	if document.Fields["name"] != "新名称" || document.Fields["important"] != true {
		t.Fatalf("disjoint patches were not merged: %#v", document.Fields)
	}

	conflicting, err := service.Push(context.Background(), "user-1", []Operation{{
		ID:           "stale-rename",
		Entity:       "items",
		EntityID:     "item-1",
		Action:       "update",
		BaseRevision: 1,
		Fields:       map[string]any{"name": "过时名称"},
		CreatedAt:    "2026-09-06T01:00:03.000Z",
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(conflicting.Conflicts) != 1 || conflicting.Conflicts[0].Field != "name" {
		t.Fatalf("expected a name conflict: %#v", conflicting.Conflicts)
	}
	if document, _ = store.Document("user-1", "items", "item-1"); document.Fields["name"] != "新名称" {
		t.Fatalf("stale value overwrote current value: %#v", document.Fields)
	}
}

func TestIndependentCompletionsBothSurvive(t *testing.T) {
	store := NewMemoryStore()
	service := NewService(store)
	operations := []Operation{
		{
			ID:           "completion-operation-a",
			Entity:       "completions",
			EntityID:     "completion-a",
			Action:       "create",
			BaseRevision: 0,
			Fields:       map[string]any{"item": "item-1", "localDate": "2026-09-05"},
			CreatedAt:    "2026-09-06T01:00:00.000Z",
		},
		{
			ID:           "completion-operation-b",
			Entity:       "completions",
			EntityID:     "completion-b",
			Action:       "create",
			BaseRevision: 0,
			Fields:       map[string]any{"item": "item-1", "localDate": "2026-09-06"},
			CreatedAt:    "2026-09-06T01:00:01.000Z",
		},
	}

	if _, err := service.Push(context.Background(), "user-1", operations); err != nil {
		t.Fatal(err)
	}
	if _, ok := store.Document("user-1", "completions", "completion-a"); !ok {
		t.Fatal("first completion is missing")
	}
	if _, ok := store.Document("user-1", "completions", "completion-b"); !ok {
		t.Fatal("second completion is missing")
	}
}

func TestPullUsesMonotonicCursorAndLimit(t *testing.T) {
	store := NewMemoryStore()
	service := NewService(store)
	for index := 1; index <= 3; index++ {
		_, err := service.Push(context.Background(), "user-1", []Operation{{
			ID:           "operation-" + string(rune('0'+index)),
			Entity:       "categories",
			EntityID:     "category-" + string(rune('0'+index)),
			Action:       "create",
			BaseRevision: 0,
			Fields:       map[string]any{"name": index},
			CreatedAt:    "2026-09-06T01:00:00.000Z",
		}})
		if err != nil {
			t.Fatal(err)
		}
	}

	first, err := service.Pull(context.Background(), "user-1", 0, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Changes) != 2 || !first.HasMore || first.NextSequence != 2 {
		t.Fatalf("unexpected first page: %#v", first)
	}
	second, err := service.Pull(context.Background(), "user-1", first.NextSequence, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Changes) != 1 || second.HasMore || second.NextSequence != 3 {
		t.Fatalf("unexpected second page: %#v", second)
	}
}
