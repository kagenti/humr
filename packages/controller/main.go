package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	// Embed the IANA tzdata database in the binary so time.LoadLocation works
	// for arbitrary zones (e.g. "Europe/Prague") inside the minimal container
	// image, which doesn't ship /usr/share/zoneinfo. Schedules set their own
	// timezone, so UTC-only wouldn't be enough.
	_ "time/tzdata"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/tools/leaderelection"
	"k8s.io/client-go/tools/leaderelection/resourcelock"
	"k8s.io/client-go/util/workqueue"

	"github.com/kagenti/humr/packages/controller/pkg/config"
	"github.com/kagenti/humr/packages/controller/pkg/configsync"
	"github.com/kagenti/humr/packages/controller/pkg/onecli"
	"github.com/kagenti/humr/packages/controller/pkg/reconciler"
	"github.com/kagenti/humr/packages/controller/pkg/scheduler"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "config-sync" {
		runConfigSync()
		return
	}
	cfg, err := config.LoadFromEnv()
	if err != nil {
		slog.Error("loading config", "error", err)
		os.Exit(1)
	}

	restCfg, err := rest.InClusterConfig()
	if err != nil {
		slog.Error("loading in-cluster config", "error", err)
		os.Exit(1)
	}

	client, err := kubernetes.NewForConfig(restCfg)
	if err != nil {
		slog.Error("creating k8s client", "error", err)
		os.Exit(1)
	}

	var onecliFactory onecli.Factory
	if cfg.OneCLIURL != "" && cfg.KeycloakTokenURL != "" {
		onecliFactory = onecli.NewTokenExchangeFactory(onecli.TokenExchangeConfig{
			OneCLIBaseURL:    cfg.OneCLIURL,
			KeycloakTokenURL: cfg.KeycloakTokenURL,
			ClientID:         cfg.KeycloakClientID,
			ClientSecret:     cfg.KeycloakClientSecret,
			OneCLIAudience:   cfg.OneCLIAudience,
		})
		slog.Info("OneCLI token exchange factory configured", "url", cfg.OneCLIURL)
	} else {
		slog.Warn("OneCLI not configured, using noop factory")
		onecliFactory = &onecli.NoopFactory{}
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	lock := &resourcelock.LeaseLock{
		LeaseMeta: metav1.ObjectMeta{Name: cfg.LeaseName, Namespace: cfg.Namespace},
		Client:    client.CoordinationV1(),
		LockConfig: resourcelock.ResourceLockConfig{
			Identity: cfg.PodName,
		},
	}

	leaderelection.RunOrDie(ctx, leaderelection.LeaderElectionConfig{
		Lock:            lock,
		LeaseDuration:   15 * time.Second,
		RenewDeadline:   10 * time.Second,
		RetryPeriod:     2 * time.Second,
		ReleaseOnCancel: true,
		Callbacks: leaderelection.LeaderCallbacks{
			OnStartedLeading: func(ctx context.Context) {
				run(ctx, client, restCfg, cfg, onecliFactory)
			},
			OnStoppedLeading: func() {
				slog.Info("lost leadership")
			},
		},
	})
}

