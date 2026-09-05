package notifications

import (
	"context"
	"time"
)

type Kind string

const (
	KindDigest    Kind = "digest"
	KindImportant Kind = "important"
)

type Settings struct {
	TimeZone        string
	DueSoonDays     int
	DigestTime      string
	QuietHoursStart string
	QuietHoursEnd   string
}

type Device struct {
	ID                        string
	DigestEnabled             bool
	ImportantRemindersEnabled bool
}

type Item struct {
	ID              string
	Name            string
	DueDate         string
	Important       bool
	ReminderOffsets []int
	Lifecycle       string
}

type PlanInput struct {
	UserID   string
	Settings Settings
	Devices  []Device
	Items    []Item
}

type Payload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`
	Tag   string `json:"tag"`
	Badge int    `json:"badge"`
}

type Candidate struct {
	Identity       string
	UserID         string
	DeviceID       string
	Kind           Kind
	ItemID         string
	OccurrenceDate string
	ReminderOffset int
	DeliverAt      time.Time
	Payload        Payload
}

type Subscription struct {
	ID       string
	UserID   string
	DeviceID string
	Endpoint string
	P256DH   string
	Auth     string
	Enabled  bool
}

type SendResult struct {
	Expired bool
}

type Sender interface {
	Send(ctx context.Context, subscription Subscription, payload Payload) (SendResult, error)
}

type DispatchStore interface {
	LoadPlanInputs(ctx context.Context) ([]PlanInput, error)
	FindSubscription(ctx context.Context, deviceID string) (Subscription, bool, error)
	Claim(ctx context.Context, candidate Candidate, attemptedAt time.Time) (bool, error)
	MarkSent(ctx context.Context, identity string, sentAt time.Time) error
	MarkFailed(ctx context.Context, identity string, attemptedAt time.Time, message string) error
	DisableSubscription(ctx context.Context, subscriptionID string) error
}

type DispatchResult struct {
	Sent    int
	Failed  int
	Skipped int
}
