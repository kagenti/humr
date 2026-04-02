# ADK Sub-Plan 1: Helm Chart & Infrastructure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each task below. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a Helm chart that deploys OneCLI (gateway + web + PostgreSQL), generates CA certs, creates the `adk-agents` namespace, sets up RBAC for Controller and API Server, and seeds a default agent template ConfigMap. After `helm install adk deploy/helm/adk`, OneCLI gateway is reachable, PostgreSQL is running, CA cert Secret exists, and `kubectl get cm -n adk-agents -l humr.ai/type=agent-template` returns the default template.

**Architecture:** Single Helm chart deploys all infrastructure components into the release namespace (default: `default` or user-chosen). Agent workloads run in a separate `adk-agents` namespace created by the chart. OneCLI gateway + web + PostgreSQL form the credential proxy layer. A self-signed CA enables MITM TLS inspection. RBAC grants Controller and API Server the minimum permissions they need.

**Tech Stack:** Helm 3, k3s, PostgreSQL 18 (Alpine), OneCLI (ghcr.io/onecli/onecli:latest), Kubernetes RBAC

**Spec:** [`docs/specs/2026-04-01-agent-platform-design.md`](../specs/2026-04-01-agent-platform-design.md)

---

## Task 1: Chart scaffolding — Chart.yaml, values.yaml, _helpers.tpl

**Files:**
- Create: `deploy/helm/adk/Chart.yaml`
- Create: `deploy/helm/adk/values.yaml`
- Create: `deploy/helm/adk/templates/_helpers.tpl`

### Steps

- [ ] 1. Create `deploy/helm/adk/Chart.yaml`:

```yaml
apiVersion: v2
name: adk
description: ADK — Secure Agent Execution Platform
type: application
version: 0.1.0
appVersion: "0.1.0"
```

- [ ] 2. Create `deploy/helm/adk/values.yaml`:

```yaml
# -- Target namespace for agent workloads (instances, templates, schedules)
agentNamespace: adk-agents

# -- PostgreSQL configuration (OneCLI dependency)
postgres:
  image: postgres:18-alpine
  user: onecli
  # password is auto-generated if not set (see ca-secret.yaml / secrets template)
  password: ""
  database: onecli
  storage: 5Gi
  storageClass: ""
  resources:
    requests:
      cpu: 100m
      memory: 256Mi
    limits:
      cpu: 500m
      memory: 512Mi

# -- OneCLI Gateway configuration
gateway:
  image: ghcr.io/onecli/onecli:latest
  replicas: 1
  port: 10255
  # secretEncryptionKey is auto-generated if not set
  secretEncryptionKey: ""
  resources:
    requests:
      cpu: 100m
      memory: 256Mi
    limits:
      cpu: 500m
      memory: 512Mi

# -- OneCLI Web configuration
web:
  image: ghcr.io/onecli/onecli:latest
  replicas: 1
  port: 10254
  # nextauthSecret is auto-generated if not set
  nextauthSecret: ""
  nextauthUrl: "http://localhost:10254"
  resources:
    requests:
      cpu: 100m
      memory: 256Mi
    limits:
      cpu: 500m
      memory: 512Mi

# -- Self-signed CA for OneCLI MITM TLS
ca:
  # CN for the generated CA certificate
  commonName: "ADK OneCLI CA"
  # Validity in days
  validity: 3650

# -- Default agent template
defaultTemplate:
  enabled: true
  name: code-guardian
  image: "ghcr.io/myorg/code-guardian:latest"
  description: "Persistent agent for repo monitoring"
```

- [ ] 3. Create `deploy/helm/adk/templates/_helpers.tpl`:

