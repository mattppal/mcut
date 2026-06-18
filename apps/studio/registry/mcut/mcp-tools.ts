import { createEditorOperatorRegistry, registerCoreOperators } from "@mcut/editor";
import { listToolDefinitions as listCommandToolDefinitions } from "@mcut/timeline";
import { z } from "zod";
import {
  MCP_AGENT_TOOL_DEFINITIONS,
  mcpOperatorToolName,
  type McpToolProfile,
  type McpToolDefinition,
} from "./mcp-tool-contract";

function toInputSchema(schema: z.ZodType): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema, {
      io: "input",
      unrepresentable: "any",
    }) as Record<string, unknown>;
  } catch {
    return { type: "object" };
  }
}

export function listMcpToolDefinitions(profile: McpToolProfile = "agent"): McpToolDefinition[] {
  const commandTools = listCommandToolDefinitions();
  if (profile === "commands") return commandTools;

  if (profile === "agent") return MCP_AGENT_TOOL_DEFINITIONS;

  const operators = registerCoreOperators(createEditorOperatorRegistry()).list();
  const operatorTools = operators.map((operator) => ({
    name: mcpOperatorToolName(operator.id),
    description: `Editor operator "${operator.id}": ${operator.description}`,
    inputSchema: toInputSchema(operator.inputSchema),
  }));

  return [...MCP_AGENT_TOOL_DEFINITIONS, ...operatorTools, ...commandTools];
}
