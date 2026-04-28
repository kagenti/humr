# Deploy to Kubernetes

The [Quickstart](quickstart.md) runs Humr locally in a k3s VM. This page covers deploying to a real Kubernetes cluster — EKS, GKE, AKS, or any conformant distribution.

## Prerequisites

- A Kubernetes cluster (1.27+)
- [Helm](https://helm.sh/) 3.x
- An ingress controller (Traefik, nginx-ingress, etc.)
- A domain with wildcard DNS pointing to your ingress (e.g. `*.humr.example.com`)
- TLS certificates (via cert-manager or your own)

## Install with Helm

The chart lives in `deploy/helm/humr/`. Create a values file for your environment:

```yaml
# values-prod.yaml
domain: humr.example.com
port: ""          # empty = standard 443
scheme: https

ingress:
  enabled: true
  aliasDomains: []
  tls:
    - secretName: humr-tls
      hosts:
        - humr.humr.example.com
        - humr-api.humr.example.com
        - keycloak.humr.example.com
        - onecli.humr.example.com
```

Install:

```sh
helm install humr deploy/helm/humr/ -f values-prod.yaml -n humr --create-namespace
```

This deploys: PostgreSQL, Keycloak (identity), OneCLI (credential proxy), the controller, API server, and UI. Services are exposed at subdomains of your domain: `humr.`, `humr-api.`, `keycloak.`, `onecli.`.

## Key configuration

### Domain and TLS

| Value | Default | Description |
|---|---|---|
| `domain` | `localhost` | Base domain — all services use subdomains of this |
| `port` | `4444` | Port appended to URLs (empty for standard 80/443) |
| `scheme` | `http` | `https` for production |

### Database

The chart bundles a PostgreSQL StatefulSet for simplicity. For production, point each service at a managed database instead:

```yaml
postgres:
  enabled: false

onecli:
  db:
    host: your-rds-host.amazonaws.com
    port: 5432
    user: humr
    password: your-password
    database: onecli

keycloak:
  db:
    host: your-rds-host.amazonaws.com
    database: keycloak

apiServer:
  db:
    host: your-rds-host.amazonaws.com
    database: humr
```

### Authentication

Keycloak handles identity. In production, disable the test user and set strong admin credentials:

```yaml
keycloak:
  admin:
    password: a-strong-password
  testUser:
    enabled: false    # disabled by default — local dev enables it
```

### Agent storage

Agent workspaces need **ReadWriteMany** (RWX) persistent volumes so fork pods can mount the same volume concurrently. On managed Kubernetes, point to your cloud's RWX storage class:

| Cloud | Storage class |
|---|---|
| AWS EKS | EFS (`efs-sc`) |
| GCP GKE | Filestore (`filestore-sc`) |
| Azure AKS | Azure Files (`azurefile`) |

```yaml
controller:
  agentStorageClass: efs-sc    # or your cluster's RWX class
```

For dev clusters without RWX, the chart includes an optional in-cluster NFS provisioner:

```yaml
nfsProvisioner:
  enabled: true
controller:
  agentStorageClass: humr-rwx
```

### Container images

All images default to `ghcr.io/kagenti/humr/*`. Override if you mirror to a private registry:

```yaml
imagePullSecrets:
  - name: my-registry-secret

ui:
  image:
    repository: your-registry/humr/ui
apiServer:
  image:
    repository: your-registry/humr/api-server
controller:
  image:
    repository: your-registry/humr/controller
```

## Upgrading

```sh
helm upgrade humr deploy/helm/humr/ -f values-prod.yaml -n humr
```

The controller and API server handle rolling updates. Agent pods are managed by StatefulSets — running agents aren't disrupted during a platform upgrade.

## What gets deployed

| Component | What it does |
|---|---|
| **Controller** | Go reconciler — watches ConfigMaps, creates agent pods, runs the cron scheduler |
| **API Server** | TypeScript — REST API, WebSocket relay to agents, Slack/Telegram integration |
| **UI** | React SPA served by nginx, proxies API calls to the API server |
| **OneCLI** | Credential proxy — injects API keys into agent requests at the HTTP layer |
| **Keycloak** | OIDC identity provider — handles login, multi-user auth, token exchange |
| **PostgreSQL** | Backing store for sessions, channels, identity links (optional — use managed DB in production) |