```yaml
{{/*
Expand the name of the chart.
*/}}
{{- define "adk.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "adk.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "adk.labels" -}}
helm.sh/chart: {{ include "adk.chart" . }}
{{ include "adk.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "adk.selectorLabels" -}}
app.kubernetes.io/name: {{ include "adk.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Chart label
*/}}
{{- define "adk.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
PostgreSQL fullname
*/}}
{{- define "adk.postgres.fullname" -}}
{{- printf "%s-postgres" (include "adk.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
OneCLI Gateway fullname
*/}}
{{- define "adk.gateway.fullname" -}}
{{- printf "%s-gateway" (include "adk.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
OneCLI Web fullname
*/}}
{{- define "adk.web.fullname" -}}
{{- printf "%s-web" (include "adk.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
OneCLI secrets name (passwords, keys)
*/}}
{{- define "adk.secrets.fullname" -}}
{{- printf "%s-secrets" (include "adk.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
CA secret name
*/}}
{{- define "adk.ca.fullname" -}}
{{- printf "%s-ca" (include "adk.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
CA cert ConfigMap name (public half, for agent pods)
*/}}
{{- define "adk.ca-cert.fullname" -}}
{{- printf "%s-ca-cert" (include "adk.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
PostgreSQL DSN
*/}}
{{- define "adk.postgres.dsn" -}}
{{- printf "postgresql://%s:$(POSTGRES_PASSWORD)@%s:5432/%s" .Values.postgres.user (include "adk.postgres.fullname" .) .Values.postgres.database }}
{{- end }}

{{/*
Controller ServiceAccount name
*/}}
{{- define "adk.controller.serviceAccountName" -}}
{{- printf "%s-controller" (include "adk.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
API Server ServiceAccount name
*/}}
{{- define "adk.apiserver.serviceAccountName" -}}
{{- printf "%s-apiserver" (include "adk.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
```

- [ ] 4. Verify template rendering:

```bash
helm template adk deploy/helm/adk --debug 2>&1 | head -20
```

- [ ] 5. Commit: `feat(helm): scaffold chart with Chart.yaml, values.yaml, helpers`

---

## Task 2: Secrets — auto-generated passwords and encryption keys

**Files:**
- Create: `deploy/helm/adk/templates/secrets.yaml`

### Steps

- [ ] 1. Create `deploy/helm/adk/templates/secrets.yaml`:

```yaml
{{- $secretName := include "adk.secrets.fullname" . }}
{{- $existingSecret := lookup "v1" "Secret" .Release.Namespace $secretName }}
{{- $pgPassword := "" }}
{{- $secretEncKey := "" }}
{{- $nextauthSecret := "" }}
{{- if $existingSecret }}
  {{- $pgPassword = index $existingSecret.data "POSTGRES_PASSWORD" | b64dec }}
  {{- $secretEncKey = index $existingSecret.data "SECRET_ENCRYPTION_KEY" | b64dec }}
  {{- $nextauthSecret = index $existingSecret.data "NEXTAUTH_SECRET" | b64dec }}
{{- else }}
  {{- $pgPassword = default (randAlphaNum 32) .Values.postgres.password }}
  {{- $secretEncKey = default (randAlphaNum 32) .Values.gateway.secretEncryptionKey }}
  {{- $nextauthSecret = default (randAlphaNum 32) .Values.web.nextauthSecret }}
{{- end }}
apiVersion: v1
kind: Secret
metadata:
  name: {{ $secretName }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "adk.labels" . | nindent 4 }}
type: Opaque
data:
  POSTGRES_PASSWORD: {{ $pgPassword | b64enc | quote }}
  SECRET_ENCRYPTION_KEY: {{ $secretEncKey | b64enc | quote }}
  NEXTAUTH_SECRET: {{ $nextauthSecret | b64enc | quote }}
```

- [ ] 2. Verify template renders with auto-generated values:

```bash
helm template adk deploy/helm/adk -s templates/secrets.yaml
```

- [ ] 3. Verify explicit values override auto-generation:

```bash
helm template adk deploy/helm/adk -s templates/secrets.yaml \
  --set postgres.password=explicit123
```

- [ ] 4. Commit: `feat(helm): auto-generated secrets with lookup persistence`

---

## Task 3: CA certificate Secret + ConfigMap

**Files:**
- Create: `deploy/helm/adk/templates/ca-secret.yaml`

### Steps

- [ ] 1. Create `deploy/helm/adk/templates/ca-secret.yaml`:

