package sync

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

func RegisterRoutes(event *core.ServeEvent) {
	event.Router.POST("/api/lastdone/sync/push", func(request *core.RequestEvent) error {
		body := struct {
			Operations []Operation `json:"operations"`
		}{}
		if err := request.BindBody(&body); err != nil {
			return apis.NewBadRequestError("invalid sync request", err)
		}

		service := NewService(NewPocketBaseStore(request.App))
		response, err := service.Push(request.Request.Context(), request.Auth.Id, body.Operations)
		if err != nil {
			return apis.NewBadRequestError("sync push failed", err)
		}
		return request.JSON(http.StatusOK, response)
	}).Bind(apis.RequireAuth("users"))

	event.Router.GET("/api/lastdone/sync/pull", func(request *core.RequestEvent) error {
		after, err := strconv.ParseInt(request.Request.URL.Query().Get("after"), 10, 64)
		if err != nil {
			after = 0
		}
		limit, err := strconv.Atoi(request.Request.URL.Query().Get("limit"))
		if err != nil {
			limit = maxPullChanges
		}

		service := NewService(NewPocketBaseStore(request.App))
		response, err := service.Pull(request.Request.Context(), request.Auth.Id, after, limit)
		if err != nil {
			return apis.NewBadRequestError("sync pull failed", err)
		}
		return request.JSON(http.StatusOK, response)
	}).Bind(apis.RequireAuth("users"))

	event.Router.POST("/api/lastdone/sync/conflicts/{id}/resolve", func(request *core.RequestEvent) error {
		body := struct {
			Choice string `json:"choice"`
		}{}
		if err := request.BindBody(&body); err != nil {
			return apis.NewBadRequestError("invalid conflict resolution", err)
		}
		service := NewService(NewPocketBaseStore(request.App))
		conflict, err := service.ResolveConflict(
			request.Request.Context(),
			request.Auth.Id,
			request.Request.PathValue("id"),
			body.Choice,
			time.Now().UTC().Format(time.RFC3339Nano),
		)
		if errors.Is(err, ErrConflictNotFound) {
			return apis.NewNotFoundError("conflict not found", err)
		}
		if err != nil {
			return apis.NewBadRequestError("could not resolve conflict", err)
		}
		return request.JSON(http.StatusOK, conflict)
	}).Bind(apis.RequireAuth("users"))
}
