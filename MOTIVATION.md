# Why Humr

## What's happening

There are three ways people build AI agents today:

1. **Traditional services.** You write agent code using a framework like LangGraph or CrewAI, package it in a container, and deploy it. This is how most enterprise agents work today.

2. **Harnesses.** You take a general-purpose tool like Claude Code, Codex, or Gemini CLI, give it a system prompt, file access, and tools, and it does the work. You configure it more than you program it — though you might still write custom skills or scripts. This is the fastest-growing pattern.

3. **Always-on personal assistants.** An agent that runs continuously, remembers things between conversations, wakes up on a schedule, and proactively does work. Think OpenClaw or NanoClaw. Under the hood, these use a harness to build software, create skills on the fly, and automate workflows — but the user doesn't interact with the harness directly. They interact with the assistant. The harness is the engine; the assistant is the experience.

All three hit the same wall when you try to run them in production: no open-source platform makes them safe, manageable, and independent of a single vendor.

## The problem

OpenClaw is wildly successful and keeps getting better. But it's a general-purpose platform that tries to serve every user and every scenario. Humr takes a different angle: narrower focus, zero-trust by default, building blocks instead of opinions.

When an agent has bash access and can manipulate files, security can't be an afterthought. Credentials shouldn't be passed to the model. Network access shouldn't be open by default. Isolation shouldn't be optional. These aren't features — they're the foundation everything else is built on.

And if you want to run agents on your own infrastructure without being tied to a specific vendor's harness, model, or cloud — that option doesn't exist today.

## What Humr does

Humr is a Kubernetes platform focused on running AI harnesses in production. It covers the second category (harnesses) and is building the foundation for the third (always-on personal assistants).

**You bring the harness. Humr makes it production-ready.**

Here's what that means:

- **Your agent runs in an isolated container.** Each invocation gets a fresh pod. Agents can't see each other's files, network, or processes. Workspace files (memory, skills, project artifacts) persist between runs on a volume — but the container itself is disposable.

- **Your agent never sees real credentials.** All outbound traffic goes through a credential gateway (OneCLI). The gateway injects real tokens at the HTTP level and enforces per-agent policy rules. The agent only sees placeholders. If the agent gets compromised, there are no secrets to steal.

- **Scheduling and heartbeat are built in.** The platform owns cron — not the agent. When a schedule fires, the platform writes a trigger file to the agent's workspace. The agent wakes up, processes it, and goes back to sleep. A heartbeat works the same way: wake up, review history, decide if anything needs doing.

- **The harness doesn't know it's managed.** A scheduled task looks the same as a user message. A credential-injected API call looks the same as a normal request. The harness runs the same way locally and in production.

- **No vendor lock-in.** Model-agnostic. Harness-agnostic. Any harness that speaks ACP works. Today that's Claude Code, but the platform is designed for Codex, Gemini CLI, and whatever comes next.

## What Humr believes

- **The harness is the unit of AI development.** The platform's job is to run it safely, not replace it.
- **Security must be structural.** If it depends on the agent behaving correctly, it's not security.
- **Kubernetes is the right foundation.** Isolation, scheduling, persistence, and networking out of the box. ConfigMaps instead of CRDs so you don't need cluster-admin.
- **No opinions on agent internals.** How agents manage memory, prompts, and context is the developer's problem. The platform provides primitives.

## Where this is going

Humr focuses on harnesses today and is preparing the building blocks for always-on personal assistants (scheduling, heartbeat, persistent workspace, channel integrations). A separate experiment will build an enterprise-grade OpenClaw alternative on top of these building blocks — an assistant that uses the harness to build software, create skills, and automate workflows, but wraps it in an experience that's safe and manageable for enterprise use.