```yaml
{{/*
  Self-signed CA for OneCLI MITM TLS.
  Uses lookup to preserve across helm upgrade. On first install, generates
  a new CA with genCA. On subsequent upgrades, reuses the existing cert/key.
*/}}
{{- $caSecretName := include "adk.ca.fullname" . }}
{{- $caCertCMName := include "adk.ca-cert.fullname" . }}
{{- $existingCA := lookup "v1" "Secret" .Release.Namespace $caSecretName }}
{{- $caCert := "" }}
{{- $caKey := "" }}
{{- if $existingCA }}
  {{- $caCert = index $existingCA.data "ca.crt" | b64dec }}
  {{- $caKey = index $existingCA.data "ca.key" | b64dec }}
{{- else }}
  {{- $ca := genCA .Values.ca.commonName (int .Values.ca.validity) }}
  {{- $caCert = $ca.Cert }}
  {{- $caKey = $ca.Key }}
{{- end }}
---
apiVersion: v1
kind: Secret
metadata:
  name: {{ $caSecretName }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "adk.labels" . | nindent 4 }}
type: Opaque
data:
  ca.crt: {{ $caCert | b64enc | quote }}
  ca.key: {{ $caKey | b64enc | quote }}
---
# Public CA cert as ConfigMap — mounted into agent pods for TLS trust
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ $caCertCMName }}
  namespace: {{ .Values.agentNamespace }}
  labels:
    {{- include "adk.labels" . | nindent 4 }}
data:
  ca.crt: |
    {{ $caCert | nindent 4 }}
```

- [ ] 2. Verify the Secret and ConfigMap render correctly:

```bash
helm template adk deploy/helm/adk -s templates/ca-secret.yaml
```

- [ ] 3. Verify the ConfigMap targets the agent namespace:

```bash
helm template adk deploy/helm/adk -s templates/ca-secret.yaml \
  | grep "namespace:"
```

- [ ] 4. Commit: `feat(helm): self-signed CA secret with lookup persistence + agent ConfigMap`

---

## Task 4: Namespace creation

**Files:**
- Create: `deploy/helm/adk/templates/namespace.yaml`

### Steps

- [ ] 1. Create `deploy/helm/adk/templates/namespace.yaml`:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: {{ .Values.agentNamespace }}
  labels:
    {{- include "adk.labels" . | nindent 4 }}
    humr.ai/managed-by: adk
```

- [ ] 2. Verify:

```bash
helm template adk deploy/helm/adk -s templates/namespace.yaml
```

- [ ] 3. Commit: `feat(helm): agent namespace creation`

---

## Task 5: PostgreSQL StatefulSet + PVC + Service

**Files:**
- Create: `deploy/helm/adk/templates/onecli-postgres.yaml`

### Steps

- [ ] 1. Create `deploy/helm/adk/templates/onecli-postgres.yaml`:

```yaml
{{- $pgName := include "adk.postgres.fullname" . }}
{{- $secretName := include "adk.secrets.fullname" . }}
---
apiVersion: v1
kind: Service
metadata:
  name: {{ $pgName }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "adk.labels" . | nindent 4 }}
    app.kubernetes.io/component: postgres
spec:
  type: ClusterIP
  ports:
    - port: 5432
      targetPort: 5432
      protocol: TCP
      name: postgres
  selector:
    app.kubernetes.io/component: postgres
    app.kubernetes.io/instance: {{ .Release.Name }}
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: {{ $pgName }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "adk.labels" . | nindent 4 }}
    app.kubernetes.io/component: postgres
spec:
  serviceName: {{ $pgName }}
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/component: postgres
      app.kubernetes.io/instance: {{ .Release.Name }}
  template:
    metadata:
      labels:
        {{- include "adk.labels" . | nindent 8 }}
        app.kubernetes.io/component: postgres
    spec:
      containers:
        - name: postgres
          image: {{ .Values.postgres.image }}
          ports:
            - containerPort: 5432
              name: postgres
          env:
            - name: POSTGRES_USER
              value: {{ .Values.postgres.user | quote }}
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: {{ $secretName }}
                  key: POSTGRES_PASSWORD
            - name: POSTGRES_DB
              value: {{ .Values.postgres.database | quote }}
            - name: PGDATA
              value: /var/lib/postgresql/data/pgdata
          readinessProbe:
            exec:
              command:
                - pg_isready
                - -U
                - {{ .Values.postgres.user | quote }}
            initialDelaySeconds: 5
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 10
          livenessProbe:
            exec:
              command:
                - pg_isready
                - -U
                - {{ .Values.postgres.user | quote }}
            initialDelaySeconds: 15
            periodSeconds: 15
            timeoutSeconds: 3
          resources:
            {{- toYaml .Values.postgres.resources | nindent 12 }}
          volumeMounts:
            - name: pgdata
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: pgdata
      spec:
        accessModes: ["ReadWriteOnce"]
        {{- if .Values.postgres.storageClass }}
        storageClassName: {{ .Values.postgres.storageClass | quote }}
        {{- end }}
        resources:
          requests:
            storage: {{ .Values.postgres.storage }}
