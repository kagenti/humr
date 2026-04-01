import type { ClaudeCodeAuthContext } from "./modules/claude-code-auth.js";
import type { FilesContext } from "./modules/files.js";

export interface HarnessContext {
  workingDir: string;
  claudeCodeAuth: ClaudeCodeAuthContext;
  files: FilesContext;
}
