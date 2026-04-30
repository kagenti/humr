import { describe, it, expect } from "vitest";

import { createOAuthAppRegistry } from "../../modules/connections/infrastructure/oauth-apps.js";

describe("createOAuthAppRegistry", () => {
  it("returns an empty registry when no app credentials are configured", () => {
    const reg = createOAuthAppRegistry({ redirectUri: "https://app.example/cb" });
    expect(reg.list()).toEqual([]);
    expect(reg.listSummaries()).toEqual([]);
    expect(reg.get("github")).toBeNull();
  });

  it("registers GitHub when client credentials are present", () => {
    const reg = createOAuthAppRegistry({
      redirectUri: "https://app.example/cb",
      github: { clientId: "id", clientSecret: "sec" },
    });
    const apps = reg.list();
    expect(apps).toHaveLength(1);
    expect(apps[0]!.id).toBe("github");
    expect(apps[0]!.provider.authorizationUrl).toBe("https://github.com/login/oauth/authorize");
    expect(apps[0]!.provider.tokenEndpointAcceptJson).toBe(true);
    expect(apps[0]!.provider.scopes).toEqual(["repo", "read:user", "user:email"]);
    expect(apps[0]!.flow.connectionKey).toBe("github");
    expect(apps[0]!.flow.hostPattern).toBe("api.github.com");
  });

  it("registers GHE when host + creds are present, with URLs derived from host", () => {
    const reg = createOAuthAppRegistry({
      redirectUri: "https://app.example/cb",
      githubEnterprise: {
        host: "ghe.example.com",
        clientId: "id",
        clientSecret: "sec",
      },
    });
    const ghe = reg.get("github-enterprise")!;
    expect(ghe).not.toBeNull();
    expect(ghe.provider.authorizationUrl).toBe("https://ghe.example.com/login/oauth/authorize");
    expect(ghe.provider.tokenEndpoint).toBe("https://ghe.example.com/login/oauth/access_token");
    expect(ghe.flow.hostPattern).toBe("ghe.example.com");
    expect(ghe.flow.connectionKey).toBe("github-enterprise");
  });

  it("respects user-supplied scopes", () => {
    const reg = createOAuthAppRegistry({
      redirectUri: "https://app.example/cb",
      github: { clientId: "id", clientSecret: "sec", scopes: ["repo:status"] },
    });
    expect(reg.get("github")!.provider.scopes).toEqual(["repo:status"]);
  });

  it("listSummaries omits client credentials", () => {
    const reg = createOAuthAppRegistry({
      redirectUri: "https://app.example/cb",
      github: { clientId: "id", clientSecret: "sec" },
    });
    const summary = reg.listSummaries()[0]!;
    expect(summary).toEqual({
      id: "github",
      displayName: "GitHub",
      description: expect.any(String),
      hostPattern: "api.github.com",
    });
    // Defensive runtime check — the static type already excludes these,
    // but a future refactor that widens the summary shape shouldn't leak
    // secrets to the browser.
    const opaque = summary as unknown as Record<string, unknown>;
    expect(opaque.clientSecret).toBeUndefined();
    expect(opaque.provider).toBeUndefined();
  });
});
