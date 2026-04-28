package reconciler

import (
	"bytes"
	"context"
	"fmt"
	"sort"
	"text/template"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	"k8s.io/client-go/kubernetes"

	"github.com/kagenti/humr/packages/controller/pkg/config"
)

// Envoy sidecar wiring for the experimental credential-injector path (ADR-033).
//
// Scope of #337: Envoy proxies all egress for the agent container. Per-Secret
// routes inject a credential under the configured header for the matching host.
// The credential file content is produced by the api-server's K8sSecretsPort
// (which bakes any header prefix into the file) and read verbatim by Envoy's
// generic credential source. SDS hot-reload picks up file changes without a
// restart; topology changes (new/removed Secrets, host edits) regenerate the
// bootstrap ConfigMap and roll the StatefulSet.

const (
	envoyOwnerLabel       = "humr.ai/owner"
	envoyManagedByLabel   = "humr.ai/managed-by"
	envoySecretTypeLabel  = "humr.ai/secret-type"
	envoyHostPatternAnn   = "humr.ai/host-pattern"
	envoyHeaderNameAnn    = "humr.ai/injection-header-name"
	envoyBootstrapVolume  = "envoy-bootstrap"
	envoyBootstrapMount   = "/etc/envoy"
	envoyCredentialsRoot   = "/etc/envoy/credentials"
	envoyCredentialKeySDS  = "sds.yaml"  // SDS DiscoveryResponse file (expected by path_config_source)
	envoyCredentialSDSName = "credential" // SDS resource name produced by api-server's K8sSecretsPort
	envoyLeafTLSVolume     = "envoy-tls"
	envoyLeafTLSMount      = "/etc/envoy/tls"
)

// EnvoyBootstrapName returns the per-instance ConfigMap name carrying the
// Envoy bootstrap YAML.
func EnvoyBootstrapName(instanceName string) string {
	return instanceName + "-envoy-bootstrap"
}

// envoyRoute is the per-Secret data the bootstrap template needs.
type envoyRoute struct {
	SecretName string // K8s Secret name, used for the per-route credential file path
	Host       string // host the credential is scoped to (matched on :authority)
	HeaderName string // header to inject (e.g. "Authorization")
	VolumeName string // pod-level volume name for this Secret
}

// listOwnerCredentialSecrets returns the K8s Secrets the api-server has
// written for this owner. Secrets predating #337 (still OneCLI-only) are not
// visible here — only newly-created secrets surface for the experimental path.
func listOwnerCredentialSecrets(ctx context.Context, client kubernetes.Interface, namespace, owner string) ([]corev1.Secret, error) {
	if owner == "" {
		return nil, nil
	}
	selector := fmt.Sprintf("%s=%s,%s=api-server", envoyOwnerLabel, owner, envoyManagedByLabel)
	list, err := client.CoreV1().Secrets(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, fmt.Errorf("listing owner credential secrets: %w", err)
	}
	// Stable order so bootstrap regen is deterministic across reconciles.
	items := append([]corev1.Secret(nil), list.Items...)
	sort.Slice(items, func(i, j int) bool { return items[i].Name < items[j].Name })
	return items, nil
}

func routesFromSecrets(secrets []corev1.Secret) []envoyRoute {
	routes := make([]envoyRoute, 0, len(secrets))
	for _, s := range secrets {
		host := s.Annotations[envoyHostPatternAnn]
		if host == "" {
			continue
		}
		header := s.Annotations[envoyHeaderNameAnn]
		if header == "" {
			header = "Authorization"
		}
		routes = append(routes, envoyRoute{
			SecretName: s.Name,
			Host:       host,
			HeaderName: header,
			VolumeName: "cred-" + s.Name,
		})
	}
	return routes
}

// Bootstrap template — TLS-intercepting CONNECT proxy.
//
// Topology:
//   1. The agent points HTTP(S)_PROXY at 127.0.0.1:<port>. All egress arrives
//      as HTTP CONNECT.
//   2. The OUTER listener on that port is an HCM that terminates the agent's
//      CONNECT and routes the inner stream into the INTERNAL listener (Envoy's
//      "internal listener" feature, addressed via envoy_internal_address).
//   3. The INTERNAL listener uses tls_inspector to read SNI. One filter chain
//      per known host terminates TLS with that host's leaf cert; default
//      filter chain (SNI miss) does TCP passthrough via sni_dynamic_forward_proxy.
//   4. Inside a TLS-terminating chain, an HCM runs credential_injector + the
//      HTTP dynamic_forward_proxy, which re-originates upstream TLS to the
//      real host using the inner request's Host header.
//
// Notes:
//   - credential_injector lives at the HCM level (not per-route) because each
//      filter chain's HCM is already host-specific. No composite filter needed.
//   - Upstream TLS validation uses Envoy's default system trust bundle; the
//      sidecar image must ship one (envoy-distroless does).
//   - Admin interface intentionally omitted (ADR-033 threat model: the agent
//      shares the network namespace).

