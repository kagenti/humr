package reconciler

import (
	"fmt"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/kagenti/humr/packages/controller/pkg/config"
	"github.com/kagenti/humr/packages/controller/pkg/types"
)

// BuildPVCs creates PersistentVolumeClaim objects for each persistent mount
// defined in the agent spec. In the Job model, PVCs are created eagerly by the
// controller (Jobs don't support VolumeClaimTemplates).
func BuildPVCs(name string, agentSpec *types.AgentSpec, cfg *config.Config, ownerCM *corev1.ConfigMap) []*corev1.PersistentVolumeClaim {
	labels := map[string]string{"humr.ai/instance": name}
	var pvcs []*corev1.PersistentVolumeClaim

	for _, m := range agentSpec.Mounts {
		if !m.Persist {
			continue
		}
		volName := types.SanitizeMountName(m.Path)
		pvcs = append(pvcs, &corev1.PersistentVolumeClaim{
			ObjectMeta: metav1.ObjectMeta{
				// Match naming convention from the old VolumeClaimTemplates:
				// <volName>-<instanceName>-0
				Name:      fmt.Sprintf("%s-%s-0", volName, name),
				Namespace: cfg.Namespace,
				Labels:    labels,
				OwnerReferences: []metav1.OwnerReference{
					*metav1.NewControllerRef(ownerCM, corev1.SchemeGroupVersion.WithKind("ConfigMap")),
				},
			},
			Spec: corev1.PersistentVolumeClaimSpec{
				AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
				Resources: corev1.VolumeResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceStorage: resource.MustParse("10Gi"),
					},
				},
			},
		})
	}
	return pvcs
}

func BuildNetworkPolicy(name string, cfg *config.Config, ownerCM *corev1.ConfigMap) *networkingv1.NetworkPolicy {
	tcp := corev1.ProtocolTCP
	udp := corev1.ProtocolUDP
	acpPort := intstr.FromInt32(8080)
	gwPort := intstr.FromInt32(int32(cfg.GatewayPort))
	webPort := intstr.FromInt32(int32(cfg.WebPort))
	apiServerPort := intstr.FromInt32(4000)
	dnsPort := intstr.FromInt32(53)
	dnsTargetPort := intstr.FromInt32(5353)

	return &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name + "-egress",
			Namespace: cfg.Namespace,
			Labels:    map[string]string{"humr.ai/instance": name},
			OwnerReferences: []metav1.OwnerReference{
				*metav1.NewControllerRef(ownerCM, corev1.SchemeGroupVersion.WithKind("ConfigMap")),
			},
		},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{
				MatchLabels: map[string]string{"humr.ai/instance": name},
			},
			PolicyTypes: []networkingv1.PolicyType{
				networkingv1.PolicyTypeEgress,
				networkingv1.PolicyTypeIngress,
			},
			Egress: []networkingv1.NetworkPolicyEgressRule{
				{
					// OneCLI (cross-namespace: runs in the release namespace)
					// Gateway port for HTTPS proxy, web port for container-config (CA cert fetch)
					To: []networkingv1.NetworkPolicyPeer{{
						PodSelector: &metav1.LabelSelector{
							MatchLabels: map[string]string{"app.kubernetes.io/component": "onecli"},
						},
						NamespaceSelector: &metav1.LabelSelector{
							MatchLabels: map[string]string{"kubernetes.io/metadata.name": cfg.ReleaseNamespace},
						},
					}},
					Ports: []networkingv1.NetworkPolicyPort{
						{Protocol: &tcp, Port: &gwPort},
						{Protocol: &tcp, Port: &webPort},
					},
				},
				{
					// API Server (cross-namespace: runs in the release namespace)
					// Agent-runtime calls internal session endpoints for schedule session persistence
					To: []networkingv1.NetworkPolicyPeer{{
						PodSelector: &metav1.LabelSelector{
							MatchLabels: map[string]string{"app.kubernetes.io/component": "apiserver"},
						},
						NamespaceSelector: &metav1.LabelSelector{
							MatchLabels: map[string]string{"kubernetes.io/metadata.name": cfg.ReleaseNamespace},
						},
					}},
					Ports: []networkingv1.NetworkPolicyPort{
						{Protocol: &tcp, Port: &apiServerPort},
					},
				},
				{
					// DNS — allow both port 53 (service port) and 5353 (target port).
					// OVN-Kubernetes evaluates egress policy after DNAT, so the policy
					// sees the post-DNAT target port. OpenShift DNS pods run CoreDNS
					// on 5353 behind a Service that maps 53→5353.
					Ports: []networkingv1.NetworkPolicyPort{
						{Protocol: &tcp, Port: &dnsPort},
						{Protocol: &udp, Port: &dnsPort},
						{Protocol: &tcp, Port: &dnsTargetPort},
						{Protocol: &udp, Port: &dnsTargetPort},
					},
				},
			},
			Ingress: []networkingv1.NetworkPolicyIngressRule{{
				Ports: []networkingv1.NetworkPolicyPort{{
					Protocol: &tcp, Port: &acpPort,
				}},
			}},
		},
	}
}
