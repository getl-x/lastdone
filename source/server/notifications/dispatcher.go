package notifications

import (
	"context"
	"fmt"
	"time"
)

type Dispatcher struct {
	Store  DispatchStore
	Sender Sender
}

func (dispatcher Dispatcher) Run(ctx context.Context, now time.Time) (DispatchResult, error) {
	result := DispatchResult{}
	inputs, err := dispatcher.Store.LoadPlanInputs(ctx)
	if err != nil {
		return result, fmt.Errorf("load notification inputs: %w", err)
	}

	for _, input := range inputs {
		candidates, err := Plan(now, input)
		if err != nil {
			return result, fmt.Errorf("plan notifications for user %s: %w", input.UserID, err)
		}
		for _, candidate := range candidates {
			subscription, found, err := dispatcher.Store.FindSubscription(ctx, candidate.DeviceID)
			if err != nil {
				return result, fmt.Errorf("find subscription for %s: %w", candidate.DeviceID, err)
			}
			if !found {
				result.Skipped++
				continue
			}

			claimed, err := dispatcher.Store.Claim(ctx, candidate, now)
			if err != nil {
				return result, fmt.Errorf("claim notification %s: %w", candidate.Identity, err)
			}
			if !claimed {
				result.Skipped++
				continue
			}

			sendResult, sendErr := dispatcher.Sender.Send(ctx, subscription, candidate.Payload)
			if sendErr != nil {
				if sendResult.Expired {
					if err := dispatcher.Store.DisableSubscription(ctx, subscription.ID); err != nil {
						return result, fmt.Errorf("disable expired subscription %s: %w", subscription.ID, err)
					}
				}
				if err := dispatcher.Store.MarkFailed(ctx, candidate.Identity, now, sendErr.Error()); err != nil {
					return result, fmt.Errorf("mark notification %s failed: %w", candidate.Identity, err)
				}
				result.Failed++
				continue
			}

			if err := dispatcher.Store.MarkSent(ctx, candidate.Identity, now); err != nil {
				return result, fmt.Errorf("mark notification %s sent: %w", candidate.Identity, err)
			}
			result.Sent++
		}
	}

	return result, nil
}