```

- [ ] 2. Verify template renders:

```bash
helm template adk deploy/helm/adk -s templates/onecli-postgres.yaml
```

- [ ] 3. Verify the readiness probe and env vars are present:

```bash
helm template adk deploy/helm/adk -s templates/onecli-postgres.yaml \
  | grep -A3 "readinessProbe"
```

- [ ] 4. Commit: `feat(helm): PostgreSQL StatefulSet with PVC, Service, and readiness probe`

---

## Task 6: OneCLI Gateway Deployment + Service

**Files:**
- Create: `deploy/helm/adk/templates/onecli-gateway.yaml`

### Steps

- [ ] 1. Create `deploy/helm/adk/templates/onecli-gateway.yaml`:

```yaml
{{- $gwName := include "adk.gateway.fullname" . }}
{{- $pgName := include "adk.postgres.fullname" . }}
{{- $secretName := include "adk.secrets.fullname" . }}
{{- $caSecretName := include "adk.ca.fullname" . }}
---
apiVersion: v1
kind: Service
metadata:
  name: {{ $gwName }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "adk.labels" . | nindent 4 }}
    app.kubernetes.io/component: gateway
spec:
  type: ClusterIP
  ports:
    - port: {{ .Values.gateway.port }}
      targetPort: {{ .Values.gateway.port }}
      protocol: TCP
      name: gateway
  selector:
    app.kubernetes.io/component: gateway
    app.kubernetes.io/instance: {{ .Release.Name }}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ $gwName }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "adk.labels" . | nindent 4 }}
    app.kubernetes.io/component: gateway
spec:
  replicas: {{ .Values.gateway.replicas }}
  selector:
    matchLabels:
      app.kubernetes.io/component: gateway
      app.kubernetes.io/instance: {{ .Release.Name }}
  template:
    metadata:
      labels:
        {{- include "adk.labels" . | nindent 8 }}
        app.kubernetes.io/component: gateway
    spec:
      containers:
        - name: gateway
          image: {{ .Values.gateway.image }}
          command: ["node"]
          args: ["apps/gateway/dist/main.js"]
          ports:
            - containerPort: {{ .Values.gateway.port }}
              name: gateway
          env:
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: {{ $secretName }}
                  key: POSTGRES_PASSWORD
            - name: DATABASE_URL
              value: "postgresql://{{ .Values.postgres.user }}:$(POSTGRES_PASSWORD)@{{ $pgName }}:5432/{{ .Values.postgres.database }}"
            - name: SECRET_ENCRYPTION_KEY
              valueFrom:
                secretKeyRef:
                  name: {{ $secretName }}
                  key: SECRET_ENCRYPTION_KEY
            - name: GATEWAY_CA_CERT
              valueFrom:
                secretKeyRef:
                  name: {{ $caSecretName }}
                  key: ca.crt
            - name: GATEWAY_CA_KEY
              valueFrom:
                secretKeyRef:
                  name: {{ $caSecretName }}
                  key: ca.key
          readinessProbe:
            tcpSocket:
              port: {{ .Values.gateway.port }}
            initialDelaySeconds: 10
            periodSeconds: 10
            timeoutSeconds: 3
          livenessProbe:
            tcpSocket:
              port: {{ .Values.gateway.port }}
            initialDelaySeconds: 15
            periodSeconds: 30
            timeoutSeconds: 3
          resources:
            {{- toYaml .Values.gateway.resources | nindent 12 }}
```

- [ ] 2. Verify template renders:

```bash
helm template adk deploy/helm/adk -s templates/onecli-gateway.yaml
```

- [ ] 3. Verify DATABASE_URL references the postgres service name:

```bash
helm template adk deploy/helm/adk -s templates/onecli-gateway.yaml \
  | grep DATABASE_URL
