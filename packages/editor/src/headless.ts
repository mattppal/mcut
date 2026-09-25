import { ANIMATION_PRESET_CATEGORIES, getElement, summarizeProject, type BuiltinCommand, type EditorEngine } from '@mcut/timeline'

export function withPlayheadDefaults(engine: EditorEngine, command: BuiltinCommand): BuiltinCommand {
  if (command.type !== 'applyAnimationPreset' || command.atMs !== undefined) return command
  const element = getElement(engine.project, command.elementId)
  if (!element) return command
  const localMs = Math.round(engine.playback.state.currentTimeMs - element.startMs)
  const onClip = ANIMATION_PRESET_CATEGORIES.out.includes(command.preset)
    ? localMs > 0 && localMs <= element.durationMs
    : localMs >= 0 && localMs < element.durationMs
  return onClip ? { ...command, atMs: localMs } : command
}

export function applyCommands(engine: EditorEngine, commands: readonly BuiltinCommand[]): void {
  engine.transact(() => {
    for (const command of commands) engine.dispatch(withPlayheadDefaults(engine, command))
  })
}

export function summarizeEngine(engine: EditorEngine): string {
  const playback = engine.playback.state
  const selection = engine.selection.elementIds
  return (
    `${summarizeProject(engine.project)}\n` +
    `Playhead: ${(playback.currentTimeMs / 1000).toFixed(2)}s` +
    ` (${playback.isPlaying ? 'playing' : 'paused'})` +
    ` · Selection: ${selection.length > 0 ? selection.join(', ') : 'none'}`
  )
}
