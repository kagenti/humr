FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG TARGETOS TARGETARCH
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -o controller .

FROM alpine:3.21
RUN apk add --no-cache ca-certificates
COPY --from=builder /app/controller /usr/local/bin/controller
ENTRYPOINT ["controller"]
