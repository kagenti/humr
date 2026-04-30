/**
 * Default template spec used when an agent is created from a bare image
 * (no template). The home mount path is taken from the chart-level
 * `agentHome` value so this stays in sync with the rest of the platform.
 */
export function defaultTemplateSpec(agentHome: string) {
  return {
    mounts: [
      { path: agentHome, persist: true },
      { path: "/tmp", persist: false },
    ],
    env: [{ name: "PORT", value: "8080" }],
    resources: {
      requests: { cpu: "250m", memory: "512Mi" },
      limits: { cpu: "1", memory: "2Gi" },
    },
    securityContext: {
      readOnlyRootFilesystem: false,
    },
  };
}
