package sync

type Operation struct {
	ID           string         `json:"id"`
	UserID       string         `json:"userId,omitempty"`
	Entity       string         `json:"entity"`
	EntityID     string         `json:"entityId"`
	Action       string         `json:"action"`
	BaseRevision int            `json:"baseRevision"`
	Fields       map[string]any `json:"fields"`
	CreatedAt    string         `json:"createdAt"`
}

type Conflict struct {
	ID             string `json:"id"`
	UserID         string `json:"userId"`
	Entity         string `json:"entity"`
	EntityID       string `json:"entityId"`
	Field          string `json:"field"`
	LocalValue     any    `json:"localValue"`
	ServerValue    any    `json:"serverValue"`
	ServerRevision int    `json:"serverRevision"`
	Status         string `json:"status"`
	CreatedAt      string `json:"createdAt"`
	ResolvedAt     string `json:"resolvedAt,omitempty"`
}

type Change struct {
	Sequence int64          `json:"sequence"`
	UserID   string         `json:"userId"`
	Entity   string         `json:"entity"`
	EntityID string         `json:"entityId"`
	Action   string         `json:"action"`
	Revision int            `json:"revision"`
	Fields   map[string]any `json:"fields"`
}

type PushResponse struct {
	AppliedOperationIDs []string   `json:"appliedOperationIds"`
	Conflicts           []Conflict `json:"conflicts"`
}

type PullResponse struct {
	Changes      []Change   `json:"changes"`
	Conflicts    []Conflict `json:"conflicts"`
	NextSequence int64      `json:"nextSequence"`
	HasMore      bool       `json:"hasMore"`
}

type Document struct {
	ID             string
	UserID         string
	Entity         string
	Revision       int
	Fields         map[string]any
	FieldRevisions map[string]int
}

type OperationResult struct {
	OperationID string
	Conflicts   []Conflict
}
