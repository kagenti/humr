# DRAFT: Skills and marketplace

**Date:** 2026-04-02
**Status:** Proposed
**Owner:** @pilartomas

## Context

Skills (markdown + YAML files that configure agent behavior) are a core concept in the harness model. OpenClaw has ClawHub with 5,700+ community skills — but also 341+ malicious skills in the first week. NanoClaw's philosophy: skills are portable, just files. Claude Code has its own skill system.

The question: should the platform have an opinion on skills format, discovery, and distribution? Or is this the agent's problem (like memory)?

Related: the issue.md explicitly defers skills/marketplace as something "first-party platforms will win." But developers still need to load and run skills securely.

## Decision

TBD. Questions to answer:

- Do we adopt an existing skill format (OpenClaw's SKILL.md, Claude Code's skills, or define our own)?
- Is there a platform-level skill registry/marketplace, or do developers manage skills as files in their workspace?
- How are skills trusted? Permission declarations? Sandboxing? Review process?
- Is this a prototype concern or Phase 2?

## Alternatives Considered

TBD — needs team discussion.

## Consequences

TBD — depends on the decision.
