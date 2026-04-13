export const DEFAULT_TEMPLATE_SPEC = {
  mounts: [
    { path: "/workspace", persist: true },
    { path: "/home/agent", persist: true },
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

export const DEFAULT_HEARTBEAT_INTERVAL_MINUTES = 5;
