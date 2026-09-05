package notifications

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	webpush "github.com/SherClockHolmes/webpush-go"
)

type WebPushSender struct {
	Keys       VAPIDKeys
	Subscriber string
	HTTPClient webpush.HTTPClient
}

func (sender WebPushSender) Send(
	ctx context.Context,
	subscription Subscription,
	payload Payload,
) (SendResult, error) {
	message, err := json.Marshal(payload)
	if err != nil {
		return SendResult{}, fmt.Errorf("encode push payload: %w", err)
	}
	response, err := webpush.SendNotificationWithContext(
		ctx,
		message,
		&webpush.Subscription{
			Endpoint: subscription.Endpoint,
			Keys: webpush.Keys{
				P256dh: subscription.P256DH,
				Auth:   subscription.Auth,
			},
		},
		&webpush.Options{
			HTTPClient:      sender.HTTPClient,
			Subscriber:      sender.Subscriber,
			TTL:             24 * 60 * 60,
			Topic:           pushTopic(payload.Tag),
			VAPIDPublicKey:  sender.Keys.PublicKey,
			VAPIDPrivateKey: sender.Keys.PrivateKey,
		},
	)
	if err != nil {
		return SendResult{}, fmt.Errorf("send web push: %w", err)
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, response.Body)
	if response.StatusCode >= http.StatusOK && response.StatusCode < http.StatusMultipleChoices {
		return SendResult{}, nil
	}
	expired := response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusGone
	return SendResult{Expired: expired}, fmt.Errorf("push service returned status %d", response.StatusCode)
}

func pushTopic(identity string) string {
	digest := sha256.Sum256([]byte(identity))
	return base64.RawURLEncoding.EncodeToString(digest[:24])
}
