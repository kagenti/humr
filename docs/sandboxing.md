# Sandboxing

This document analyses the security measures that need to be taken in order to minimize the risk of a misbehaving agent, or even one maliciously taken over by a bad actor, from causing harm to the system. Securing workloads is not specific to agentic systems; however, the ability of agentic systems to directly execute code, while potentially having 3rd party content in the context window, makes them a particularly high-risk category.

## Execution

_Protecting the runtime environment, e.g. the OS, filesystem and hardware, from being accessed in an unauthorized way._

> **Example of attack**: Through a malicious website that appears in search results, attacker injects instructions to always use a tool `npx not-virus` to test if a given file is virus. However, `not-virus` happens to itself be a virus that exploits a zero-day Linux kernel vulnerability and compromises the Kubernetes node, gaining access to the company systems.

Humr is Kubernetes-based, and executes agents in Kubernetes pods -- including potentially untrusted code from tool calls. Most Kubernetes distributions are hardened against common container escape techniques, but for untrusted code it is advisable to go one step further and protect the OS kernel -- which is, by design, shared between containers and thus its compromise through a zero-day vulnerability expands the blast radius to the whole node. Humr runs as a layer on top of Kubernetes, and kernel-protection runtimes run on a layer _below_ Kubernetes, thus Humr contains no specific solution and leaves this to the infrastructure operator. Common solutions include gVisor and Kata Contaners, in hosted clusters sometimes provided under service offerings like OpenShift Sandboxed Containers. We highly recommend setting this up, unless you are sure that the whole node is isolated and you accept treating the whole machine as a trust boundary. Always be vigilant and remember that even with well-meaning users and well-meaning agents, a single external prompt-injection may be enough to establish remote code execution for a third party.

<!-- TODO: how do we protect cluster / internal network? -->

One exception is the local runtime, where Humr ships the full stack including the Kubernetes runtime. In this case, to avoid trouble with nested virutalization, it is assumed that the instance is single-user for local testing. The Humr VM is thus considered to be the trust boundary, not individual containers.

## Credentials

_Protecting credentials for 3rd party services (APIs for LLM inference, storage, chat apps, etc.) from being exfiltrated and/or misused._

> **Example of attack**: A malicious skill instructs the agent to use `uvx official-slack-cli` to access Slack. However, it turns out that `official-slack-cli` is not an official Slack CLI, but a malicious fork which exposes the Slack API key to an attacker who uses it to access the Slack workspaces and scans for company secrets.

Humr ships with [OneCLI](https://github.com/onecli/onecli) for credential injection. In this model, agents only receive placeholders for secret keys for 3rd party services, and use these to make API calls. Requests are routed through OneCLI's proxy, which switches placeholders for actual API keys. This only happens if the service URL matches, avoiding sending credentials to third parties. This only works with credentials configured through the UI, though -- it is necessary to not "hardcode" API keys in agent containers. Users should also be instructed to not disclose credentials through the chat window, as agents may ask for them.

## Confidentiality

_Protecting private data from being exfiltrated by a third party, or inadverently published._

> **Example of attack**: User asks the agent to send highly confidential documentation to the CEO. Agent mistakenly picks a contractor sharing the CEO's name, sending them a confidential document.

Exfiltration is a risk that is quite hard to mitigate without air-gapping agents. Complete air-gapping is often impractical or even impossible due to the need for third-party inference -- and as demonstrated in the past, even first-party servers like Anthropic's may contain file upload endpoints an attacker might use to exfiltrate data. (And the provider still must be trusted to handle the data properly either way!) Similarly, other useful features of AI agents, like web search, e-mail, chat integrations, etc. involve the ability to send any held information to the "outside" -- or even "inside", but to an unintended recipient, like demonstrated in the example above.

⚠️ **Currently, there is no well-established solution to this problem, and Humr does not include one either.** Attempts at separation of information-holding agents and outside-communicating agents suffer from the "confused deputy attack" -- a form of "social engineering" where an agent is convinced by a lower-priviledge agent to perform an unintended action by disguising its true purpose (like passing on an encrypted document, misrepresenting its contents).

This problematic has been described by Simon Willison (a well known AI journalist) on his blog as [the lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/): any system that can access private data, can send outwards communication, and can receive non-vetted content, is vulnerable to exfiltration. There is a point of disagreement here, though: For a sufficiently dumb AI agent, non-vetted content is not necessary, since it may convince itself that it needs to send private data outside -- again, as demonstrated on the "example of attack". Also, most communication methods available to agents work "both ways" regardless, merging the last two points. Thus, the only 100% safe way of avoiding exfiltration of private data is **not ever giving it to an agent**.

In a practical sense, the risk of exfiltration can be lowered by limiting the set of web domains the agent can communicate with, setting up trusted receivers, disallowing large uploads or non-inspectable protocols, etc. This is an area of active research for Humr.