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
{{- printf "postgresql://%s:$(POSTGRES_PASSWORD)@%s:5432/%s" .Values.onecli.postgres.user (include "adk.postgres.fullname" .) .Values.onecli.postgres.database }}
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
