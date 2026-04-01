export interface ClaudeCodeAuthContext {
  getAuthStatus: () => Promise<{
    authenticated: boolean;
    loggedIn?: boolean;
  }>;
  startLogin: () => Promise<{ url: string }>;
  submitAuthCode: (
    code: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}
