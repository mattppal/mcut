import { createEditorOperatorRegistry, registerCoreOperators } from "@mcut/editor";
import {
  listMcpToolDefinitions as listContractToolDefinitions,
  type McpToolDefinition,
  type McpToolProfile,
} from "@mcut/mcp-server/contract";
import { listToolDefinitions } from "@mcut/timeline";

/** The contract's tool surface composed with this app's operators and commands. */
export function listMcpToolDefinitions(profile: McpToolProfile = "agent"): McpToolDefinition[] {
  return listContractToolDefinitions(profile, {
    operators: registerCoreOperators(createEditorOperatorRegistry()).list(),
    commands: listToolDefinitions(),
  });
}
