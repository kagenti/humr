{{/*
Expand the name of the chart.
*/}}
{{- define "humr.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "humr.fullname" -}}
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
{{- define "humr.labels" -}}
helm.sh/chart: {{ include "humr.chart" . }}
{{ include "humr.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "humr.selectorLabels" -}}
app.kubernetes.io/name: {{ include "humr.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Chart label
*/}}
{{- define "humr.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
imagePullSecrets — renders the imagePullSecrets list if non-empty.
*/}}
{{- define "humr.imagePullSecrets" -}}
{{- with .Values.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}

{{/*
nameList — comma-separated .name values from a list of objects.
Usage: {{ include "humr.nameList" .Values.someList }}
*/}}
{{- define "humr.nameList" -}}
{{- $names := list }}
{{- range . }}
{{- $names = append $names .name }}
{{- end }}
{{- join "," $names }}
{{- end }}

{{/* ---- Public URLs (derived from domain + port + scheme) ---- */}}

{{/*
Host:port string for URLs (includes port if non-empty)
*/}}
{{- define "humr.hostport" -}}
{{- if .Values.port }}
{{- printf "%s:%v" .Values.domain .Values.port }}
{{- else }}
{{- .Values.domain }}
{{- end }}
{{- end }}

{{- define "humr.url.ui" -}}
{{- printf "%s://humr.%s" .Values.scheme (include "humr.hostport" .) }}
{{- end }}

{{- define "humr.url.api" -}}
{{- printf "%s://humr-api.%s" .Values.scheme (include "humr.hostport" .) }}
{{- end }}

{{- define "humr.url.keycloak" -}}
{{- printf "%s://keycloak.%s" .Values.scheme (include "humr.hostport" .) }}
{{- end }}

{{- define "humr.url.onecli" -}}
{{- printf "%s://onecli.%s" .Values.scheme (include "humr.hostport" .) }}
{{- end }}

{{/* ---- Shared PostgreSQL ---- */}}

{{/*
Shared PostgreSQL fullname (StatefulSet + Service)
*/}}
{{- define "humr.postgres.fullname" -}}
{{- printf "%s-postgres" (include "humr.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Shared PostgreSQL secrets name
*/}}
{{- define "humr.postgres.secrets.fullname" -}}
{{- printf "%s-postgres-secrets" (include "humr.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* ---- OneCLI resources ---- */}}

{{/*
OneCLI app name (Deployment + Service)
*/}}
{{- define "humr.onecli.fullname" -}}
{{- printf "%s-onecli" (include "humr.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
OneCLI secrets name (encryption key)
*/}}
{{- define "humr.onecli.secrets.fullname" -}}
{{- printf "%s-onecli-secrets" (include "humr.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
OneCLI database host — uses external host if set, otherwise shared postgres
*/}}
{{- define "humr.onecli.db.host" -}}
{{- if .Values.onecli.db.host }}
{{- .Values.onecli.db.host }}
{{- else }}
{{- include "humr.postgres.fullname" . }}
{{- end }}
{{- end }}

{{/*
OneCLI database password secret name — uses shared postgres secret when db.password is empty
*/}}
{{- define "humr.onecli.db.password.secretName" -}}
{{- if .Values.onecli.db.password }}
{{- include "humr.onecli.secrets.fullname" . }}
{{- else }}
{{- include "humr.postgres.secrets.fullname" . }}
{{- end }}
{{- end }}

{{/*
OneCLI PostgreSQL DSN
*/}}
{{- define "humr.onecli.postgres.dsn" -}}
{{- printf "postgresql://%s:$(POSTGRES_PASSWORD)@%s:%v/%s" .Values.onecli.db.user (include "humr.onecli.db.host" .) (int .Values.onecli.db.port) .Values.onecli.db.database }}
{{- end }}

{{/*
API Server database host — uses external host if set, otherwise shared postgres
*/}}
{{- define "humr.apiserver.db.host" -}}
{{- if .Values.apiServer.db.host }}
{{- .Values.apiServer.db.host }}
{{- else }}
{{- include "humr.postgres.fullname" . }}
{{- end }}
{{- end }}

{{/*
API Server database password secret name — uses shared postgres secret when db.password is empty
*/}}
{{- define "humr.apiserver.db.password.secretName" -}}
{{- if .Values.apiServer.db.password }}
{{- printf "%s-apiserver-secrets" (include "humr.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- include "humr.postgres.secrets.fullname" . }}
{{- end }}
{{- end }}

{{/*
API Server PostgreSQL DSN
*/}}
{{- define "humr.apiserver.postgres.dsn" -}}
{{- printf "postgresql://%s:$(POSTGRES_PASSWORD)@%s:%v/%s" .Values.apiServer.db.user (include "humr.apiserver.db.host" .) (int .Values.apiServer.db.port) .Values.apiServer.db.database }}
{{- end }}

{{/*
Keycloak OIDC issuer URL (external, for iss claim matching in JWTs)
*/}}
{{- define "humr.keycloak.issuer" -}}
{{- printf "%s/realms/%s" (include "humr.url.keycloak" .) .Values.keycloak.realm }}
{{- end }}

{{/* ---- Keycloak resources ---- */}}

{{/*
Keycloak app name (Deployment + Service)
*/}}
{{- define "humr.keycloak.fullname" -}}
{{- printf "%s-keycloak" (include "humr.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Keycloak secrets name (admin password)
*/}}
{{- define "humr.keycloak.secrets.fullname" -}}
{{- printf "%s-keycloak-secrets" (include "humr.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Keycloak database host — uses external host if set, otherwise shared postgres
*/}}
{{- define "humr.keycloak.db.host" -}}
{{- if .Values.keycloak.db.host }}
{{- .Values.keycloak.db.host }}
{{- else }}
{{- include "humr.postgres.fullname" . }}
{{- end }}
{{- end }}

{{/*
Keycloak database password secret name — uses shared postgres secret when db.password is empty
*/}}
{{- define "humr.keycloak.db.password.secretName" -}}
{{- if .Values.keycloak.db.password }}
{{- include "humr.keycloak.secrets.fullname" . }}
{{- else }}
{{- include "humr.postgres.secrets.fullname" . }}
{{- end }}
{{- end }}

{{/*
Keycloak JDBC URL
*/}}
{{- define "humr.keycloak.db.url" -}}
{{- printf "jdbc:postgresql://%s:%v/%s" (include "humr.keycloak.db.host" .) (int .Values.keycloak.db.port) .Values.keycloak.db.database }}
{{- end }}

{{/* ---- Platform resources ---- */}}

{{/*
Controller ServiceAccount name
*/}}
{{- define "humr.controller.serviceAccountName" -}}
{{- printf "%s-controller" (include "humr.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
API Server ServiceAccount name
*/}}
{{- define "humr.apiserver.serviceAccountName" -}}
{{- printf "%s-apiserver" (include "humr.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