const envoyBootstrapTmpl = `node:
  id: humr-credential-injector
  cluster: humr-credential-injector
bootstrap_extensions:
  - name: envoy.bootstrap.internal_listener
    typed_config:
      "@type": type.googleapis.com/envoy.extensions.bootstrap.internal_listener.v3.InternalListener
static_resources:
  listeners:
    - name: agent_egress
      address:
        socket_address: { address: 127.0.0.1, port_value: {{ .Port }} }
      filter_chains:
        - filters:
            - name: envoy.filters.network.http_connection_manager
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
                stat_prefix: agent_egress
                upgrade_configs:
                  - upgrade_type: CONNECT
                http_filters:
                  - name: envoy.filters.http.router
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router
                route_config:
                  name: connect_routes
                  virtual_hosts:
                    - name: connect
                      domains: [ "*" ]
                      routes:
                        - match: { connect_matcher: {} }
                          route:
                            cluster: tls_inspect_internal
                            upgrade_configs:
                              - upgrade_type: CONNECT
                                connect_config: {}

    - name: tls_inspect_internal
      internal_listener: {}
      listener_filters:
        - name: envoy.filters.listener.tls_inspector
          typed_config:
            "@type": type.googleapis.com/envoy.extensions.filters.listener.tls_inspector.v3.TlsInspector
      filter_chains:
{{- range .Routes }}
        - name: terminate_{{ .SecretName }}
          filter_chain_match:
            server_names: [ "{{ .Host }}" ]
          transport_socket:
            name: envoy.transport_sockets.tls
            typed_config:
              "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext
              common_tls_context:
                tls_certificates:
                  - certificate_chain: { filename: {{ $.LeafTLSDir }}/tls.crt }
                    private_key:      { filename: {{ $.LeafTLSDir }}/tls.key }
          filters:
            - name: envoy.filters.network.http_connection_manager
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
                stat_prefix: terminate_{{ .SecretName }}
                http_filters:
                  - name: envoy.filters.http.credential_injector
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.credential_injector.v3.CredentialInjector
                      overwrite: true
                      credential:
                        name: envoy.http.injected_credentials.generic
                        typed_config:
                          "@type": type.googleapis.com/envoy.extensions.http.injected_credentials.generic.v3.Generic
                          credential:
                            name: {{ $.CredentialSDSName }}
                            sds_config:
                              path_config_source:
                                path: {{ $.CredentialsRoot }}/{{ .VolumeName }}/{{ $.CredentialFile }}
                          header: "{{ .HeaderName }}"
                  - name: envoy.filters.http.dynamic_forward_proxy
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.dynamic_forward_proxy.v3.FilterConfig
                      dns_cache_config:
                        name: dns_cache
                        dns_lookup_family: V4_PREFERRED
                  - name: envoy.filters.http.router
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router
                route_config:
                  name: forward_{{ .SecretName }}
                  virtual_hosts:
                    - name: default
                      domains: [ "*" ]
                      routes:
                        - match: { prefix: "/" }
                          route:
                            cluster: dynamic_forward_proxy_https
                            timeout: 0s
{{- end }}
        # SNI miss: pass the encrypted bytes through to the real upstream.
        # No injection (we don't know what's inside) and no termination.
        - name: passthrough
          filters:
            - name: envoy.filters.network.sni_dynamic_forward_proxy
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.sni_dynamic_forward_proxy.v3.FilterConfig
                port_value: 443
                dns_cache_config:
                  name: dns_cache
                  dns_lookup_family: V4_PREFERRED
            - name: envoy.filters.network.tcp_proxy
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.tcp_proxy.v3.TcpProxy
                stat_prefix: passthrough
                cluster: dynamic_forward_proxy_tcp

  clusters:
    - name: tls_inspect_internal
      connect_timeout: 1s
      load_assignment:
        cluster_name: tls_inspect_internal
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    envoy_internal_address:
                      server_listener_name: tls_inspect_internal

    - name: dynamic_forward_proxy_https
      connect_timeout: 5s
      lb_policy: CLUSTER_PROVIDED
      cluster_type:
        name: envoy.clusters.dynamic_forward_proxy
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.clusters.dynamic_forward_proxy.v3.ClusterConfig
          dns_cache_config:
            name: dns_cache
            dns_lookup_family: V4_PREFERRED
      transport_socket:
        name: envoy.transport_sockets.tls
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext
          common_tls_context:
            validation_context:
              # Trust the host's system root CA bundle. envoy-distroless ships
              # one at /etc/ssl/certs/ca-certificates.crt; we point at it
              # explicitly because system_root_certs is gated behind a runtime
              # flag in 1.32.
              trusted_ca:
                filename: /etc/ssl/certs/ca-certificates.crt

    - name: dynamic_forward_proxy_tcp
      connect_timeout: 5s
      lb_policy: CLUSTER_PROVIDED
      cluster_type:
        name: envoy.clusters.dynamic_forward_proxy
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.clusters.dynamic_forward_proxy.v3.ClusterConfig
          dns_cache_config:
            name: dns_cache
            dns_lookup_family: V4_PREFERRED
`

