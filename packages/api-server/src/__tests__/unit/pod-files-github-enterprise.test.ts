import { describe, expect, it } from "vitest";
import { makeGithubEnterpriseHostsProducer } from "../../modules/pod-files/producers/github-enterprise-hosts.js";

describe("github-enterprise-hosts producer", () => {
  it("renders one fragment per granted enterprise connection at agentHome-relative gh hosts.yml", async () => {
    const producer = makeGithubEnterpriseHostsProducer({
      agentHome: "/home/agent",
      fetchConnectionsForOwner: async () => [
        { id: "c-1", provider: "github-enterprise", metadata: { baseUrl: "https://ghe.example.com", username: "alice" } },
        { id: "c-2", provider: "github", metadata: { baseUrl: "https://github.com" } },
      ],
    });
    const out = await producer.produce("alice-sub");
    expect(out).toEqual([
      {
        path: "/home/agent/.config/gh/hosts.yml",
        mode: "yaml-fill-if-missing",
        fragments: [
          {
            "ghe.example.com": {
              oauth_token: "humr:sentinel",
              git_protocol: "https",
              user: "alice",
            },
          },
        ],
      },
    ]);
  });

  it("composes the path under a non-default agentHome", async () => {
    const producer = makeGithubEnterpriseHostsProducer({
      agentHome: "/root",
      fetchConnectionsForOwner: async () => [
        { id: "c-1", provider: "github-enterprise", metadata: { baseUrl: "https://ghe.example.com", username: "alice" } },
      ],
    });
    const out = await producer.produce("alice-sub");
    expect(out[0]?.path).toBe("/root/.config/gh/hosts.yml");
  });

  it("emits nothing when no enterprise rows are present", async () => {
    const producer = makeGithubEnterpriseHostsProducer({
      agentHome: "/home/agent",
      fetchConnectionsForOwner: async () => [
        { id: "c-2", provider: "github", metadata: { baseUrl: "https://github.com" } },
      ],
    });
    expect(await producer.produce("alice-sub")).toEqual([]);
  });
});
