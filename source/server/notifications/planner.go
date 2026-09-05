package notifications

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	dateLayout       = "2006-01-02"
	timeLayout       = "15:04"
	maxDeliveryDelay = 12 * time.Hour
)

type attentionItem struct {
	item     Item
	priority int
}

func Plan(now time.Time, input PlanInput) ([]Candidate, error) {
	location, err := time.LoadLocation(input.Settings.TimeZone)
	if err != nil {
		return nil, fmt.Errorf("load timezone %q: %w", input.Settings.TimeZone, err)
	}
	digestHour, digestMinute, err := parseClock(input.Settings.DigestTime)
	if err != nil {
		return nil, fmt.Errorf("parse digest time: %w", err)
	}
	quietStart, err := parseClockMinutes(input.Settings.QuietHoursStart)
	if err != nil {
		return nil, fmt.Errorf("parse quiet hours start: %w", err)
	}
	quietEnd, err := parseClockMinutes(input.Settings.QuietHoursEnd)
	if err != nil {
		return nil, fmt.Errorf("parse quiet hours end: %w", err)
	}
	if input.Settings.DueSoonDays < 0 {
		return nil, fmt.Errorf("due soon days must not be negative")
	}

	localNow := now.In(location)
	today := localNow.Format(dateLayout)
	overdue, dueToday, dueSoon, attention := classifyItems(
		input.Items,
		today,
		input.Settings.DueSoonDays,
		location,
	)
	candidates := make([]Candidate, 0)

	for _, device := range input.Devices {
		if device.DigestEnabled && len(attention) > 0 {
			for _, logicalDate := range []time.Time{
				localDate(localNow),
				localDate(localNow).AddDate(0, 0, -1),
			} {
				nominal := time.Date(
					logicalDate.Year(),
					logicalDate.Month(),
					logicalDate.Day(),
					digestHour,
					digestMinute,
					0,
					0,
					location,
				)
				deliverAt := delayForQuietHours(nominal, quietStart, quietEnd)
				if !isDeliveryDue(localNow, deliverAt, today) {
					continue
				}
				identity := fmt.Sprintf(
					"%s:digest:%s:%s",
					input.UserID,
					logicalDate.Format(dateLayout),
					device.ID,
				)
				candidates = append(candidates, Candidate{
					Identity:       identity,
					UserID:         input.UserID,
					DeviceID:       device.ID,
					Kind:           KindDigest,
					OccurrenceDate: logicalDate.Format(dateLayout),
					DeliverAt:      deliverAt.UTC(),
					Payload: Payload{
						Title: "LastDone 每日摘要",
						Body: digestBody(
							overdue,
							dueToday,
							dueSoon,
							attention,
						),
						URL:   "/?filter=attention",
						Tag:   identity,
						Badge: overdue,
					},
				})
			}
		}

		if device.ImportantRemindersEnabled {
			for _, item := range input.Items {
				if !item.Important || item.Lifecycle != "active" || item.DueDate == "" {
					continue
				}
				due, parseErr := time.ParseInLocation(dateLayout, item.DueDate, location)
				if parseErr != nil {
					continue
				}
				seenOffsets := map[int]bool{}
				for _, offset := range item.ReminderOffsets {
					if offset < 0 || seenOffsets[offset] {
						continue
					}
					seenOffsets[offset] = true
					logicalDate := due.AddDate(0, 0, -offset)
					nominal := time.Date(
						logicalDate.Year(),
						logicalDate.Month(),
						logicalDate.Day(),
						digestHour,
						digestMinute,
						0,
						0,
						location,
					)
					deliverAt := delayForQuietHours(nominal, quietStart, quietEnd)
					if !isDeliveryDue(localNow, deliverAt, today) {
						continue
					}
					identity := fmt.Sprintf(
						"%s:item:%s:due:%s:important:%d:device:%s",
						input.UserID,
						item.ID,
						item.DueDate,
						offset,
						device.ID,
					)
					candidates = append(candidates, Candidate{
						Identity:       identity,
						UserID:         input.UserID,
						DeviceID:       device.ID,
						Kind:           KindImportant,
						ItemID:         item.ID,
						OccurrenceDate: item.DueDate,
						ReminderOffset: offset,
						DeliverAt:      deliverAt.UTC(),
						Payload: Payload{
							Title: item.Name,
							Body:  reminderBody(offset, item.DueDate),
							URL:   "/items/" + item.ID,
							Tag:   identity,
							Badge: overdue,
						},
					})
				}
			}
		}
	}

	sort.Slice(candidates, func(left, right int) bool {
		if candidates[left].DeliverAt.Equal(candidates[right].DeliverAt) {
			return candidates[left].Identity < candidates[right].Identity
		}
		return candidates[left].DeliverAt.Before(candidates[right].DeliverAt)
	})
	return candidates, nil
}

