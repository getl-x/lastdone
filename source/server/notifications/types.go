package notifications

import "time"

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
