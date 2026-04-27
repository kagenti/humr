package reconciler

import (
	"fmt"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/kagenti/humr/packages/controller/pkg/config"
	"github.com/kagenti/humr/packages/controller/pkg/types"
)

const (
	ForkJobLabelType     = "agent-fork-job"
	ForkLabelForkID      = "humr.ai/fork-id"
	ForkLabelInstanceRef = "humr.ai/instance"
	ForkLabelType        = "humr.ai/type"
)

func BuildForkJob(
	forkName string,
	forkSpec *types.ForkSpec,
	instanceSpec *types.InstanceSpec,
	agentSpec *types.AgentSpec,
	cfg *config.Config,
	ownerCM *corev1.ConfigMap,
	connectorEnvs []corev1.EnvVar,
) *batchv1.Job {
	labels := map[string]string{
		ForkLabelType:        ForkJobLabelType,
		ForkLabelForkID:      forkName,
		ForkLabelInstanceRef: forkSpec.Instance,
	}

	proxyAddr := fmt.Sprintf("http://x:$(ONECLI_ACCESS_TOKEN)@%s:%d", cfg.GatewayFQDN(), cfg.GatewayPort)
	caCertPath := "/etc/humr/ca/ca.crt"

	env := []corev1.EnvVar{
		{Name: "ONECLI_ACCESS_TOKEN", Value: forkSpec.AccessToken},
		{Name: "HTTPS_PROXY", Value: proxyAddr},
		{Name: "HTTP_PROXY", Value: proxyAddr},
		{Name: "https_proxy", Value: proxyAddr},
		{Name: "http_proxy", Value: proxyAddr},
		{Name: "NO_PROXY", Value: cfg.APIServerHost},
		{Name: "no_proxy", Value: cfg.APIServerHost},
		{Name: "SSL_CERT_FILE", Value: caCertPath},
		{Name: "NODE_EXTRA_CA_CERTS", Value: caCertPath},
		{Name: "GIT_SSL_CAINFO", Value: caCertPath},
		{Name: "NODE_USE_ENV_PROXY", Value: "1"},
		{Name: "GIT_HTTP_PROXY_AUTHMETHOD", Value: "basic"},
		{Name: "GH_TOKEN", Value: "humr:sentinel"},
		{Name: "ADK_INSTANCE_ID", Value: forkSpec.Instance},
		{Name: "API_SERVER_URL", Value: cfg.APIServerURL()},
		{Name: "HOME", Value: cfg.AgentHome},
		{Name: "HUMR_MCP_URL", Value: fmt.Sprintf("%s/api/instances/%s/mcp", cfg.HarnessServerURL, forkSpec.Instance)},
		{Name: "HUMR_FORK_ID", Value: forkName},
		{Name: "HUMR_FOREIGN_SUB", Value: forkSpec.ForeignSub},
	}
	env = append(env, connectorEnvs...)
	for _, e := range agentSpec.Env {
		env = append(env, corev1.EnvVar{Name: e.Name, Value: e.Value})
	}
	for _, e := range instanceSpec.Env {
		env = append(env, corev1.EnvVar{Name: e.Name, Value: e.Value})
	}

	var envFrom []corev1.EnvFromSource
	if instanceSpec.SecretRef != "" {
		envFrom = append(envFrom, corev1.EnvFromSource{
			SecretRef: &corev1.SecretEnvSource{
				LocalObjectReference: corev1.LocalObjectReference{Name: instanceSpec.SecretRef},
			},
		})
	}

	var volumes []corev1.Volume
	var volumeMounts []corev1.VolumeMount

	for _, m := range agentSpec.Mounts {
		volName := types.SanitizeMountName(m.Path)
		volumeMounts = append(volumeMounts, corev1.VolumeMount{
			Name: volName, MountPath: m.Path,
		})
		if m.Persist {
			pvcName := fmt.Sprintf("%s-%s-0", volName, forkSpec.Instance)
			volumes = append(volumes, corev1.Volume{
				Name: volName,
				VolumeSource: corev1.VolumeSource{
					PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{
						ClaimName: pvcName,
					},
				},
			})
		} else {
			volumes = append(volumes, corev1.Volume{
				Name:         volName,
				VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}},
			})
		}
	}

	volumes = append(volumes, corev1.Volume{
		Name:         "ca-cert",
		VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}},
	})
	volumeMounts = append(volumeMounts, corev1.VolumeMount{
		Name: "ca-cert", MountPath: "/etc/humr/ca", ReadOnly: true,
	})

	resourceReqs := corev1.ResourceRequirements{}
	if agentSpec.Resources.Requests != nil {
		resourceReqs.Requests = toResourceList(agentSpec.Resources.Requests)
	}
	if agentSpec.Resources.Limits != nil {
		resourceReqs.Limits = toResourceList(agentSpec.Resources.Limits)
	}

	caCertScript := fmt.Sprintf(
		`until wget -qO /etc/humr/ca/ca.crt "%s/api/gateway/ca" 2>/dev/null; do sleep 2; done`,
		cfg.WebURL())

	initContainers := []corev1.Container{{
		Name:            "fetch-ca-cert",
		Image:           cfg.CACertInitImage,
		ImagePullPolicy: corev1.PullIfNotPresent,
		Command:         []string{"sh", "-c", caCertScript},
		VolumeMounts: []corev1.VolumeMount{{
			Name: "ca-cert", MountPath: "/etc/humr/ca",
		}},
	}}
	if agentSpec.Init != "" {
		initContainers = append(initContainers, corev1.Container{
			Name:            "init",
			Image:           agentSpec.Image,
			ImagePullPolicy: corev1.PullPolicy(cfg.AgentImagePullPolicy),
			Command:         []string{"sh", "-c", agentSpec.Init},
			VolumeMounts:    volumeMounts,
		})
	}

	var pullSecrets []corev1.LocalObjectReference
	for _, name := range cfg.AgentImagePullSecrets {
		pullSecrets = append(pullSecrets, corev1.LocalObjectReference{Name: name})
	}

	var podSec *corev1.PodSecurityContext
	if agentSpec.SecurityContext != nil {
		podSec = &corev1.PodSecurityContext{
			RunAsNonRoot: agentSpec.SecurityContext.RunAsNonRoot,
		}
	}

	ttl := int32(60)
	backoff := int32(0)

	return &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      forkName,
			Namespace: cfg.Namespace,
			Labels:    labels,
			OwnerReferences: []metav1.OwnerReference{
				*metav1.NewControllerRef(ownerCM, corev1.SchemeGroupVersion.WithKind("ConfigMap")),
			},
		},
		Spec: batchv1.JobSpec{
			BackoffLimit:            &backoff,
			TTLSecondsAfterFinished: &ttl,
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: labels},
				Spec: corev1.PodSpec{
					RestartPolicy:                 corev1.RestartPolicyNever,
					TerminationGracePeriodSeconds: &cfg.TerminationGracePeriod,
					ImagePullSecrets:              pullSecrets,
					SecurityContext:               podSec,
					InitContainers:                initContainers,
					Containers: []corev1.Container{{
						Name:            "agent",
						Image:           agentSpec.Image,
						ImagePullPolicy: corev1.PullPolicy(cfg.AgentImagePullPolicy),
						Ports: []corev1.ContainerPort{{
							Name: "acp", ContainerPort: 8080,
						}},
						Env:     env,
						EnvFrom: envFrom,
						ReadinessProbe: &corev1.Probe{
							ProbeHandler:  corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/healthz", Port: intstr.FromString("acp")}},
							PeriodSeconds: 1,
						},
						LivenessProbe: &corev1.Probe{
							ProbeHandler:        corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/healthz", Port: intstr.FromString("acp")}},
							InitialDelaySeconds: 10,
							PeriodSeconds:       10,
						},
						SecurityContext: &corev1.SecurityContext{
							Capabilities: &corev1.Capabilities{
								Drop: []corev1.Capability{"ALL"},
							},
						},
						Resources:    resourceReqs,
						VolumeMounts: volumeMounts,
					}},
					Volumes: volumes,
				},
			},
		},
	}
}
