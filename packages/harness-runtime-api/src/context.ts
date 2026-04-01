export interface HarnessContext {
  workingDir: string;
  fileVersion: () => number;
  buildTree: () => { path: string; type: "file" | "dir" }[];
  readFileSafe: (
    rel: string,
  ) => {
    path: string;
    content?: string;
    binary?: boolean;
    version: number;
  } | null;
  getAuthStatus: () => Promise<{
    authenticated: boolean;
    loggedIn?: boolean;
  }>;
  startLogin: () => Promise<{ url: string }>;
  submitAuthCode: (
    code: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}
