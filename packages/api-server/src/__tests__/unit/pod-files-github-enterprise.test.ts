import { describe, expect, it } from "vitest";
import {
  GH_ENTERPRISE_HOSTS_PATH,
  makeGithubEnterpriseHostsProducer,
} from "../../modules/pod-files/producers/github-enterprise-hosts.js";

describe("github-enterprise-hosts producer", () => {
  it("renders one fragment per granted enterprise connection at the gh hosts.yml path", async () => {
    const producer = makeGithubEnterpriseHostsProducer({
      fetchConnectionsForOwner: async () => [
        { id: "c-1", provider: "github-enterprise", metadata: { baseUrl: "https://ghe.example.com", username: "alice" } },
        { id: "c-2", provider: "github", metadata: { baseUrl: "https://github.com" } },
      ],
    });
    const out = await producer.produce("alice-sub");
    expect(out).toEqual([
      {
        path: GH_ENTERPRISE_HOSTS_PATH,
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

  it("emits nothing when no enterprise rows are present", async () => {
    const producer = makeGithubEnterpriseHostsProducer({
      fetchConnectionsForOwner: async () => [
        { id: "c-2", provider: "github", metadata: { baseUrl: "https://github.com" } },
      ],
    });
    expect(await producer.produce("alice-sub")).toEqual([]);
  });
});
