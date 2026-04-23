import { createDb, eq } from "db";
import { cpAgentSecrets, cpSecrets } from "db";
import type { Db } from "db";
import { unwrapWithDek } from "../crypto/dek.js";
import { compileHostPattern, type CacheSnapshot, type InjectionRule } from "./cache.js";

export interface SecretMetadata {
  authMode?: "api-key" | "oauth";
  envMappings?: Array<{ envName: string; placeholder?: string }>;
  injectionConfig?: { headerName: string; valueFormat?: string };
  oauth?: { providerId: string; expiresAt?: string };
}

type Row = {
  id: string;
  hostPattern: string;
  metadata: unknown;
  dekWrappedByAgent: Buffer;
  ciphertext: Buffer;
};

export interface SidecarDb {
  db: Db;
  close(): Promise<void>;
}

export function openSidecarDb(databaseUrl: string): SidecarDb {
  const { db, sql } = createDb(databaseUrl);
  return { db, close: () => sql.end() };
}

function applyValueFormat(format: string | undefined, value: string): string {
  if (!format) return value;
  return format.replace(/\{\{\s*value\s*\}\}/g, value);
}

function buildRule(row: Row, agentDek: Buffer): InjectionRule {
  const metadata = (row.metadata as SecretMetadata | null) ?? {};
  const headerName = metadata.injectionConfig?.headerName ?? "Authorization";
  const secretDek = unwrapWithDek(agentDek, row.dekWrappedByAgent);
  const plaintext = unwrapWithDek(secretDek, row.ciphertext).toString("utf8");
  return {
    secretId: row.id,
    hostPattern: compileHostPattern(row.hostPattern),
    headerName,
    headerValue: applyValueFormat(metadata.injectionConfig?.valueFormat, plaintext),
  };
}

export async function loadGrants(
  db: Db,
  agentId: string,
  agentDek: Buffer,
): Promise<CacheSnapshot> {
  const rows = await db
    .select({
      id: cpSecrets.id,
      hostPattern: cpSecrets.hostPattern,
      metadata: cpSecrets.metadata,
      dekWrappedByAgent: cpAgentSecrets.dekWrappedByAgent,
      ciphertext: cpSecrets.ciphertext,
    })
    .from(cpAgentSecrets)
    .innerJoin(cpSecrets, eq(cpSecrets.id, cpAgentSecrets.secretId))
    .where(eq(cpAgentSecrets.agentId, agentId));

  const rules = rows
    .map((r) => buildRule(r as Row, agentDek))
    // Sort more-specific first: literals beat wildcards; longer patterns beat shorter.
    .sort((a, b) => {
      const aWild = a.hostPattern.source.includes("[^.]+") ? 1 : 0;
      const bWild = b.hostPattern.source.includes("[^.]+") ? 1 : 0;
      if (aWild !== bWild) return aWild - bWild;
      return b.hostPattern.source.length - a.hostPattern.source.length;
    });

  return { rules, loadedAt: new Date() };
}
