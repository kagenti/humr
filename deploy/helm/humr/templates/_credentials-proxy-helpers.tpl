{{/*
credentials-proxy helpers
*/}}

{{- define "humr.credentialsProxy.fullname" -}}
{{- printf "%s-credentials-proxy" (include "humr.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "humr.credentialsProxy.ca.secretName" -}}
{{- printf "%s-ca" (include "humr.credentialsProxy.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "humr.credentialsProxy.ca.configMapName" -}}
{{- printf "%s-ca-bundle" (include "humr.credentialsProxy.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "humr.credentialsProxy.secretsName" -}}
{{- printf "%s-secrets" (include "humr.credentialsProxy.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "humr.credentialsProxy.db.host" -}}
{{- if .Values.credentialsProxy.db.host -}}
{{- .Values.credentialsProxy.db.host -}}
{{- else -}}
{{- include "humr.postgres.fullname" . -}}
{{- end -}}
{{- end }}

{{- define "humr.credentialsProxy.db.apiDsn" -}}
{{- printf "postgresql://%s:$(DB_PASSWORD)@%s:%v/%s"
  .Values.credentialsProxy.db.apiUser
  (include "humr.credentialsProxy.db.host" .)
  (int .Values.credentialsProxy.db.port)
  .Values.credentialsProxy.db.database }}
{{- end }}

{{- define "humr.credentialsProxy.db.sidecarDsn" -}}
{{- printf "postgresql://%s:$(DB_PASSWORD)@%s:%v/%s"
  .Values.credentialsProxy.db.sidecarUser
  (include "humr.credentialsProxy.db.host" .)
  (int .Values.credentialsProxy.db.port)
  .Values.credentialsProxy.db.database }}
{{- end }}

{{- define "humr.url.credentialsProxy" -}}
{{- printf "%s://creds.%s" .Values.scheme (include "humr.hostport" .) }}
{{- end }}
