import { create } from "zustand";
import { createDialogSlice, type DialogSlice } from "./store/dialog.js";
import { createThemeSlice, type ThemeSlice } from "./store/theme.js";
import { createNavigationSlice, type NavigationSlice, pathToState } from "./store/navigation.js";
import { createLoadingSlice, type LoadingSlice } from "./store/loading.js";
import { createToastSlice, type ToastSlice } from "./store/toast.js";
import { createTemplatesSlice, type TemplatesSlice } from "./store/templates.js";
import { createAgentsSlice, type AgentsSlice } from "./store/agents.js";
import { createInstancesSlice, type InstancesSlice } from "./store/instances.js";
import { createSessionsSlice, type SessionsSlice } from "./store/sessions.js";
import { createSessionConfigSlice, type SessionConfigSlice } from "./store/session-config.js";
import { createSecretsSlice, type SecretsSlice } from "./store/secrets.js";
import { createFilesSlice, type FilesSlice } from "./store/files.js";
import { createPermissionsSlice, type PermissionsSlice } from "./store/permissions.js";
import { createConnectionsSlice, type ConnectionsSlice } from "./store/connections.js";

export type { DialogState } from "./store/dialog.js";
export type { Toast, ToastKind } from "./store/toast.js";
export type { SessionError } from "./store/sessions.js";
export type { PermissionOption, PermissionOutcome, PendingPermission } from "./store/permissions.js";

export type HumrStore =
  & DialogSlice
  & ThemeSlice
  & NavigationSlice
  & LoadingSlice
  & ToastSlice
  & TemplatesSlice
  & AgentsSlice
  & InstancesSlice
  & SessionsSlice
  & SessionConfigSlice
  & SecretsSlice
  & FilesSlice
  & PermissionsSlice
  & ConnectionsSlice;

export const useStore = create<HumrStore>()((...a) => ({
  ...createDialogSlice(...a),
  ...createThemeSlice(...a),
  ...createNavigationSlice(...a),
  ...createLoadingSlice(...a),
  ...createToastSlice(...a),
  ...createTemplatesSlice(...a),
  ...createAgentsSlice(...a),
  ...createInstancesSlice(...a),
  ...createSessionsSlice(...a),
  ...createSessionConfigSlice(...a),
  ...createSecretsSlice(...a),
  ...createFilesSlice(...a),
  ...createPermissionsSlice(...a),
  ...createConnectionsSlice(...a),
}));

// Reuse the path parser for browser back/forward hydration
export { pathToState };
