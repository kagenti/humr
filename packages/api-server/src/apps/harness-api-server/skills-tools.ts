import { TRPCError } from "@trpc/server";
import type { SkillsService } from "api-server-api";

export interface ToolContent {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  /** MCP SDK expects an open shape on tool responses. */
  [key: string]: unknown;
}

export function textResult(text: string): ToolContent {
  return { content: [{ type: "text", text }] };
}

export function errorResult(text: string): ToolContent {
  return { content: [{ type: "text", text }], isError: true };
}

export function formatToolError(err: unknown, fallback: string): ToolContent {
  if (err instanceof TRPCError) {
    if (err.code === "PRECONDITION_FAILED") {
      return errorResult(`the instance must be running to manage skills: ${err.message}`);
    }
    if (err.code === "NOT_FOUND") return errorResult(`not found: ${err.message}`);
    return errorResult(err.message);
  }
  if (err instanceof Error) return errorResult(err.message);
  return errorResult(fallback);
}

/**
 * Handlers for the skills MCP tools. `instanceId` is captured in the closure
 * from the MCP session, so agents cannot spoof it via tool input.
 */
export function createSkillsToolHandlers(instanceId: string, skills: SkillsService) {
  return {
    async listSources(): Promise<ToolContent> {
      try {
        const sources = await skills.listSources(instanceId);
        return textResult(JSON.stringify(sources));
      } catch (err) {
        return formatToolError(err, "Failed to list skill sources");
      }
    },

    async listSkillsInSource({ sourceId }: { sourceId: string }): Promise<ToolContent> {
      try {
        const src = await skills.getSource(sourceId);
        if (!src) return errorResult(`skill source ${JSON.stringify(sourceId)} not found`);
        const list = await skills.listSkills(sourceId, instanceId);
        return textResult(JSON.stringify(list));
      } catch (err) {
        return formatToolError(err, "Failed to list skills");
      }
    },

    async installSkill(input: { source: string; name: string; version: string }): Promise<ToolContent> {
      try {
        const installed = await skills.installSkill({
          instanceId,
          source: input.source,
          name: input.name,
          version: input.version,
        });
        return textResult(
          `Installed ${input.name} @ ${input.version.slice(0, 8)}. Instance now has ${installed.length} skill(s).`,
        );
      } catch (err) {
        return formatToolError(err, "Failed to install skill");
      }
    },

    async uninstallSkill(input: { source: string; name: string }): Promise<ToolContent> {
      try {
        const remaining = await skills.uninstallSkill({
          instanceId,
          source: input.source,
          name: input.name,
        });
        return textResult(
          `Uninstalled ${input.name}. Instance now has ${remaining.length} skill(s).`,
        );
      } catch (err) {
        return formatToolError(err, "Failed to uninstall skill");
      }
    },

    async publishSkill(input: {
      sourceId: string;
      name: string;
      title?: string;
      body?: string;
    }): Promise<ToolContent> {
      try {
        const result = await skills.publishSkill({
          instanceId,
          sourceId: input.sourceId,
          name: input.name,
          title: input.title,
          body: input.body,
        });
        return textResult(`Published ${input.name}. PR: ${result.prUrl}`);
      } catch (err) {
        return formatToolError(err, "Failed to publish skill");
      }
    },
  };
}
