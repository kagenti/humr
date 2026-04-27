package lifecycle

import (
	"context"
	"math/rand"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// pollUntilReady polls isReady with exponential backoff + jitter.
//
// Backoff: start fast so a quick wake is still detected quickly, then slow
// down so a pod that takes longer doesn't get hammered for the full deadline.
// Jitter: ±20% so many callers waking at once desync within a few iterations
// instead of polling in lockstep bursts.
//
// NOTE: mirrored in packages/api-server/src/modules/agents/infrastructure/poll-until-ready.ts (TS).
// Keep behaviour, constants, and the shape of the loop in sync across both.
func pollUntilReady(
	ctx context.Context,
	isReady func(context.Context) bool,
	initial, max, timeout time.Duration,
) bool {
	deadline := time.Now().Add(timeout)
	interval := initial
	for time.Now().Before(deadline) {
		if isReady(ctx) {
			return true
		}
		jittered := time.Duration(float64(interval) * (0.8 + 0.4*rand.Float64()))
		select {
		case <-ctx.Done():
			return false
		case <-time.After(jittered):
		}
		interval = interval * 3 / 2
		if interval > max {
			interval = max
		}
	}
	return false
}

// waitForPodReady polls until the pod is Ready or the timeout expires. A
// NotFound pod counts as "not ready yet" — the reconciler may be mid-scale-up.
func (l *Lifecycle) waitForPodReady(ctx context.Context, podName string) bool {
	return pollUntilReady(ctx, func(ctx context.Context) bool {
		ready, _ := podIsReady(ctx, l.client, l.namespace, podName)
		return ready
	}, l.pollInitial, l.pollMax, l.pollTimeout)
}

// podIsReady returns true iff a pod with the given name exists and has
// PodReady=True. NotFound and transport errors return (false, nil) so callers
// can treat them as "not ready yet" without distinguishing.
func podIsReady(ctx context.Context, client kubernetes.Interface, namespace, podName string) (bool, error) {
	pod, err := client.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return false, nil
	}
	for _, c := range pod.Status.Conditions {
		if c.Type == corev1.PodReady && c.Status == corev1.ConditionTrue {
			return true, nil
		}
	}
	return false, nil
}