```

- [ ] 4. Commit: `feat(helm): OneCLI Gateway Deployment with CA env vars and readiness probe`

---

## Task 7: OneCLI Web Deployment + Service

**Files:**
- Create: `deploy/helm/adk/templates/onecli-web.yaml`

### Steps

- [ ] 1. Create `deploy/helm/adk/templates/onecli-web.yaml`:

```yaml
{{- $webName := include "adk.web.fullname" . }}
{{- $pgName := include "adk.postgres.fullname" . }}
{{- $secretName := include "adk.secrets.fullname" . }}
---
apiVersion: v1
kind: Service
metadata:
  name: {{ $webName }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "adk.labels" . | nindent 4 }}
    app.kubernetes.io/component: web
spec:
  type: ClusterIP
  ports:
    - port: {{ .Values.web.port }}
      targetPort: {{ .Values.web.port }}
      protocol: TCP
      name: web
  selector:
    app.kubernetes.io/component: web
    app.kubernetes.io/instance: {{ .Release.Name }}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ $webName }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "adk.labels" . | nindent 4 }}
    app.kubernetes.io/component: web
spec:
  replicas: {{ .Values.web.replicas }}
  selector:
    matchLabels:
      app.kubernetes.io/component: web
      app.kubernetes.io/instance: {{ .Release.Name }}
  template:
    metadata:
      labels:
        {{- include "adk.labels" . | nindent 8 }}
        app.kubernetes.io/component: web
    spec:
      containers:
        - name: web
          image: {{ .Values.web.image }}
          ports:
            - containerPort: {{ .Values.web.port }}
              name: web
          env:
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: {{ $secretName }}
                  key: POSTGRES_PASSWORD
            - name: DATABASE_URL
              value: "postgresql://{{ .Values.postgres.user }}:$(POSTGRES_PASSWORD)@{{ $pgName }}:5432/{{ .Values.postgres.database }}"
            - name: NEXTAUTH_SECRET
              valueFrom:
                secretKeyRef:
                  name: {{ $secretName }}
                  key: NEXTAUTH_SECRET
            - name: NEXTAUTH_URL
              value: {{ .Values.web.nextauthUrl | quote }}
          readinessProbe:
            tcpSocket:
              port: {{ .Values.web.port }}
            initialDelaySeconds: 10
            periodSeconds: 10
            timeoutSeconds: 3
          livenessProbe:
            tcpSocket:
              port: {{ .Values.web.port }}
            initialDelaySeconds: 15
            periodSeconds: 30
            timeoutSeconds: 3
          resources:
            {{- toYaml .Values.web.resources | nindent 12 }}
```

- [ ] 2. Verify template renders:

```bash
helm template adk deploy/helm/adk -s templates/onecli-web.yaml
```

- [ ] 3. Commit: `feat(helm): OneCLI Web Deployment with auth env vars and readiness probe`

---

## Task 8: RBAC — Controller ServiceAccount + ClusterRole + ClusterRoleBinding

**Files:**
- Create: `deploy/helm/adk/templates/rbac-controller.yaml`

### Steps

- [ ] 1. Create `deploy/helm/adk/templates/rbac-controller.yaml`:

```yaml
{{- $saName := include "adk.controller.serviceAccountName" . }}
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ $saName }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "adk.labels" . | nindent 4 }}
    app.kubernetes.io/component: controller
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: {{ $saName }}
  labels:
    {{- include "adk.labels" . | nindent 4 }}
    app.kubernetes.io/component: controller
