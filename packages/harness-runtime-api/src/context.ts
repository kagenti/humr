import type { ClaudeCodeAuthContext } from "./modules/claude-code-auth.js";
import type { FilesContext } from "./modules/files.js";

export interface HarnessContext {
  claudeCodeAuth: ClaudeCodeAuthContext;
  files: FilesContext;
}
