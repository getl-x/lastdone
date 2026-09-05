package sync

import (
	"context"
	"fmt"
	"sort"
)

const maxPushOperations = 100
const maxPullChanges = 500

type Service struct {
	store Store
}

func NewService(store Store) *Service {
	return &Service{store: store}
}

func (service *Service) Push(ctx context.Context, userID string, operations []Operation) (PushResponse, error) {
	if userID == "" {
		return PushResponse{}, fmt.Errorf("user is required")
	}
	if len(operations) > maxPushOperations {
		return PushResponse{}, fmt.Errorf("operation batch exceeds %d", maxPushOperations)
	}

	response := PushResponse{
		AppliedOperationIDs: make([]string, 0, len(operations)),
		Conflicts:           []Conflict{},
	}
	for _, operation := range operations {
		var result OperationResult
		err := service.store.RunInTransaction(ctx, func(store Store) error {
			processed, ok, err := store.FindProcessed(ctx, userID, operation.ID)
			if err != nil {
				return err
			}
			if ok {
				result = processed
				return nil
			}

			result, err = applyOperation(ctx, store, userID, operation)
			if err != nil {
				return err
			}
			return store.SaveProcessed(ctx, userID, result)
		})
		if err != nil {
			return PushResponse{}, fmt.Errorf("apply operation %s: %w", operation.ID, err)
		}

		response.AppliedOperationIDs = append(response.AppliedOperationIDs, operation.ID)
		response.Conflicts = append(response.Conflicts, result.Conflicts...)
	}

	return response, nil
}

func applyOperation(ctx context.Context, store Store, userID string, operation Operation) (OperationResult, error) {
	if operation.ID == "" || operation.Entity == "" || operation.EntityID == "" {
		return OperationResult{}, fmt.Errorf("operation id, entity, and entityId are required")
	}
	if operation.Action != "create" && operation.Action != "update" && operation.Action != "delete" {
		return OperationResult{}, fmt.Errorf("unsupported action %q", operation.Action)
	}

	document, exists, err := store.FindDocument(ctx, userID, operation.Entity, operation.EntityID)
	if err != nil {
		return OperationResult{}, err
	}

	if operation.Action == "create" {
		if exists {
			return OperationResult{}, fmt.Errorf("document already exists")
		}
		document = Document{
			ID:             operation.EntityID,
			UserID:         userID,
			Entity:         operation.Entity,
			Revision:       1,
			Fields:         copyMap(operation.Fields),
			FieldRevisions: make(map[string]int, len(operation.Fields)),
		}
		for field := range operation.Fields {
			document.FieldRevisions[field] = 1
		}
		if err := store.SaveDocument(ctx, document); err != nil {
			return OperationResult{}, err
		}
		if err := saveChange(ctx, store, document, operation.Action, document.Fields); err != nil {
			return OperationResult{}, err
		}
		return OperationResult{OperationID: operation.ID, Conflicts: []Conflict{}}, nil
	}

	if !exists {
		return OperationResult{}, fmt.Errorf("document does not exist")
	}

	fields := operation.Fields
	if operation.Action == "delete" && len(fields) == 0 {
		fields = map[string]any{"deletedAt": operation.CreatedAt}
	}
	fieldNames := make([]string, 0, len(fields))
	for field := range fields {
		fieldNames = append(fieldNames, field)
	}
	sort.Strings(fieldNames)

	conflicts := make([]Conflict, 0)
	appliedFields := make(map[string]any)
	for _, field := range fieldNames {
		value := fields[field]
		if document.FieldRevisions[field] > operation.BaseRevision {
			conflict := Conflict{
				ID:             operation.ID + ":" + field,
				UserID:         userID,
				Entity:         operation.Entity,
				EntityID:       operation.EntityID,
				Field:          field,
				LocalValue:     value,
				ServerValue:    document.Fields[field],
				ServerRevision: document.Revision,
				Status:         "unresolved",
				CreatedAt:      operation.CreatedAt,
			}
			if err := store.SaveConflict(ctx, conflict); err != nil {
				return OperationResult{}, err
			}
			conflicts = append(conflicts, conflict)
			continue
		}
		appliedFields[field] = value
	}

	if len(appliedFields) > 0 {
		document.Revision++
		for field, value := range appliedFields {
			document.Fields[field] = value
			document.FieldRevisions[field] = document.Revision
		}
		if err := store.SaveDocument(ctx, document); err != nil {
			return OperationResult{}, err
		}
		if err := saveChange(ctx, store, document, operation.Action, appliedFields); err != nil {
			return OperationResult{}, err
		}
	}

	return OperationResult{OperationID: operation.ID, Conflicts: conflicts}, nil
}

func saveChange(ctx context.Context, store Store, document Document, action string, fields map[string]any) error {
	sequence, err := store.NextSequence(ctx)
	if err != nil {
		return err
	}
	return store.SaveChange(ctx, Change{
		Sequence: sequence,
		UserID:   document.UserID,
		Entity:   document.Entity,
		EntityID: document.ID,
		Action:   action,
		Revision: document.Revision,
		Fields:   copyMap(fields),
	})
}

func (service *Service) Pull(ctx context.Context, userID string, after int64, limit int) (PullResponse, error) {
	if userID == "" {
		return PullResponse{}, fmt.Errorf("user is required")
	}
	if after < 0 {
		after = 0
	}
	if limit <= 0 || limit > maxPullChanges {
		limit = maxPullChanges
	}

	changes, hasMore, err := service.store.ListChanges(ctx, userID, after, limit)
	if err != nil {
		return PullResponse{}, err
	}
	conflicts, err := service.store.ListConflicts(ctx, userID)
	if err != nil {
		return PullResponse{}, err
	}
	nextSequence := after
	if len(changes) > 0 {
		nextSequence = changes[len(changes)-1].Sequence
	}

	return PullResponse{
		Changes:      changes,
		Conflicts:    conflicts,
		NextSequence: nextSequence,
		HasMore:      hasMore,
	}, nil
}