func run(ctx context.Context, client kubernetes.Interface, restCfg *rest.Config, cfg *config.Config, onecliFactory onecli.Factory) {
	slog.Info("started leading", "namespace", cfg.Namespace)

	factory := informers.NewSharedInformerFactoryWithOptions(client, 30*time.Second,
		informers.WithNamespace(cfg.Namespace),
		informers.WithTweakListOptions(func(opts *metav1.ListOptions) {
			opts.LabelSelector = "humr.ai/type"
		}),
	)

	cmInformer := factory.Core().V1().ConfigMaps()
	agentResolver := reconciler.NewAgentResolver(cmInformer.Lister().ConfigMaps(cfg.Namespace))
	agentReconciler := reconciler.NewAgentReconciler(client, cfg, onecliFactory)
	instanceReconciler := reconciler.NewInstanceReconciler(client, cfg, agentResolver, onecliFactory)
	forkReconciler := reconciler.NewForkReconciler(client, cfg, agentResolver, onecliFactory)

	sched := scheduler.New(client, cfg).WithRESTConfig(restCfg)
	sched.Start()
	defer sched.Stop()

	idleChecker := reconciler.NewIdleChecker(client, cfg)
	go idleChecker.RunLoop(ctx)

	queue := workqueue.NewTypedRateLimitingQueue(workqueue.DefaultTypedControllerRateLimiter[string]())
	defer queue.ShutDown()

	cmInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			cm := obj.(*corev1.ConfigMap)
			queue.Add(cm.Namespace + "/" + cm.Name)
		},
		UpdateFunc: func(_, newObj interface{}) {
			cm := newObj.(*corev1.ConfigMap)
			queue.Add(cm.Namespace + "/" + cm.Name)
		},
		DeleteFunc: func(obj interface{}) {
			cm, ok := obj.(*corev1.ConfigMap)
			if !ok {
				tombstone, ok := obj.(cache.DeletedFinalStateUnknown)
				if !ok {
					return
				}
				cm, ok = tombstone.Obj.(*corev1.ConfigMap)
				if !ok {
					return
				}
			}
			cmType := cm.Labels["humr.ai/type"]
			switch cmType {
			case "agent":
				agentReconciler.Delete(ctx, cm.Name, cm.Labels["humr.ai/owner"])
			case "agent-instance":
				instanceReconciler.Delete(ctx, cm.Name)
			case "agent-schedule":
				sched.RemoveSchedule(cm.Name)
			case "agent-fork":
				forkReconciler.Delete(ctx, cm.Name)
			}
		},
	})

	factory.Start(ctx.Done())
	if !cache.WaitForCacheSync(ctx.Done(), cmInformer.Informer().HasSynced) {
		slog.Error("failed to sync informer caches")
		return
	}
	slog.Info("informer caches synced")

	for {
		key, shutdown := queue.Get()
		if shutdown {
			return
		}
		func() {
			defer queue.Done(key)

			name := keyName(key)
			cm, err := cmInformer.Lister().ConfigMaps(cfg.Namespace).Get(name)
			if err != nil {
				queue.Forget(key)
				return
			}

			cmType := cm.Labels["humr.ai/type"]
			switch cmType {
			case "agent":
				if err := agentReconciler.Reconcile(ctx, cm); err != nil {
					slog.Error("reconcile agent", "name", name, "error", err)
					queue.AddRateLimited(key)
					return
				}
			case "agent-instance":
				if err := instanceReconciler.Reconcile(ctx, cm); err != nil {
					slog.Error("reconcile instance", "name", name, "error", err)
					queue.AddRateLimited(key)
					return
				}
			case "agent-schedule":
				if err := sched.SyncSchedule(cm); err != nil {
					slog.Error("sync schedule", "name", name, "error", err)
					queue.AddRateLimited(key)
					return
				}
				slog.Info("synced schedule", "name", name)
			case "agent-fork":
				if err := forkReconciler.Reconcile(ctx, cm); err != nil {
					slog.Error("reconcile fork", "name", name, "error", err)
					queue.AddRateLimited(key)
					return
				}
			}
			queue.Forget(key)
		}()
	}
}

// runConfigSync is the sidecar entrypoint. It reads its options from env and
// flags, holds an SSE connection to the api-server, and writes hosts.yml from
// snapshot/upsert events. See pkg/configsync.
func runConfigSync() {
	fs := flag.NewFlagSet("config-sync", flag.ExitOnError)
	eventsURL := fs.String("events-url", os.Getenv("HUMR_EVENTS_URL"), "API server SSE events URL")
	token := fs.String("token", os.Getenv("ONECLI_ACCESS_TOKEN"), "Bearer token (default $ONECLI_ACCESS_TOKEN)")
	// flag.ExitOnError makes Parse call os.Exit(2) on any parse error — the
	// discard is safe because we never see a non-nil return.
	_ = fs.Parse(os.Args[2:])

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	if err := configsync.Run(ctx, configsync.Options{
		EventsURL: *eventsURL,
		Token:     *token,
	}); err != nil {
		slog.Error("config-sync exited", "error", err)
		os.Exit(1)
	}
}

func keyName(key string) string {
	for i := len(key) - 1; i >= 0; i-- {
		if key[i] == '/' {
			return key[i+1:]
		}
	}
	return key
}