// renderEnvoyBootstrap returns the Envoy bootstrap YAML for an instance.
func renderEnvoyBootstrap(cfg *config.Config, routes []envoyRoute) (string, error) {
	tmpl, err := template.New("envoy").Parse(envoyBootstrapTmpl)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, struct {
		Port              int
		Routes            []envoyRoute
		CredentialsRoot   string
		CredentialFile    string
		CredentialSDSName string
		LeafTLSDir        string
	}{
		Port:              cfg.EnvoyPort,
		Routes:            routes,
		CredentialsRoot:   envoyCredentialsRoot,
		CredentialFile:    envoyCredentialKeySDS,
		CredentialSDSName: envoyCredentialSDSName,
		LeafTLSDir:        envoyLeafTLSMount,
	}); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// BuildEnvoyBootstrapConfigMap is the desired ConfigMap holding the rendered
// Envoy bootstrap YAML for an instance.
func BuildEnvoyBootstrapConfigMap(instanceName string, cfg *config.Config, ownerCM *corev1.ConfigMap, secrets []corev1.Secret) (*corev1.ConfigMap, error) {
	routes := routesFromSecrets(secrets)
	yaml, err := renderEnvoyBootstrap(cfg, routes)
	if err != nil {
		return nil, err
	}
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      EnvoyBootstrapName(instanceName),
			Namespace: cfg.Namespace,
			Labels:    map[string]string{"humr.ai/instance": instanceName},
			OwnerReferences: []metav1.OwnerReference{
				*metav1.NewControllerRef(ownerCM, corev1.SchemeGroupVersion.WithKind("ConfigMap")),
			},
		},
		Data: map[string]string{"envoy.yaml": yaml},
	}, nil
}

// envoySidecarVolumes returns the pod-level volumes that back the sidecar's
// bootstrap ConfigMap, per-Secret credential files, and the cert-manager-issued
// TLS leaf used to terminate the agent's intercepted TLS. None of these are
// referenced from the agent container — the credential boundary lives at the
// container, not the pod.
func envoySidecarVolumes(instanceName string, secrets []corev1.Secret) []corev1.Volume {
	volumes := []corev1.Volume{{
		Name: envoyBootstrapVolume,
		VolumeSource: corev1.VolumeSource{
			ConfigMap: &corev1.ConfigMapVolumeSource{
				LocalObjectReference: corev1.LocalObjectReference{Name: EnvoyBootstrapName(instanceName)},
			},
		},
	}}
	for _, s := range secrets {
		volumes = append(volumes, corev1.Volume{
			Name: "cred-" + s.Name,
			VolumeSource: corev1.VolumeSource{
				Secret: &corev1.SecretVolumeSource{SecretName: s.Name},
			},
		})
	}
	// Optional: only present when there are routes (and therefore a leaf cert).
	// On a flag-on instance with no credential Secrets, we render the bootstrap
	// without TLS-terminating chains, so the volume is not needed.
	if len(secrets) > 0 {
		volumes = append(volumes, corev1.Volume{
			Name: envoyLeafTLSVolume,
			VolumeSource: corev1.VolumeSource{
				Secret: &corev1.SecretVolumeSource{
					SecretName: EnvoyLeafSecretName(instanceName),
					// Don't require — cert-manager fills this Secret asynchronously.
					// Pod will block on volume mount until the Secret exists.
					Optional: ptrBool(false),
				},
			},
		})
	}
	return volumes
}

func ptrBool(b bool) *bool { return &b }

// envoySidecarContainer returns the Envoy sidecar spec. Drops all caps,
// ReadOnlyRootFilesystem; mounts only the bootstrap CM and the owner's
// credential Secrets.
func envoySidecarContainer(cfg *config.Config, secrets []corev1.Secret) corev1.Container {
	mounts := []corev1.VolumeMount{{
		Name:      envoyBootstrapVolume,
		MountPath: envoyBootstrapMount,
		ReadOnly:  true,
	}}
	for _, s := range secrets {
		mounts = append(mounts, corev1.VolumeMount{
			Name:      "cred-" + s.Name,
			MountPath: envoyCredentialsRoot + "/cred-" + s.Name,
			ReadOnly:  true,
		})
	}
	if len(secrets) > 0 {
		mounts = append(mounts, corev1.VolumeMount{
			Name:      envoyLeafTLSVolume,
			MountPath: envoyLeafTLSMount,
			ReadOnly:  true,
		})
	}
	readOnlyRoot := true
	runAsNonRoot := true
	return corev1.Container{
		Name:            "envoy",
		Image:           cfg.EnvoyImage,
		ImagePullPolicy: corev1.PullIfNotPresent,
		Args: []string{
			"--config-path", envoyBootstrapMount + "/envoy.yaml",
			"--log-level", "info",
		},
		VolumeMounts: mounts,
		Resources: corev1.ResourceRequirements{
			Requests: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("50m"),
				corev1.ResourceMemory: resource.MustParse("64Mi"),
			},
		},
		SecurityContext: &corev1.SecurityContext{
			Capabilities:           &corev1.Capabilities{Drop: []corev1.Capability{"ALL"}},
			ReadOnlyRootFilesystem: &readOnlyRoot,
			RunAsNonRoot:           &runAsNonRoot,
		},
	}
}
