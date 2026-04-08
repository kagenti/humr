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

{{/* ---- OneCLI resources ---- */}}

{{/*
OneCLI app name (Deployment + Service)
*/}}
{{- define "humr.onecli.fullname" -}}
{{- printf "%s-onecli" (include "humr.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
OneCLI PostgreSQL fullname
*/}}
{{- define "humr.onecli.postgres.fullname" -}}
{{- printf "%s-onecli-postgres" (include "humr.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
OneCLI secrets name (passwords, keys)
*/}}
{{- define "humr.onecli.secrets.fullname" -}}
{{- printf "%s-onecli-secrets" (include "humr.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
OneCLI CA cert ConfigMap name (for agent pods)
*/}}
{{- define "humr.onecli.ca-cert.fullname" -}}
{{- printf "%s-onecli-ca-cert" (include "humr.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
OneCLI PostgreSQL DSN
*/}}
{{- define "humr.onecli.postgres.dsn" -}}
{{- printf "postgresql://%s:$(POSTGRES_PASSWORD)@%s:5432/%s" .Values.onecli.postgres.user (include "humr.onecli.postgres.fullname" .) .Values.onecli.postgres.database }}
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