rules:
  # ConfigMaps: watch agent-instance, agent-template, agent-schedule; write status.yaml
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  # Secrets: read instance secrets, create OneCLI agent tokens
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  # StatefulSets: reconcile per-instance StatefulSets
  - apiGroups: ["apps"]
    resources: ["statefulsets"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  # Services: reconcile headless Services per instance
  - apiGroups: [""]
    resources: ["services"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  # NetworkPolicies: reconcile per-instance egress/ingress rules
  - apiGroups: ["networking.k8s.io"]
    resources: ["networkpolicies"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  # Pods: read for status, exec for trigger delivery
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods/exec"]
    verbs: ["create"]
  # Leases: leader election
  - apiGroups: ["coordination.k8s.io"]
    resources: ["leases"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: {{ $saName }}
  labels:
    {{- include "adk.labels" . | nindent 4 }}
    app.kubernetes.io/component: controller
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: {{ $saName }}
subjects:
  - kind: ServiceAccount
    name: {{ $saName }}
    namespace: {{ .Release.Namespace }}
```

- [ ] 2. Verify template renders and includes pods/exec:

```bash
helm template adk deploy/helm/adk -s templates/rbac-controller.yaml \
  | grep -A2 "pods/exec"
```

- [ ] 3. Commit: `feat(helm): Controller RBAC with ClusterRole including pods/exec`

---

## Task 9: RBAC — API Server ServiceAccount + Role + RoleBinding

**Files:**
- Create: `deploy/helm/adk/templates/rbac-apiserver.yaml`

### Steps

- [ ] 1. Create `deploy/helm/adk/templates/rbac-apiserver.yaml`:

```yaml
{{- $saName := include "adk.apiserver.serviceAccountName" . }}
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ $saName }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "adk.labels" . | nindent 4 }}
    app.kubernetes.io/component: apiserver
---
# API Server Role in release namespace (OneCLI config, own secrets)
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: {{ $saName }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "adk.labels" . | nindent 4 }}
    app.kubernetes.io/component: apiserver
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: {{ $saName }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "adk.labels" . | nindent 4 }}
    app.kubernetes.io/component: apiserver
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: {{ $saName }}
subjects:
  - kind: ServiceAccount
    name: {{ $saName }}
    namespace: {{ .Release.Namespace }}
---
# API Server Role in agent namespace (read/write instance ConfigMaps, Secrets, read Pods)
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: {{ $saName }}
  namespace: {{ .Values.agentNamespace }}
  labels:
    {{- include "adk.labels" . | nindent 4 }}
    app.kubernetes.io/component: apiserver
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: {{ $saName }}
  namespace: {{ .Values.agentNamespace }}
  labels:
    {{- include "adk.labels" . | nindent 4 }}
    app.kubernetes.io/component: apiserver
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: {{ $saName }}
subjects:
  - kind: ServiceAccount
    name: {{ $saName }}
    namespace: {{ .Release.Namespace }}
```

- [ ] 2. Verify both Roles render (release namespace and agent namespace):

```bash
helm template adk deploy/helm/adk -s templates/rbac-apiserver.yaml \
  | grep "namespace:"
```

- [ ] 3. Commit: `feat(helm): API Server RBAC with namespace-scoped Roles`

---

## Task 10: Default agent template ConfigMap

**Files:**
- Create: `deploy/helm/adk/templates/default-template.yaml`

### Steps

- [ ] 1. Create `deploy/helm/adk/templates/default-template.yaml`:

```yaml
{{- if .Values.defaultTemplate.enabled }}
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ .Values.defaultTemplate.name }}
  namespace: {{ .Values.agentNamespace }}
  labels:
    {{- include "adk.labels" . | nindent 4 }}
    humr.ai/type: agent-template
data:
  spec.yaml: |
    image: {{ .Values.defaultTemplate.image }}
    description: {{ .Values.defaultTemplate.description | quote }}
    mounts:
      - path: /workspace
        persist: true
      - path: /home/agent
        persist: true
      - path: /tmp
        persist: false
    init: |
      #!/bin/bash
      if [ -f /workspace/requirements.txt ]; then
        pip install -r /workspace/requirements.txt
      fi
    env:
      - name: ACP_PORT
        value: "8080"
    resources:
      requests:
        cpu: "250m"
        memory: "512Mi"
      limits:
        cpu: "1"
        memory: "2Gi"
    securityContext:
      runAsNonRoot: true
      readOnlyRootFilesystem: false
{{- end }}
```

- [ ] 2. Verify template renders with the correct label:

```bash
helm template adk deploy/helm/adk -s templates/default-template.yaml \
  | grep "humr.ai/type"
```

- [ ] 3. Verify it can be disabled:

```bash
helm template adk deploy/helm/adk -s templates/default-template.yaml \
  --set defaultTemplate.enabled=false
```

- [ ] 4. Commit: `feat(helm): default agent template ConfigMap (code-guardian)`

---

## Task 11: NOTES.txt

**Files:**
- Create: `deploy/helm/adk/templates/NOTES.txt`

### Steps

- [ ] 1. Create `deploy/helm/adk/templates/NOTES.txt`:

```
ADK has been deployed!

