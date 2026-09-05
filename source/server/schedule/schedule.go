package schedule

import (
	"fmt"
	"time"

	"cloud.google.com/go/civil"
)

type Rule struct {
	Type  string `json:"type"`
	Every int    `json:"every,omitempty"`
	Unit  string `json:"unit,omitempty"`
	Day   int    `json:"day,omitempty"`
	Month int    `json:"month,omitempty"`
}

func NextDueDate(rule Rule, baseline civil.Date) (civil.Date, error) {
	if !baseline.IsValid() {
		return civil.Date{}, fmt.Errorf("invalid baseline date")
	}

	switch rule.Type {
	case "relative":
		if rule.Every <= 0 {
			return civil.Date{}, fmt.Errorf("every must be a positive integer")
		}

		switch rule.Unit {
		case "days":
			return baseline.AddDays(rule.Every), nil
		case "weeks":
			return baseline.AddDays(rule.Every * 7), nil
		case "months":
			return addMonths(baseline, rule.Every)
		case "years":
			return clampDate(baseline.Year+rule.Every, baseline.Month, baseline.Day)
		default:
			return civil.Date{}, fmt.Errorf("unsupported relative unit %q", rule.Unit)
		}
	case "fixed-monthly":
		current, err := clampDate(baseline.Year, baseline.Month, rule.Day)
		if err != nil {
			return civil.Date{}, err
		}
		if current.After(baseline) {
			return current, nil
		}
		nextMonth := baseline.Month + 1
		nextYear := baseline.Year
		if nextMonth > time.December {
			nextMonth = time.January
			nextYear++
		}
		return clampDate(nextYear, nextMonth, rule.Day)
	case "fixed-yearly":
		if rule.Month < 1 || rule.Month > 12 {
			return civil.Date{}, fmt.Errorf("invalid month")
		}
		month := time.Month(rule.Month)
		if rule.Day > daysInMonth(2000, month) {
			return civil.Date{}, fmt.Errorf("invalid day for month")
		}
		current, err := clampDate(baseline.Year, month, rule.Day)
		if err != nil {
			return civil.Date{}, err
		}
		if current.After(baseline) {
			return current, nil
		}
		return clampDate(baseline.Year+1, month, rule.Day)
	default:
		return civil.Date{}, fmt.Errorf("unsupported schedule type %q", rule.Type)
	}
}
