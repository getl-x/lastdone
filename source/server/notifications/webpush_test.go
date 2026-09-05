package notifications

import (
	"regexp"
	"testing"
)

func TestPushTopicIsStableURLSafeAndBounded(t *testing.T) {
	identity := "user-1:item:item-1:due:2026-09-12:important:7:device:device-1"
	first := pushTopic(identity)
	second := pushTopic(identity)
	if first != second {
		t.Fatalf("expected stable topic, got %q and %q", first, second)
	}
	if len(first) == 0 || len(first) > 32 {
		t.Fatalf("expected topic length from 1 to 32, got %d", len(first))
	}
	if !regexp.MustCompile(`^[A-Za-z0-9_-]+$`).MatchString(first) {
		t.Fatalf("expected URL-safe topic, got %q", first)
	}
	if pushTopic(identity+"-different") == first {
		t.Fatal("different identities must not share a topic")
	}
}
