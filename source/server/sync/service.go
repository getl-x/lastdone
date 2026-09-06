package sync

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
)

const maxPushOperations = 100
const maxPullChanges = 500
const maxPullConflicts = 500

var ErrConflictNotFound = errors.New("conflict not found")

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

	action := operation.Action
	if operation.Action == "create" && !exists {
		fields := operationDataFields(operation.Fields)
		document = Document{
			ID:             operation.EntityID,
			UserID:         userID,
			Entity:         operation.Entity,
			Revision:       1,
			Fields:         fields,
			FieldRevisions: make(map[string]int, len(fields)),
		}
		for field := range fields {
			document.FieldRevisions[field] = 1
		}
		if err := store.SaveDocument(ctx, document); err != nil {
			return OperationResult{}, err
		}
		if err := saveChange(
			ctx,
			store,
			document,
			operation.Action,
			withChangeMetadata(fields, operation.Fields, true),
		); err != nil {
			return OperationResult{}, err
		}
		return OperationResult{OperationID: operation.ID, Conflicts: []Conflict{}}, nil
	}
	if operation.Action == "create" {
		action = "update"
	}

	if !exists {
		return OperationResult{}, fmt.Errorf("document does not exist")
	}

	fields := operationDataFields(operation.Fields)
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
	settledFields := make(map[string]bool)
	for _, field := range fieldNames {
		value := fields[field]
		if document.FieldRevisions[field] > operation.BaseRevision {
			if valuesEqual(value, document.Fields[field]) {
				settledFields[field] = true
				continue
			}
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
		settledFields[field] = true
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
		if err := saveChange(
			ctx,
			store,
			document,
			action,
			withChangeMetadata(appliedFields, operation.Fields, false),
		); err != nil {
			return OperationResult{}, err
		}
	}
	for field := range settledFields {
		if err := store.MarkFieldConflictsResolved(
			ctx,
			userID,
			operation.Entity,
			operation.EntityID,
			field,
			operation.CreatedAt,
		); err != nil {
			return OperationResult{}, err
		}
	}

	return OperationResult{OperationID: operation.ID, Conflicts: conflicts}, nil
}

func valuesEqual(left any, right any) bool {
	leftJSON, leftErr := json.Marshal(left)
	rightJSON, rightErr := json.Marshal(right)
	return leftErr == nil && rightErr == nil && bytes.Equal(leftJSON, rightJSON)
}

func operationDataFields(fields map[string]any) map[string]any {
	result := make(map[string]any, len(fields))
	for field, value := range fields {
		switch field {
		case "id", "userId", "revision", "fieldRevisions", "createdAt", "updatedAt":
			continue
		default:
			result[field] = value
		}
	}
	return result
}

func withChangeMetadata(
	fields map[string]any,
	operationFields map[string]any,
	includeCreatedAt bool,
) map[string]any {
	result := copyMap(fields)
	if includeCreatedAt {
		if value, ok := operationFields["createdAt"]; ok {
			result["createdAt"] = value
		}
	}
	if value, ok := operationFields["updatedAt"]; ok {
		result["updatedAt"] = value
	}
	return result
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
	conflicts := []Conflict{}
	if !hasMore {
		conflicts, err = service.store.ListConflicts(ctx, userID, maxPullConflicts)
		if err != nil {
			return PullResponse{}, err
		}
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

func (service *Service) ResolveConflict(
	ctx context.Context,
	userID string,
	conflictID string,
	choice string,
	resolvedAt string,
) (Conflict, error) {
	if userID == "" || conflictID == "" {
		return Conflict{}, fmt.Errorf("user and conflict id are required")
	}
	if choice != "local" && choice != "server" {
		return Conflict{}, fmt.Errorf("choice must be local or server")
	}
	if resolvedAt == "" {
		return Conflict{}, fmt.Errorf("resolution time is required")
	}

	var resolved Conflict
	err := service.store.RunInTransaction(ctx, func(store Store) error {
		conflict, found, err := store.FindConflict(ctx, userID, conflictID)
		if err != nil {
			return err
		}
		if !found {
			return ErrConflictNotFound
		}
		if conflict.Status == "resolved" {
			resolved = conflict
			return nil
		}

		document, exists, err := store.FindDocument(
			ctx,
			userID,
			conflict.Entity,
			conflict.EntityID,
		)
		if err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("conflicted document does not exist")
		}
		resolvedValue := document.Fields[conflict.Field]
		if choice == "local" {
			resolvedValue = conflict.LocalValue
		}
		document.Revision++
		document.Fields[conflict.Field] = resolvedValue
		document.FieldRevisions[conflict.Field] = document.Revision
		if err := store.SaveDocument(ctx, document); err != nil {
			return err
		}
		if err := saveChange(ctx, store, document, "update", map[string]any{
			conflict.Field: resolvedValue,
			"updatedAt":    resolvedAt,
		}); err != nil {
			return err
		}

		if err := store.MarkFieldConflictsResolved(
			ctx,
			userID,
			conflict.Entity,
			conflict.EntityID,
			conflict.Field,
			resolvedAt,
		); err != nil {
			return err
		}
		conflict.Status = "resolved"
		conflict.ResolvedAt = &resolvedAt
		resolved = conflict
		return nil
	})
	if err != nil {
		return Conflict{}, err
	}
	return resolved, nil
}
