package sync

import (
	"context"
	"fmt"
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

func TestRepeatedCreateMergesInsteadOfBlockingSync(t *testing.T) {
	store := NewMemoryStore()
	service := NewService(store)
	ctx := context.Background()

	_, err := service.Push(ctx, "user-1", []Operation{{
		ID:           "create-settings-device-a",
		Entity:       "settings",
		EntityID:     "user-1",
		Action:       "create",
		BaseRevision: 0,
		CreatedAt:    "2026-09-06T08:00:00Z",
		Fields: map[string]any{
			"id":          "user-1",
			"userId":      "user-1",
			"revision":    0,
			"createdAt":   "2026-09-06T08:00:00Z",
			"updatedAt":   "2026-09-06T08:00:00Z",
			"timeZone":    "Asia/Shanghai",
			"dueSoonDays": 7,
		},
	}})
	if err != nil {
		t.Fatalf("first create failed: %v", err)
	}

	repeated, err := service.Push(ctx, "user-1", []Operation{{
		ID:           "create-settings-device-b",
		Entity:       "settings",
		EntityID:     "user-1",
		Action:       "create",
		BaseRevision: 0,
		CreatedAt:    "2026-09-06T08:01:00Z",
		Fields: map[string]any{
			"id":          "user-1",
			"userId":      "user-1",
			"revision":    0,
			"createdAt":   "2026-09-06T08:01:00Z",
			"updatedAt":   "2026-09-06T08:01:00Z",
			"timeZone":    "Asia/Shanghai",
			"dueSoonDays": 14,
		},
	}})
	if err != nil {
		t.Fatalf("repeated create failed: %v", err)
	}
	if len(repeated.Conflicts) != 1 || repeated.Conflicts[0].Field != "dueSoonDays" {
		t.Fatalf("expected only the changed field to conflict: %#v", repeated.Conflicts)
	}
}

func TestConflictCanKeepLocalOrServerValue(t *testing.T) {
	for _, choice := range []string{"local", "server"} {
		t.Run(choice, func(t *testing.T) {
			store := NewMemoryStore()
			service := NewService(store)
			ctx := context.Background()
			_, err := service.Push(ctx, "user-1", []Operation{{
				ID:           "create-item",
				Entity:       "items",
				EntityID:     "item-1",
				Action:       "create",
				BaseRevision: 0,
				CreatedAt:    "2026-09-06T08:00:00Z",
				Fields:       map[string]any{"name": "初始名称"},
			}})
			if err != nil {
				t.Fatal(err)
			}
			_, err = service.Push(ctx, "user-1", []Operation{
				{
					ID:           "rename-server",
					Entity:       "items",
					EntityID:     "item-1",
					Action:       "update",
					BaseRevision: 1,
					CreatedAt:    "2026-09-06T08:01:00Z",
					Fields:       map[string]any{"name": "服务器名称"},
				},
				{
					ID:           "rename-local",
					Entity:       "items",
					EntityID:     "item-1",
					Action:       "update",
					BaseRevision: 1,
					CreatedAt:    "2026-09-06T08:02:00Z",
					Fields:       map[string]any{"name": "本机名称"},
				},
			})
			if err != nil {
				t.Fatal(err)
			}

			resolved, err := service.ResolveConflict(
				ctx,
				"user-1",
				"rename-local:name",
				choice,
				"2026-09-06T08:03:00Z",
			)
			if err != nil {
				t.Fatal(err)
			}
			if resolved.Status != "resolved" {
				t.Fatalf("conflict was not resolved: %#v", resolved)
			}
			if resolved.ResolvedAt == nil || *resolved.ResolvedAt != "2026-09-06T08:03:00Z" {
				t.Fatalf("conflict resolution time is missing: %#v", resolved)
			}
			document, _ := store.Document("user-1", "items", "item-1")
			expected := "服务器名称"
			if choice == "local" {
				expected = "本机名称"
			}
			if document.Fields["name"] != expected {
				t.Fatalf("unexpected resolved value: %#v", document.Fields)
			}
			if document.Revision != 3 {
				t.Fatalf("resolution did not create a new revision: %#v", document)
			}
			changes := store.Changes()
			resolution := changes[len(changes)-1]
			if resolution.Fields["name"] != expected {
				t.Fatalf("resolved value was not published: %#v", resolution)
			}
			if resolution.Fields["updatedAt"] != "2026-09-06T08:03:00Z" {
				t.Fatalf("resolution timestamp was not published: %#v", resolution)
			}
			pulled, err := service.Pull(ctx, "user-1", 0, 500)
			if err != nil {
				t.Fatal(err)
			}
			foundResolved := false
			for _, conflict := range pulled.Conflicts {
				if conflict.ID == "rename-local:name" && conflict.Status == "resolved" {
					foundResolved = true
				}
			}
			if !foundResolved {
				t.Fatalf("resolved conflict was not propagated: %#v", pulled.Conflicts)
			}
		})
	}
}

func TestNewerSuccessfulFieldUpdateSupersedesAnOlderConflict(t *testing.T) {
	store := NewMemoryStore()
	service := NewService(store)
	ctx := context.Background()
	_, err := service.Push(ctx, "user-1", []Operation{
		{
			ID:           "create-item",
			Entity:       "items",
			EntityID:     "item-1",
			Action:       "create",
			BaseRevision: 0,
			CreatedAt:    "2026-09-06T08:00:00Z",
			Fields:       map[string]any{"name": "初始名称"},
		},
		{
			ID:           "server-rename",
			Entity:       "items",
			EntityID:     "item-1",
			Action:       "update",
			BaseRevision: 1,
			CreatedAt:    "2026-09-06T08:01:00Z",
			Fields:       map[string]any{"name": "服务器名称"},
		},
		{
			ID:           "stale-local-rename",
			Entity:       "items",
			EntityID:     "item-1",
			Action:       "update",
			BaseRevision: 1,
			CreatedAt:    "2026-09-06T08:02:00Z",
			Fields:       map[string]any{"name": "旧本机名称"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	_, err = service.Push(ctx, "user-1", []Operation{{
		ID:           "new-local-rename",
		Entity:       "items",
		EntityID:     "item-1",
		Action:       "update",
		BaseRevision: 2,
		CreatedAt:    "2026-09-06T08:03:00Z",
		Fields:       map[string]any{"name": "最新名称"},
	}})
	if err != nil {
		t.Fatal(err)
	}

	document, _ := store.Document("user-1", "items", "item-1")
	if document.Fields["name"] != "最新名称" {
		t.Fatalf("newer value was not applied: %#v", document)
	}
	conflict, found, err := store.FindConflict(ctx, "user-1", "stale-local-rename:name")
	if err != nil || !found {
		t.Fatalf("older conflict is missing: found=%v err=%v", found, err)
	}
	if conflict.Status != "resolved" || conflict.ResolvedAt == nil {
		t.Fatalf("older conflict was not superseded: %#v", conflict)
	}
}

func TestMatchingServerValueSupersedesAnOlderConflictWithoutANewRevision(t *testing.T) {
	store := NewMemoryStore()
	service := NewService(store)
	ctx := context.Background()
	_, err := service.Push(ctx, "user-1", []Operation{
		{
			ID:           "create-item",
			Entity:       "items",
			EntityID:     "item-1",
			Action:       "create",
			BaseRevision: 0,
			CreatedAt:    "2026-09-06T08:00:00Z",
			Fields:       map[string]any{"name": "初始名称"},
		},
		{
			ID:           "server-rename",
			Entity:       "items",
			EntityID:     "item-1",
			Action:       "update",
			BaseRevision: 1,
			CreatedAt:    "2026-09-06T08:01:00Z",
			Fields:       map[string]any{"name": "服务器名称"},
		},
		{
			ID:           "stale-local-rename",
			Entity:       "items",
			EntityID:     "item-1",
			Action:       "update",
			BaseRevision: 1,
			CreatedAt:    "2026-09-06T08:02:00Z",
			Fields:       map[string]any{"name": "旧本机名称"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	_, err = service.Push(ctx, "user-1", []Operation{{
		ID:           "accept-server-name",
		Entity:       "items",
		EntityID:     "item-1",
		Action:       "update",
		BaseRevision: 1,
		CreatedAt:    "2026-09-06T08:03:00Z",
		Fields:       map[string]any{"name": "服务器名称"},
	}})
	if err != nil {
		t.Fatal(err)
	}

	document, _ := store.Document("user-1", "items", "item-1")
	if document.Revision != 2 || document.Fields["name"] != "服务器名称" {
		t.Fatalf("matching value created an unnecessary revision: %#v", document)
	}
	conflict, found, err := store.FindConflict(ctx, "user-1", "stale-local-rename:name")
	if err != nil || !found || conflict.Status != "resolved" {
		t.Fatalf("matching value did not supersede the conflict: %#v err=%v", conflict, err)
	}
}

func TestPullPrioritizesNewUnresolvedConflictsOverResolvedHistory(t *testing.T) {
	store := NewMemoryStore()
	service := NewService(store)
	ctx := context.Background()
	for index := 0; index < maxPullConflicts; index++ {
		err := store.SaveConflict(ctx, Conflict{
			ID:        fmt.Sprintf("resolved-%03d", index),
			UserID:    "user-1",
			Status:    "resolved",
			CreatedAt: fmt.Sprintf("2026-09-05T%02d:%02d:00Z", index/60, index%60),
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if err := store.SaveConflict(ctx, Conflict{
		ID:        "new-unresolved",
		UserID:    "user-1",
		Status:    "unresolved",
		CreatedAt: "2026-09-06T08:00:00Z",
	}); err != nil {
		t.Fatal(err)
	}

	pulled, err := service.Pull(ctx, "user-1", 0, maxPullChanges)
	if err != nil {
		t.Fatal(err)
	}
	if len(pulled.Conflicts) != maxPullConflicts {
		t.Fatalf("unexpected conflict page size: %d", len(pulled.Conflicts))
	}
	if pulled.Conflicts[0].ID != "new-unresolved" {
		t.Fatalf("new unresolved conflict was hidden: %#v", pulled.Conflicts[0])
	}
}

func TestPullReturnsConflictsOnlyOnTheFinalChangePage(t *testing.T) {
	store := NewMemoryStore()
	service := NewService(store)
	ctx := context.Background()
	for sequence := int64(1); sequence <= 2; sequence++ {
		if err := store.SaveChange(ctx, Change{
			Sequence: sequence,
			UserID:   "user-1",
			Entity:   "items",
			EntityID: fmt.Sprintf("item-%d", sequence),
			Action:   "update",
			Revision: 1,
			Fields:   map[string]any{"name": "事项"},
		}); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.SaveConflict(ctx, Conflict{
		ID:        "conflict-1",
		UserID:    "user-1",
		Status:    "unresolved",
		CreatedAt: "2026-09-06T08:00:00Z",
	}); err != nil {
		t.Fatal(err)
	}

	first, err := service.Pull(ctx, "user-1", 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	if !first.HasMore || len(first.Conflicts) != 0 {
		t.Fatalf("non-final page included conflicts: %#v", first)
	}

	final, err := service.Pull(ctx, "user-1", first.NextSequence, 1)
	if err != nil {
		t.Fatal(err)
	}
	if final.HasMore || len(final.Conflicts) != 1 {
		t.Fatalf("final page did not include conflicts: %#v", final)
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
