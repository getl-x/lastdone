package schedule

import (
	"encoding/json"
	"os"
	"testing"

	"cloud.google.com/go/civil"
)

type scheduleContractCase struct {
	Name     string          `json:"name"`
	Baseline string          `json:"baseline"`
	Rule     json.RawMessage `json:"rule"`
	Expected string          `json:"expected"`
}

func TestScheduleContracts(t *testing.T) {
	data, err := os.ReadFile("../../packages/contracts/schedules.json")
	if err != nil {
		t.Fatal(err)
	}

	var cases []scheduleContractCase
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}

	for _, testCase := range cases {
		t.Run(testCase.Name, func(t *testing.T) {
			var rule Rule
			if err := json.Unmarshal(testCase.Rule, &rule); err != nil {
				t.Fatal(err)
			}

			baseline, err := civil.ParseDate(testCase.Baseline)
			if err != nil {
				t.Fatal(err)
			}

			actual, err := NextDueDate(rule, baseline)
			if err != nil {
				t.Fatal(err)
			}

			if actual.String() != testCase.Expected {
				t.Fatalf("got %s, want %s", actual, testCase.Expected)
			}
		})
	}
}
