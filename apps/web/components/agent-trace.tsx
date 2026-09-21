import { Button } from '@/components/ui/button'
import { rowStatus, type ReplayPhase, type RowStatus, type TraceMode } from '@/lib/agent-replay'
import type { AgentStep } from '@/lib/agent-script'
import { CheckIcon, XIcon } from '@/lib/hugeicons'
import { cn } from '@/lib/utils'

interface AgentTraceProps {
  steps: readonly AgentStep[]
  prompt: string
  phase: ReplayPhase
  mode: TraceMode
  results: ReadonlyMap<string, unknown>
  onReplay: () => void
  onLoad: (() => void) | null
  onRun: (() => void) | null
}

function StatusGlyph({ status }: { status: RowStatus }) {
  switch (status.kind) {
    case 'queued':
      return <span className="size-2 rounded-full border border-muted-foreground/50" />
    case 'running':
      return <span className="size-3 animate-spin rounded-full border-2 border-foreground border-t-transparent motion-reduce:animate-none" />
    case 'ok':
      return <CheckIcon className="size-3.5" />
    case 'failed':
      return <XIcon className="size-3.5 text-destructive" />
    default: {
      const unhandled: never = status
      throw new Error(`Unhandled row status ${JSON.stringify(unhandled)}`)
    }
  }
}

function TraceRow({ index, step, status, result }: { index: number; step: AgentStep; status: RowStatus | null; result: unknown }) {
  const failed = status !== null && status.kind === 'failed'
  return (
    <li className="group relative">
      <button
        type="button"
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <span className="w-4 shrink-0 text-xs text-muted-foreground tabular-nums">{index + 1}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-mono text-xs">{step.tool}</span>
          <span className={cn('truncate text-xs', failed ? 'text-destructive' : 'text-muted-foreground')}>{failed ? status.message : step.digest}</span>
        </span>
        {status !== null && (
          <>
            <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
              <StatusGlyph status={status} />
            </span>
            <span className="sr-only">{status.kind}</span>
          </>
        )}
      </button>
      <pre className="absolute inset-x-0 top-full z-10 mt-1 hidden max-h-56 overflow-auto rounded-lg border bg-popover p-3 text-2xs leading-relaxed text-popover-foreground shadow-lg group-focus-within:block group-hover:block">
        {JSON.stringify(step.request, null, 2)}
        {result !== undefined && `\n\n${JSON.stringify(result, null, 2)}`}
      </pre>
    </li>
  )
}

function TraceFooter({ phase, onReplay, onLoad, onRun }: Pick<AgentTraceProps, 'phase' | 'onReplay' | 'onLoad' | 'onRun'>) {
  if (phase.kind === 'done' || phase.kind === 'failed' || phase.kind === 'handed-off') {
    return (
      <Button variant="outline" size="sm" onClick={onReplay}>
        Replay
      </Button>
    )
  }
  if (onLoad !== null) {
    return (
      <Button size="sm" onClick={onLoad}>
        Load the live editor (6 MB)
      </Button>
    )
  }
  if (onRun !== null) {
    return (
      <Button size="sm" onClick={onRun}>
        Run the session
      </Button>
    )
  }
  return <span className="text-xs text-muted-foreground">Click the editor to take over</span>
}

export function AgentTrace({ steps, prompt, phase, mode, results, onReplay, onLoad, onRun }: AgentTraceProps) {
  const live = mode === 'live'
  return (
    <aside aria-label="Agent session" className="flex flex-col gap-3 rounded-2xl border bg-card p-4 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium tracking-wider text-muted-foreground uppercase">Agent session</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-medium">
          <span className={cn('size-1.5 rounded-full', live ? 'bg-emerald-500' : 'bg-muted-foreground/50')} />
          {mode}
        </span>
      </div>
      <p className="text-muted-foreground">{prompt}</p>
      <ol className="-mx-2 flex flex-col">
        {steps.map((step, index) => (
          <TraceRow key={step.id} index={index} step={step} status={live ? rowStatus(phase, index) : null} result={results.get(step.id)} />
        ))}
      </ol>
      <div className="mt-auto flex items-center pt-1">
        <TraceFooter phase={phase} onReplay={onReplay} onLoad={onLoad} onRun={onRun} />
      </div>
    </aside>
  )
}
