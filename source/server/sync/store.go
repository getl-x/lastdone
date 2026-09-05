package sync

import "context"

type Store interface {
	RunInTransaction(ctx context.Context, fn func(Store) error) error
	FindProcessed(ctx context.Context, userID string, operationID string) (OperationResult, bool, error)
	SaveProcessed(ctx context.Context, userID string, result OperationResult) error
	FindDocument(ctx context.Context, userID string, entity string, entityID string) (Document, bool, error)
	SaveDocument(ctx context.Context, document Document) error
	NextSequence(ctx context.Context) (int64, error)
	SaveChange(ctx context.Context, change Change) error
	SaveConflict(ctx context.Context, conflict Conflict) error
	ListChanges(ctx context.Context, userID string, after int64, limit int) ([]Change, bool, error)
	ListConflicts(ctx context.Context, userID string) ([]Conflict, error)
}
