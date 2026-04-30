export type ApprovalType = "ext_authz" | "acp_native";

export type ApprovalStatus = "pending" | "resolved" | "expired";

/** Verdict the user picked. `allow_once` resolves only the held call (no rule
 *  written); `allow` / `deny` write a permanent egress rule via the
 *  egress-rules module. */
export type ApprovalVerdict = "allow_once" | "allow" | "deny";

export interface ExtAuthzPayload {
  kind: "ext_authz";
  host: string;
  method: string;
  path: string;
}

/** ACP `PermissionOption.kind` values the harness emits. */
export type AcpPermissionOptionKind =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always";

export interface AcpPermissionOption {
  optionId: string;
  kind?: AcpPermissionOptionKind;
}

/** Captured at relay-mirror time so the inbox can synthesize a JSON-RPC
 *  response frame for the held wrapper request without a second round-trip
 *  back to the wrapper. The harness's option ids vary; we map our action
 *  (approveOnce / approvePermanent / denyForever) to the closest `kind`. */
export interface AcpNativePayload {
  kind: "acp_native";
  toolName: string;
  args?: unknown;
  rpcId?: number | string;
  options?: AcpPermissionOption[];
}

export type ApprovalPayload = ExtAuthzPayload | AcpNativePayload;

export interface ApprovalView {
  id: string;
  type: ApprovalType;
  instanceId: string;
  agentId: string;
  sessionId: string | null;
  payload: ApprovalPayload;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  verdict: ApprovalVerdict | null;
  status: ApprovalStatus;
}

export interface ApprovalsService {
  listForOwner(): Promise<ApprovalView[]>;
  listForInstance(instanceId: string): Promise<ApprovalView[]>;
  approveOnce(id: string): Promise<void>;
  approvePermanent(id: string): Promise<void>;
  /** Wildcard-host variant of approve-permanent: writes a single rule that
   *  matches any method/path on the request's host. Only meaningful for
   *  ext_authz approvals — for acp_native, falls back to approvePermanent. */
  approveHost(id: string): Promise<void>;
  denyForever(id: string): Promise<void>;
}
