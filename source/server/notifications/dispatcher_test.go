package notifications

import (
	"context"
	"errors"
	"testing"
	"time"
)

type memoryDispatchStore struct {
	inputs        []PlanInput
	subscriptions map[string]Subscription
	statuses      map[string]string
	disabled      map[string]bool
}

func (store *memoryDispatchStore) LoadPlanInputs(context.Context) ([]PlanInput, error) {
	return store.inputs, nil
}

func (store *memoryDispatchStore) FindSubscription(_ context.Context, deviceID string) (Subscription, bool, error) {
	subscription, ok := store.subscriptions[deviceID]
	return subscription, ok && subscription.Enabled, nil
}

func (store *memoryDispatchStore) Claim(_ context.Context, candidate Candidate, _ time.Time) (bool, error) {
	status := store.statuses[candidate.Identity]
	if status == "sending" || status == "sent" {
		return false, nil
	}
	store.statuses[candidate.Identity] = "sending"
	return true, nil
}

func (store *memoryDispatchStore) MarkSent(_ context.Context, identity string, _ time.Time) error {
	store.statuses[identity] = "sent"
	return nil
}

func (store *memoryDispatchStore) MarkFailed(_ context.Context, identity string, _ time.Time, _ string) error {
	store.statuses[identity] = "failed"
	return nil
}

func (store *memoryDispatchStore) DisableSubscription(_ context.Context, subscriptionID string) error {
	store.disabled[subscriptionID] = true
	return nil
}

type scriptedSender struct {
	results []SendResult
	errors  []error
	sent    []Subscription
}

func (sender *scriptedSender) Send(_ context.Context, subscription Subscription, _ Payload) (SendResult, error) {
	index := len(sender.sent)
	sender.sent = append(sender.sent, subscription)
	var result SendResult
	if index < len(sender.results) {
		result = sender.results[index]
	}
	if index < len(sender.errors) {
		return result, sender.errors[index]
	}
	return result, nil
}

func reminderInput() PlanInput {
	input := defaultInput()
	input.Devices[0].DigestEnabled = false
	input.Items = []Item{{
		ID:              "filter-1",
		Name:            "更换滤芯",
		DueDate:         "2026-09-12",
		Important:       true,
		ReminderOffsets: []int{7},
		Lifecycle:       "active",
	}}
	return input
}

func newMemoryDispatchStore() *memoryDispatchStore {
	return &memoryDispatchStore{
		inputs: []PlanInput{reminderInput()},
		subscriptions: map[string]Subscription{
			"device-1": {
				ID:       "subscription-1",
				DeviceID: "device-1",
				Endpoint: "https://push.example/subscription-1",
				P256DH:   "public-key",
				Auth:     "auth-secret",
				Enabled:  true,
			},
		},
		statuses: map[string]string{},
		disabled: map[string]bool{},
	}
}

func TestDispatcherClaimsIdentityBeforeSending(t *testing.T) {
	store := newMemoryDispatchStore()
	sender := &scriptedSender{}
	dispatcher := Dispatcher{Store: store, Sender: sender}
	now := fixedTime(t, "2026-09-05T01:00:00Z")

	first, err := dispatcher.Run(context.Background(), now)
	if err != nil {
		t.Fatal(err)
	}
	second, err := dispatcher.Run(context.Background(), now)
	if err != nil {
		t.Fatal(err)
	}

	if first.Sent != 1 || second.Skipped != 1 || len(sender.sent) != 1 {
		t.Fatalf("expected exactly one delivery, first=%#v second=%#v sent=%d", first, second, len(sender.sent))
	}
}

func TestDispatcherRetriesFailedIdentity(t *testing.T) {
	store := newMemoryDispatchStore()
	sender := &scriptedSender{errors: []error{errors.New("temporary failure"), nil}}
	dispatcher := Dispatcher{Store: store, Sender: sender}
	now := fixedTime(t, "2026-09-05T01:00:00Z")

	first, err := dispatcher.Run(context.Background(), now)
	if err != nil {
		t.Fatal(err)
	}
	second, err := dispatcher.Run(context.Background(), now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}

	if first.Failed != 1 || second.Sent != 1 || len(sender.sent) != 2 {
		t.Fatalf("expected one retry, first=%#v second=%#v", first, second)
	}
}

func TestDispatcherDisablesExpiredSubscription(t *testing.T) {
	store := newMemoryDispatchStore()
	sender := &scriptedSender{
		results: []SendResult{{Expired: true}},
		errors:  []error{errors.New("push endpoint expired")},
	}
	dispatcher := Dispatcher{Store: store, Sender: sender}

	result, err := dispatcher.Run(
		context.Background(),
		fixedTime(t, "2026-09-05T01:00:00Z"),
	)
	if err != nil {
		t.Fatal(err)
	}

	if result.Failed != 1 || !store.disabled["subscription-1"] {
		t.Fatalf("expected expired subscription to be disabled: %#v %#v", result, store.disabled)
	}
}