Components:
  - PostgreSQL:    {{ include "adk.postgres.fullname" . }}.{{ .Release.Namespace }}.svc:5432
  - OneCLI Gateway: {{ include "adk.gateway.fullname" . }}.{{ .Release.Namespace }}.svc:{{ .Values.gateway.port }}
  - OneCLI Web:    {{ include "adk.web.fullname" . }}.{{ .Release.Namespace }}.svc:{{ .Values.web.port }}

Agent namespace: {{ .Values.agentNamespace }}

CA Secret:   {{ include "adk.ca.fullname" . }} (namespace: {{ .Release.Namespace }})
CA ConfigMap: {{ include "adk.ca-cert.fullname" . }} (namespace: {{ .Values.agentNamespace }})

RBAC:
  Controller SA: {{ include "adk.controller.serviceAccountName" . }}
  API Server SA: {{ include "adk.apiserver.serviceAccountName" . }}

To verify:
  kubectl get pods -n {{ .Release.Namespace }}
  kubectl get cm -n {{ .Values.agentNamespace }} -l humr.ai/type=agent-template
  kubectl get secret {{ include "adk.ca.fullname" . }} -n {{ .Release.Namespace }}

To access OneCLI Web:
  kubectl port-forward svc/{{ include "adk.web.fullname" . }} {{ .Values.web.port }}:{{ .Values.web.port }} -n {{ .Release.Namespace }}
```

- [ ] 2. Verify NOTES render:

```bash
helm template adk deploy/helm/adk -s templates/NOTES.txt
```

- [ ] 3. Commit: `feat(helm): NOTES.txt with post-install verification commands`

---

## Task 12: Full template validation and integration test

**Files:**
- No new files (validation only)

### Steps

- [ ] 1. Lint the full chart:

```bash
helm lint deploy/helm/adk
```

- [ ] 2. Render all templates and check for errors:

```bash
helm template adk deploy/helm/adk --debug > /dev/null
```

- [ ] 3. Render full output and verify all expected resources:

```bash
helm template adk deploy/helm/adk | grep "^kind:" | sort
```

Expected output should include: ClusterRole, ClusterRoleBinding, ConfigMap (x2 — CA cert + default template), Deployment (x2 — gateway + web), Namespace, Role (x2), RoleBinding (x2), Secret (x2 — secrets + CA), Service (x3 — postgres + gateway + web), ServiceAccount (x2), StatefulSet.

- [ ] 4. Install to k3s (dry-run first):

```bash
helm install adk deploy/helm/adk --dry-run
```

- [ ] 5. Install to k3s for real:

```bash
helm install adk deploy/helm/adk
```

- [ ] 6. Verify PostgreSQL is running and ready:

```bash
kubectl wait --for=condition=ready pod -l app.kubernetes.io/component=postgres --timeout=120s
```

- [ ] 7. Verify OneCLI Gateway is running:

```bash
kubectl wait --for=condition=available deployment -l app.kubernetes.io/component=gateway --timeout=120s
```

- [ ] 8. Verify OneCLI Web is running:

```bash
kubectl wait --for=condition=available deployment -l app.kubernetes.io/component=web --timeout=120s
```

- [ ] 9. Verify CA Secret exists:

```bash
kubectl get secret -l app.kubernetes.io/name=adk | grep ca
```

- [ ] 10. Verify CA cert ConfigMap exists in agent namespace:

```bash
kubectl get cm -n adk-agents -l app.kubernetes.io/name=adk | grep ca-cert
```

- [ ] 11. Verify default template ConfigMap exists with correct label:

```bash
kubectl get cm -n adk-agents -l humr.ai/type=agent-template
```

- [ ] 12. Verify RBAC ServiceAccounts exist:

```bash
kubectl get sa | grep adk
```

- [ ] 13. Verify upgrade preserves secrets (CA cert and passwords don't change):

```bash
# Save current CA cert
kubectl get secret adk-ca -o jsonpath='{.data.ca\.crt}' > /tmp/ca-before.txt
# Upgrade (no-op)
helm upgrade adk deploy/helm/adk
# Compare
kubectl get secret adk-ca -o jsonpath='{.data.ca\.crt}' > /tmp/ca-after.txt
diff /tmp/ca-before.txt /tmp/ca-after.txt
```

- [ ] 14. Clean up:

```bash
helm uninstall adk
kubectl delete namespace adk-agents
```

- [ ] 15. Commit: `feat(helm): integration test verification passed`
