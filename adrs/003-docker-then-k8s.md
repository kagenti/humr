# ADR-003: Docker for prototype, Kubernetes for production

**Date:** 2026-04-02
**Status:** Accepted — prototype phase complete, Kubernetes adopted
**Owner:** @jezekra1

## Context

The team debated whether to build on Kubernetes from the start or use simpler Docker containers for the prototype. Radek advocated for Kubernetes (jobs provide isolation, PVCs handle persistence, built-in scaling). Matous worried Kubernetes is overkill for a prototype and could slow delivery. Tomas W. noted cloud deployment would be hard without Kubernetes.

The prototype needs to ship fast. Production needs to scale and isolate properly.

## Decision

Docker for the prototype, Kubernetes for production. Pragmatic split:

- **Prototype:** Docker containers orchestrated with simple tooling (docker-compose or scripts). Focus on proving the architecture works, not on production infrastructure.
- **Production:** Kubernetes jobs for isolation, PVCs for persistence, operators for lifecycle. Port the prototype when the architecture is validated.

The architecture should be designed so that the Docker-to-Kubernetes migration is straightforward (containers are containers).

## Alternatives Considered

**Kubernetes from day one.** Rejected for the prototype: too slow, too much infrastructure complexity before the core value is proven. The team agreed speed matters more than production-readiness at this stage.

**Docker only, no Kubernetes path.** Rejected: Kubernetes is necessary for production multi-tenancy, scaling, and integration with the Red Hat/OpenShift ecosystem.

## Consequences

- Prototype ships faster — no K8s cluster setup, no CRDs, no operators needed to start
- Risk: prototype patterns may not map cleanly to K8s jobs (but containers are containers, so the gap should be small)
- Team can validate the architecture with real usage before investing in production infrastructure
- Must avoid Docker-specific patterns that don't translate to K8s (e.g., docker-compose networking assumptions)
