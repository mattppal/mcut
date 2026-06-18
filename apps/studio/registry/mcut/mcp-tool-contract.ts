export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type McpToolProfile = "agent" | "full" | "commands";

export const MCP_TOOL_PROFILES: McpToolProfile[] = ["agent", "full", "commands"];

export const MCP_AGENT_TOOL_NAMES = [
  "get_summary",
  "get_project",
  "get_media_context",
  "get_audio_activity",
  "get_transcript",
  "search_transcript",
  "ensure_transcript",
  "list_commands",
  "apply_commands",
  "list_operators",
  "run_operator",
  "list_actions",
  "run_action",
  "undo",
  "redo",
] as const;

const EMPTY_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} satisfies Record<string, unknown>;

const AUDIO_ACTIVITY_INPUT_SCHEMA = {
  type: "object",
  properties: {
    elementId: {
      type: "string",
      description: "Optional video/audio element id. Defaults to selected media, first video, then first audio.",
    },
    includeWaveform: {
      type: "boolean",
      description: "Include compact max-amplitude waveform buckets for coarse inspection.",
    },
    waveformBuckets: {
      type: "integer",
      minimum: 1,
      description: "Waveform bucket count when includeWaveform is true. Defaults to 128.",
    },
    startMs: {
      type: "number",
      minimum: 0,
      description: "Optional source start time in milliseconds. Defaults to the selected element source start.",
    },
    endMs: {
      type: "number",
      minimum: 0,
      description: "Optional source end time in milliseconds. Defaults to the selected element source end.",
    },
    frameMs: {
      type: "number",
      minimum: 1,
      description: "Analysis frame size in milliseconds. Defaults to 30.",
    },
    threshold: {
      type: "number",
      minimum: 0,
      description: "RMS activity threshold. Defaults to 0.004.",
    },
    minSoundMs: {
      type: "number",
      minimum: 0,
      description: "Sound runs shorter than this are treated as silence. Defaults to 120.",
    },
    minSilenceMs: {
      type: "number",
      minimum: 0,
      description: "Silence runs shorter than this are treated as sound. Defaults to 120.",
    },
    paddingMs: {
      type: "number",
      minimum: 0,
      description: "Trim this much from each returned silence window edge. Defaults to 0.",
    },
  },
  additionalProperties: false,
} satisfies Record<string, unknown>;

const STATIC_TOOL_DETAILS: Record<
  (typeof MCP_AGENT_TOOL_NAMES)[number],
  { description: string; inputSchema: Record<string, unknown> }
> = {
  get_summary: {
    description:
      "A compact textual rendering of the current project: tracks, elements, ids, timing, effects, transitions, assets, playhead, and selection.",
    inputSchema: EMPTY_SCHEMA,
  },
  get_project: {
    description: "The full project document as JSON.",
    inputSchema: EMPTY_SCHEMA,
  },
  get_media_context: {
    description:
      "Agent-friendly project and media metadata: dimensions, fps, duration, playback, selection, assets, tracks, source ranges, markers, and transcript availability.",
    inputSchema: EMPTY_SCHEMA,
  },
  get_audio_activity: {
    description:
      "Live bridge only: analyze a video/audio clip and return compact source sound/silence windows for silence trimming, audio-aware cuts, and coarse sound inspection.",
    inputSchema: AUDIO_ACTIVITY_INPUT_SCHEMA,
  },
  get_transcript: {
    description:
      "Read the transcript derived from caption elements. This does not start transcription.",
    inputSchema: {
      type: "object",
      properties: {
        includeWords: {
          type: "boolean",
          description: "Include absolute word timings for precise speech-boundary edits.",
        },
      },
      additionalProperties: false,
    },
  },
  search_transcript: {
    description: "Search the caption-derived transcript and return timeline times for matches.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  ensure_transcript: {
    description:
      "Live bridge only: transcribe a target clip with local Whisper in the connected browser when transcript captions are missing, then apply word-timed captions.",
    inputSchema: {
      type: "object",
      properties: {
        elementId: {
          type: "string",
          description: "Optional video/audio element id. Defaults to selected media, first video, then first audio.",
        },
        replace: {
          type: "boolean",
          description: "Replace captions overlapping the target clip. Defaults to false.",
        },
        language: {
          type: "string",
          description: "Optional language hint for Whisper.",
        },
      },
      additionalProperties: false,
    },
  },
  list_commands: {
    description:
      "List every raw timeline command schema. Use this when apply_commands needs exact payload details.",
    inputSchema: EMPTY_SCHEMA,
  },
  apply_commands: {
    description:
      "Apply one or more serializable timeline commands in one undoable transaction, then return an updated project summary.",
    inputSchema: {
      type: "object",
      properties: {
        commands: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                description: "Timeline command type, e.g. splitElement, trimElement, addElement.",
              },
            },
            required: ["type"],
            additionalProperties: true,
          },
        },
      },
      required: ["commands"],
      additionalProperties: false,
    },
  },
  list_operators: {
    description:
      "List user-level editor operators available to agents. Prefer these for UI-parity actions.",
    inputSchema: EMPTY_SCHEMA,
  },
  run_operator: {
    description:
      "Run a user-level editor operator by id. Use list_operators first when you need the available ids and input schemas.",
    inputSchema: {
      type: "object",
      properties: {
        operatorId: { type: "string" },
        input: {
          type: "object",
          additionalProperties: true,
        },
      },
      required: ["operatorId"],
      additionalProperties: false,
    },
  },
  list_actions: {
    description:
      "List browser editor actions available in the live editor, including menu, palette, and hotkey actions.",
    inputSchema: EMPTY_SCHEMA,
  },
  run_action: {
    description:
      "Run a browser editor action by id in the live editor. These are the same actions used by menus, hotkeys, and the command palette.",
    inputSchema: {
      type: "object",
      properties: {
        actionId: { type: "string" },
        input: {
          type: "object",
          additionalProperties: true,
        },
      },
      required: ["actionId"],
      additionalProperties: false,
    },
  },
  undo: {
    description: "Undo the most recent edit.",
    inputSchema: EMPTY_SCHEMA,
  },
  redo: {
    description: "Redo the most recently undone edit.",
    inputSchema: EMPTY_SCHEMA,
  },
};

export const MCP_AGENT_TOOL_DEFINITIONS: McpToolDefinition[] = MCP_AGENT_TOOL_NAMES.map(
  (name) => ({
    name,
    ...STATIC_TOOL_DETAILS[name],
  }),
);

export function parseMcpToolProfile(value: unknown): McpToolProfile {
  return typeof value === "string" && MCP_TOOL_PROFILES.includes(value as McpToolProfile)
    ? (value as McpToolProfile)
    : "agent";
}

export function mcpOperatorToolName(operatorId: string): string {
  return `operator_${operatorId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}
