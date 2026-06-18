"use client";

import { createEditorOperatorRegistry, registerCoreOperators } from "@mcut/editor";

/**
 * The webapp's operator registry instance: the SAME user-level operators an
 * agent gets over MCP, consumed here by the action layer (hotkeys/palette
 * delegate to operators via `defineAction({ operator })`). One definition,
 * two surfaces — agents access the editor exactly the way a human does.
 * Register custom operators on this instance to reach both.
 */
export const editorOperators = registerCoreOperators(createEditorOperatorRegistry());
