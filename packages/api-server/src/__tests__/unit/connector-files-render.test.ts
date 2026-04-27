import { describe, expect, it } from "vitest";
import { renderFiles } from "../../modules/connector-files/render.js";
import { connectorFilesRegistry } from "../../modules/connector-files/registry.js";

describe("renderFiles (against the live registry)", () => {
  it("renders github-enterprise grants into hosts.yml fragments", () => {
    const out = renderFiles(
      [
        { id: "c-1", provider: "github-enterprise", metadata: { baseUrl: "https://ghe.example.com", username: "alice" } },
        { id: "c-2", provider: "github", metadata: { baseUrl: "https://github.com" } },
      ],
      connectorFilesRegistry,
    );
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

  it("returns no specs when no provider in the registry matches", () => {
    const out = renderFiles(
      [{ id: "c-2", provider: "github", metadata: { baseUrl: "https://github.com" } }],
      connectorFilesRegistry,
    );
    expect(out).toEqual([]);
  });
});
