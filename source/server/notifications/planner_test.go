package notifications

import (
	"testing"
	"time"
)

func fixedTime(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}

func defaultInput() PlanInput {
	return PlanInput{
		UserID: "user-1",
		Settings: Settings{
			TimeZone:        "Asia/Shanghai",
			DueSoonDays:     7,
			DigestTime:      "09:00",
			QuietHoursStart: "22:00",
			QuietHoursEnd:   "08:00",
		},
		Devices: []Device{{
			ID:                        "device-1",
			DigestEnabled:             true,
			ImportantRemindersEnabled: true,
		}},
	}
}

func TestPlanBuildsDigestCountsAndPriorityOrder(t *testing.T) {
	input := defaultInput()
	input.Items = []Item{
		{ID: "soon-2", Name: "清洗空调", DueDate: "2026-09-10", Lifecycle: "active"},
		{ID: "overdue-2", Name: "备份电脑", DueDate: "2026-09-01", Lifecycle: "active"},
		{ID: "today", Name: "检查门锁", DueDate: "2026-09-05", Lifecycle: "active"},
		{ID: "overdue-1", Name: "更换滤芯", DueDate: "2026-08-30", Lifecycle: "active"},
		{ID: "soon-1", Name: "车辆保养", DueDate: "2026-09-07", Lifecycle: "active"},
		{ID: "later", Name: "年度归档", DueDate: "2026-10-01", Lifecycle: "active"},
		{ID: "paused", Name: "暂停事项", DueDate: "2026-08-01", Lifecycle: "paused"},
	}

	candidates, err := Plan(fixedTime(t, "2026-09-05T01:15:00Z"), input)
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 1 {
		t.Fatalf("expected one digest, got %#v", candidates)
	}
	digest := candidates[0]
	if digest.Kind != KindDigest {
		t.Fatalf("expected digest, got %q", digest.Kind)
	}
	if digest.Identity != "user-1:digest:2026-09-05:device-1" {
		t.Fatalf("unexpected identity %q", digest.Identity)
	}
	if digest.Payload.Body != "逾期 2 · 今天 1 · 即将 2｜更换滤芯、备份电脑、检查门锁" {
		t.Fatalf("unexpected body %q", digest.Payload.Body)
	}
	if digest.Payload.Badge != 2 || digest.Payload.URL != "/?filter=attention" {
		t.Fatalf("unexpected payload %#v", digest.Payload)
	}
}

func TestPlanSkipsEmptyDigestAndDisabledDevice(t *testing.T) {
	input := defaultInput()
	input.Devices[0].DigestEnabled = false
	input.Devices[0].ImportantRemindersEnabled = false
	input.Items = []Item{{
		ID: "later", Name: "年度归档", DueDate: "2026-10-01", Lifecycle: "active",
	}}

	candidates, err := Plan(fixedTime(t, "2026-09-05T04:00:00Z"), input)
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 0 {
		t.Fatalf("expected no candidates, got %#v", candidates)
	}
}

func TestPlanBuildsImportantOffsetsAndStableIdentity(t *testing.T) {
	input := defaultInput()
	input.Devices[0].DigestEnabled = false
	input.Items = []Item{{
		ID:              "filter-1",
		Name:            "更换滤芯",
		DueDate:         "2026-09-12",
		Important:       true,
		ReminderOffsets: []int{30, 7, 1, 0},
		Lifecycle:       "active",
	}}

	candidates, err := Plan(fixedTime(t, "2026-09-05T01:00:00Z"), input)
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 1 {
		t.Fatalf("expected one reminder, got %#v", candidates)
	}
	reminder := candidates[0]
	if reminder.Identity != "user-1:item:filter-1:due:2026-09-12:important:7:device:device-1" {
		t.Fatalf("unexpected identity %q", reminder.Identity)
	}
	if reminder.Payload.Title != "更换滤芯" || reminder.Payload.Body != "还有 7 天到期（2026-09-12）" {
		t.Fatalf("unexpected payload %#v", reminder.Payload)
	}

	input.Items[0].DueDate = "2026-09-19"
	rescheduled, err := Plan(fixedTime(t, "2026-09-12T01:00:00Z"), input)
	if err != nil {
		t.Fatal(err)
	}
	if len(rescheduled) != 1 || rescheduled[0].Identity == reminder.Identity {
		t.Fatalf("rescheduled occurrence must have a new identity: %#v", rescheduled)
	}
}

func TestPlanDelaysNotificationsUntilQuietHoursEnd(t *testing.T) {
	input := defaultInput()
	input.Settings.DigestTime = "23:30"
	input.Devices[0].ImportantRemindersEnabled = false
	input.Items = []Item{{
		ID: "today", Name: "备份电脑", DueDate: "2026-09-05", Lifecycle: "active",
	}}

	beforeEnd, err := Plan(fixedTime(t, "2026-09-05T23:59:00+08:00"), input)
	if err != nil {
		t.Fatal(err)
	}
	if len(beforeEnd) != 0 {
		t.Fatalf("expected quiet-hour delay, got %#v", beforeEnd)
	}

	atEnd, err := Plan(fixedTime(t, "2026-09-06T08:00:00+08:00"), input)
	if err != nil {
		t.Fatal(err)
	}
	if len(atEnd) != 1 {
		t.Fatalf("expected delayed digest, got %#v", atEnd)
	}
	if atEnd[0].Identity != "user-1:digest:2026-09-05:device-1" {
		t.Fatalf("digest must retain its logical date: %#v", atEnd[0])
	}
	if atEnd[0].Payload.Body != "逾期 0 · 今天 1 · 即将 0｜备份电脑" {
		t.Fatalf("digest must use its logical date, got %q", atEnd[0].Payload.Body)
	}
	want := fixedTime(t, "2026-09-06T00:00:00Z")
	if !atEnd[0].DeliverAt.Equal(want) {
		t.Fatalf("expected delivery at %s, got %s", want, atEnd[0].DeliverAt)
	}
}

func TestPlanUsesConfiguredTimezoneAtDateBoundary(t *testing.T) {
	input := defaultInput()
	input.Settings.TimeZone = "America/New_York"
	input.Settings.DigestTime = "23:00"
	input.Settings.QuietHoursStart = "00:00"
	input.Settings.QuietHoursEnd = "00:00"
	input.Devices[0].ImportantRemindersEnabled = false
	input.Items = []Item{{
		ID: "today", Name: "检查设备", DueDate: "2026-09-05", Lifecycle: "active",
	}}

	candidates, err := Plan(fixedTime(t, "2026-09-06T03:00:00Z"), input)
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 1 || candidates[0].Identity != "user-1:digest:2026-09-05:device-1" {
		t.Fatalf("expected New York local date, got %#v", candidates)
	}
}

func TestPlanRejectsInvalidSettings(t *testing.T) {
	input := defaultInput()
	input.Settings.TimeZone = "Not/AZone"
	if _, err := Plan(time.Now(), input); err == nil {
		t.Fatal("expected invalid timezone error")
	}

	input = defaultInput()
	input.Settings.DigestTime = "9am"
	if _, err := Plan(time.Now(), input); err == nil {
		t.Fatal("expected invalid time error")
	}
}
