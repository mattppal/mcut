# @mcut/mcp-server

## 0.1.0-alpha.1

### Minor Changes

- [#19](https://github.com/mattppal/mcut/pull/19) [`4878e4e`](https://github.com/mattppal/mcut/commit/4878e4ec2737a4c80aa4770e7b11ad790c7876ad) Thanks [@mattppal](https://github.com/mattppal)! - Add audio activity analysis and expose it through MCP live browser sessions.

### Patch Changes

- [#28](https://github.com/mattppal/mcut/pull/28) [`30d9168`](https://github.com/mattppal/mcut/commit/30d9168f944ce914d55e50107ae6bd6291386bd3) Thanks [@mattppal](https://github.com/mattppal)! - Wait briefly for the live editor WebSocket to reconnect before failing MCP bridge requests.

- [#30](https://github.com/mattppal/mcut/pull/30) [`db99ee6`](https://github.com/mattppal/mcut/commit/db99ee6828e372acf9c2c7b5247f21869603849f) Thanks [@mattppal](https://github.com/mattppal)! - Add a browser-safe `@mcut/mcp-server/contract` subpath exporting the MCP tool catalog (static tool definitions, profiles, `operatorToolName`, and tool-list composition helpers). The server now registers its tools from this contract, and the wire surface is pinned to it by a deep-equality test.

- [#93](https://github.com/mattppal/mcut/pull/93) [`7dfa960`](https://github.com/mattppal/mcut/commit/7dfa96035bd5c203cd09e6a2836fa0f71c02cb46) Thanks [@mattppal](https://github.com/mattppal)! - Format sources with oxfmt.

- [#19](https://github.com/mattppal/mcut/pull/19) [`4878e4e`](https://github.com/mattppal/mcut/commit/4878e4ec2737a4c80aa4770e7b11ad790c7876ad) Thanks [@mattppal](https://github.com/mattppal)! - Require a live bridge token for `mcut-bridge start` browser WebSocket connections.

- [#63](https://github.com/mattppal/mcut/pull/63) [`17ef0cb`](https://github.com/mattppal/mcut/commit/17ef0cbecfeac56cbc03ac8f49a266c01471ffc0) Thanks [@mattppal](https://github.com/mattppal)! - Element, effect, transition, container, and renderer registries are now closed tables. `registerElement`, `registerEffect`, and the other register functions are removed. `engine.dispatch` takes `BuiltinCommand`.

- [#33](https://github.com/mattppal/mcut/pull/33) [`5f1cae7`](https://github.com/mattppal/mcut/commit/5f1cae7ccd6326366bc680e59a6f1226be620588) Thanks [@mattppal](https://github.com/mattppal)! - Rewrite package descriptions in plain prose.

- [#36](https://github.com/mattppal/mcut/pull/36) [`0fb2eb4`](https://github.com/mattppal/mcut/commit/0fb2eb4cca70c974b0d79802b047b3a2327e75c2) Thanks [@mattppal](https://github.com/mattppal)! - Give every package-level failure an owner instead of console output or an empty catch.

- [#66](https://github.com/mattppal/mcut/pull/66) [`3aefe7a`](https://github.com/mattppal/mcut/commit/3aefe7ad15084d9f6aa5a9a68f9edb63bffcbdde) Thanks [@mattppal](https://github.com/mattppal)! - The editor operator registry is now a closed table. `EditorOperatorRegistry`, `createEditorOperatorRegistry`, and `registerCoreOperators` are removed in favor of `operators`, `OperatorId`, `parseOperatorId`, `listOperators`, and `runOperator`. Captions, silence cuts, lint, and platform presets moved out of the CLI into `@mcut/editor` and `@mcut/transcription` as pure functions with zod input schemas, and the MCP server exposes them as the `apply_captions`, `apply_silence_cuts`, `lint_project`, and `list_presets` tools. `McutMcpTarget` gains `applyCommands`, and the `operators` option on `createMcutMcpServer` is gone.

- [#39](https://github.com/mattppal/mcut/pull/39) [`532fa97`](https://github.com/mattppal/mcut/commit/532fa97c63721f29e45e1a07e1948428ff9a7d80) Thanks [@mattppal](https://github.com/mattppal)! - Tell users to run bun run dev and use the printed MCP URL when no editor tab is connected.

- [#75](https://github.com/mattppal/mcut/pull/75) [`dbf2f16`](https://github.com/mattppal/mcut/commit/dbf2f16e00c962c65159d4ab418accb35748e12a) Thanks [@mattppal](https://github.com/mattppal)! - Remove comments from the React bindings and the MCP server. Constraints stay as names and types.

- [#50](https://github.com/mattppal/mcut/pull/50) [`135bdd0`](https://github.com/mattppal/mcut/commit/135bdd05b0954489c9fffcb64fc9517cfe4ffeae) Thanks [@mattppal](https://github.com/mattppal)! - Static MCP tool arguments are parsed with zod before the handler runs and a bad argument is reported by field name, and `@mcut/transcription` exports `transcriptResultSchema` as the source of its `TranscriptResult` type.

- Updated dependencies [[`03cc06d`](https://github.com/mattppal/mcut/commit/03cc06daf1034f8dd5a8ec4640f86a08dcb7138b), [`834832d`](https://github.com/mattppal/mcut/commit/834832d355eaa57c1f834137ef8dc0a995a3abfc), [`5aad56b`](https://github.com/mattppal/mcut/commit/5aad56b25548ff130b3277bb4c97d791c08da0d7), [`4878e4e`](https://github.com/mattppal/mcut/commit/4878e4ec2737a4c80aa4770e7b11ad790c7876ad), [`187afb7`](https://github.com/mattppal/mcut/commit/187afb714bc18d72bed179cd7a46be83a3aa13b6), [`7dfa960`](https://github.com/mattppal/mcut/commit/7dfa96035bd5c203cd09e6a2836fa0f71c02cb46), [`110405d`](https://github.com/mattppal/mcut/commit/110405d29e4fce2f2ece5f56b1b15e9944f45f6a), [`4878e4e`](https://github.com/mattppal/mcut/commit/4878e4ec2737a4c80aa4770e7b11ad790c7876ad), [`14e10e9`](https://github.com/mattppal/mcut/commit/14e10e90669438c548a3873f53134fb06c673c78), [`37cda0c`](https://github.com/mattppal/mcut/commit/37cda0ce379c84f82bc8d6785f7e597418c209c3), [`17ef0cb`](https://github.com/mattppal/mcut/commit/17ef0cbecfeac56cbc03ac8f49a266c01471ffc0), [`e71776c`](https://github.com/mattppal/mcut/commit/e71776c27f0a663bba684a6cb015f417f865e40a), [`c9f8b6a`](https://github.com/mattppal/mcut/commit/c9f8b6a9e7b31df0e369443e0d494e3df516ffd1), [`3aefe7a`](https://github.com/mattppal/mcut/commit/3aefe7ad15084d9f6aa5a9a68f9edb63bffcbdde), [`c8c63b3`](https://github.com/mattppal/mcut/commit/c8c63b34315f24f81d0f551e192bc6ff699baff7), [`804ad84`](https://github.com/mattppal/mcut/commit/804ad84e6a46426b8cef655f97db291a2749e42d), [`135bdd0`](https://github.com/mattppal/mcut/commit/135bdd05b0954489c9fffcb64fc9517cfe4ffeae)]:
  - @mcut/timeline@0.1.0-alpha.1
  - @mcut/editor@0.1.0-alpha.1
  - @mcut/transcription@0.1.0-alpha.1
