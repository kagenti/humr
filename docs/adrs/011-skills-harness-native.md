# ADR-011: Skills — harness-native, not platform-managed

**Date:** 2026-04-02
**Status:** Accepted
**Owner:** @pilartomas

## Context

Skills (markdown + YAML files that configure agent behavior) are a core concept in many harness ecosystems. OpenClaw has ClawHub with 5,700+ community skills (and 341+ malicious submissions in the first week). NanoClaw treats skills as portable files. Claude Code has its own skill system with a curated marketplace and plugin architecture. Vercel's skills.sh is a cross-harness skill registry aiming to be a universal distribution point.

The question: should the platform define a skills format, provide discovery, or manage distribution? Or should skills be the harness's problem — handled natively by each harness's own ecosystem?

This mirrors the reasoning behind ADR-002 (memory): the platform provides primitives, the harness/agent owns the semantics.

## Decision

Skills are the harness's responsibility, not the platform's. Each harness uses its own native skill/plugin ecosystem:

- **Claude Code** uses Claude's marketplace, plugins, and skill files
- **Codex** would use OpenAI's plugin system
- **Gemini CLI** would use Google's extension ecosystem

The platform does NOT:
- Define a universal skill format
- Host a skill registry or marketplace
- Manage skill installation, versioning, or trust
- Enforce a skill permission model

The platform DOES:
- Provide persistent workspace volumes where skill files can live (ADR-001)
- Provide network isolation so skills can't exfiltrate data (ADR-005)
- Provide credential injection so skills that need API access go through the gateway (ADR-005)

## Alternatives Considered

**Platform-level skill format and marketplace.** Define a universal `.skill` format, host a registry, handle trust/signing. Rejected: first-party platforms will win the marketplace game — they have the distribution, the trust infrastructure, and the incentive. A platform-level format would be yet another standard that competes poorly with native ecosystems and adds maintenance burden.

**Platform-level skill sandboxing and permission model.** Declare what each skill can access, enforce at the platform level. Rejected: harnesses already have their own permission models (Claude Code's permission modes, tool allowlists). Duplicating this at the platform layer creates confusion about which layer is authoritative. Network isolation and credential gating (already provided) cover the infrastructure-level concerns.

**No opinion at all.** Rejected: worth documenting the deliberate decision to delegate, so future contributors don't re-raise the question.

## Consequences

- The platform stays harness-agnostic — consistent with supporting multiple harnesses without favoring one
- Developers use the skill ecosystem they already know from their chosen harness
- No cross-harness skill portability — a Claude Code skill won't work in Codex. This is acceptable because skill formats are tightly coupled to harness capabilities anyway
- If a dominant cross-harness skill standard emerges in the ecosystem, the platform can adopt it later without breaking existing setups
- Security posture relies on harness-level skill trust + platform-level network/credential isolation (defense in depth)
