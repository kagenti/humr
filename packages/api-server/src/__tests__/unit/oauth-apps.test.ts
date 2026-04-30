import { describe, it, expect } from "vitest";

import { createOAuthAppRegistry } from "../../modules/connections/infrastructure/oauth-apps.js";

describe("OAuth app registry — descriptors", () => {
  it("lists GitHub.com and GitHub Enterprise as available app types", () => {
    const reg = createOAuthAppRegistry();
    const ids = reg.list().map((d) => d.id);
    expect(ids).toEqual(["github", "github-enterprise"]);
  });

  it("each descriptor surfaces input fields the UI needs to render the connect form", () => {
    const reg = createOAuthAppRegistry();
    const github = reg.get("github")!;
    expect(github.inputs.map((i) => i.name)).toEqual(["clientId", "clientSecret"]);
    expect(github.inputs.find((i) => i.name === "clientSecret")?.secret).toBe(true);

    const ghe = reg.get("github-enterprise")!;
    expect(ghe.inputs.map((i) => i.name)).toEqual(["host", "clientId", "clientSecret"]);
  });

  it("descriptors carry a stable connectionKey separate from the id", () => {
    const reg = createOAuthAppRegistry();
    expect(reg.get("github")!.connectionKey).toBe("github");
    expect(reg.get("github-enterprise")!.connectionKey).toBe("github-enterprise");
  });

  it("get() returns null for an unknown app id without throwing", () => {
    const reg = createOAuthAppRegistry();
    expect(reg.get("not-a-real-app")).toBeNull();
  });
});

describe("OAuth app registry — build()", () => {
  it("builds the GitHub.com flow from user-supplied client credentials", () => {
    const reg = createOAuthAppRegistry();
    const built = reg.build("github", { clientId: "id", clientSecret: "sec" });
    expect(built.provider.authorizationUrl).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(built.provider.tokenEndpoint).toBe(
      "https://github.com/login/oauth/access_token",
    );
    expect(built.provider.tokenEndpointAcceptJson).toBe(true);
    expect(built.provider.clientId).toBe("id");
    expect(built.provider.clientSecret).toBe("sec");
    expect(built.provider.scopes).toEqual(["repo", "read:user", "user:email"]);
    expect(built.flow).toEqual({ connectionKey: "github", hostPattern: "api.github.com" });
    expect(built.connectionDisplayName).toBe("GitHub");
  });

  it("builds GHE URLs from the user-supplied host", () => {
    const reg = createOAuthAppRegistry();
    const built = reg.build("github-enterprise", {
      host: "ghe.example.com",
      clientId: "id",
      clientSecret: "sec",
    });
    expect(built.provider.authorizationUrl).toBe(
      "https://ghe.example.com/login/oauth/authorize",
    );
    expect(built.provider.tokenEndpoint).toBe(
      "https://ghe.example.com/login/oauth/access_token",
    );
    expect(built.flow.hostPattern).toBe("ghe.example.com");
    expect(built.flow.connectionKey).toBe("github-enterprise");
    expect(built.connectionDisplayName).toBe("GitHub Enterprise (ghe.example.com)");
  });

  it("rejects missing client credentials with a Zod error", () => {
    const reg = createOAuthAppRegistry();
    expect(() => reg.build("github", { clientId: "" })).toThrow();
    expect(() => reg.build("github", { clientId: "id" })).toThrow();
  });

  it("rejects an invalid GHE host (scheme included)", () => {
    const reg = createOAuthAppRegistry();
    expect(() =>
      reg.build("github-enterprise", {
        host: "https://ghe.example.com",
        clientId: "id",
        clientSecret: "sec",
      }),
    ).toThrow(/valid DNS hostname/);
  });
});
