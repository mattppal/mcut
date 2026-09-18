import { summarizeProject, type BuiltinCommand, type EditorEngine } from '@mcut/timeline'

export function applyCommands(engine: EditorEngine, commands: readonly BuiltinCommand[]): void {
  engine.transact(() => {
    for (const command of commands) engine.dispatch(command)
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