func parseClock(value string) (int, int, error) {
	parsed, err := time.Parse(timeLayout, value)
	if err != nil {
		return 0, 0, err
	}
	return parsed.Hour(), parsed.Minute(), nil
}

func parseClockMinutes(value string) (int, error) {
	hour, minute, err := parseClock(value)
	if err != nil {
		return 0, err
	}
	return hour*60 + minute, nil
}

func localDate(value time.Time) time.Time {
	return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, value.Location())
}

func delayForQuietHours(nominal time.Time, start int, end int) time.Time {
	if start == end {
		return nominal
	}
	minutes := nominal.Hour()*60 + nominal.Minute()
	quiet := false
	nextDay := false
	if start < end {
		quiet = minutes >= start && minutes < end
	} else {
		quiet = minutes >= start || minutes < end
		nextDay = minutes >= start
	}
	if !quiet {
		return nominal
	}
	date := localDate(nominal)
	if nextDay {
		date = date.AddDate(0, 0, 1)
	}
	return time.Date(
		date.Year(),
		date.Month(),
		date.Day(),
		end/60,
		end%60,
		0,
		0,
		nominal.Location(),
	)
}

func isDeliveryDue(now time.Time, deliverAt time.Time, today string) bool {
	if deliverAt.Format(dateLayout) != today || now.Before(deliverAt) {
		return false
	}
	return now.Sub(deliverAt) <= maxDeliveryDelay
}

func classifyItems(
	items []Item,
	today string,
	dueSoonDays int,
	location *time.Location,
) (int, int, int, []attentionItem) {
	todayDate, _ := time.ParseInLocation(dateLayout, today, location)
	dueSoonBoundary := todayDate.AddDate(0, 0, dueSoonDays).Format(dateLayout)
	attention := make([]attentionItem, 0)
	overdue := 0
	dueToday := 0
	dueSoon := 0
	for _, item := range items {
		if item.Lifecycle != "active" || item.DueDate == "" {
			continue
		}
		if _, err := time.ParseInLocation(dateLayout, item.DueDate, location); err != nil {
			continue
		}
		priority := -1
		switch {
		case item.DueDate < today:
			overdue++
			priority = 0
		case item.DueDate == today:
			dueToday++
			priority = 1
		case item.DueDate <= dueSoonBoundary:
			dueSoon++
			priority = 2
		}
		if priority >= 0 {
			attention = append(attention, attentionItem{item: item, priority: priority})
		}
	}
	sort.Slice(attention, func(left, right int) bool {
		if attention[left].priority != attention[right].priority {
			return attention[left].priority < attention[right].priority
		}
		if attention[left].item.DueDate != attention[right].item.DueDate {
			return attention[left].item.DueDate < attention[right].item.DueDate
		}
		return attention[left].item.Name < attention[right].item.Name
	})
	return overdue, dueToday, dueSoon, attention
}

func digestBody(overdue int, dueToday int, dueSoon int, items []attentionItem) string {
	names := make([]string, 0, 3)
	for _, entry := range items {
		if len(names) == 3 {
			break
		}
		names = append(names, entry.item.Name)
	}
	body := fmt.Sprintf("逾期 %d · 今天 %d · 即将 %d", overdue, dueToday, dueSoon)
	if len(names) > 0 {
		body += "｜" + strings.Join(names, "、")
	}
	return body
}

func reminderBody(offset int, dueDate string) string {
	switch offset {
	case 0:
		return fmt.Sprintf("今天到期（%s）", dueDate)
	case 1:
		return fmt.Sprintf("明天到期（%s）", dueDate)
	default:
		return fmt.Sprintf("还有 %d 天到期（%s）", offset, dueDate)
	}
}
