package schedule

import (
	"fmt"
	"time"

	"cloud.google.com/go/civil"
)

func daysInMonth(year int, month time.Month) int {
	return time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

func clampDate(year int, month time.Month, day int) (civil.Date, error) {
	if month < time.January || month > time.December || day < 1 || day > 31 {
		return civil.Date{}, fmt.Errorf("invalid calendar date")
	}

	if day > daysInMonth(year, month) {
		day = daysInMonth(year, month)
	}

	date := civil.Date{Year: year, Month: month, Day: day}
	if !date.IsValid() {
		return civil.Date{}, fmt.Errorf("invalid calendar date")
	}

	return date, nil
}

func addMonths(date civil.Date, months int) (civil.Date, error) {
	zeroBasedMonth := int(date.Month) - 1 + months
	year := date.Year + zeroBasedMonth/12
	month := time.Month(zeroBasedMonth%12 + 1)

	return clampDate(year, month, date.Day)
}
