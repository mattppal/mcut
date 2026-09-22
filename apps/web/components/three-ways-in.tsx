import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ASPECT_COMMAND, ASPECT_STEP } from '@/lib/agent-script'
import { ASSET_TARGETS, type AssetKey, type DesktopRelease } from '@/lib/desktop-release'
import { cn } from '@/lib/utils'

const SDK_SNIPPET = `engine.dispatch(${JSON.stringify(ASPECT_COMMAND, null, 2)})`
const AGENT_SNIPPET = JSON.stringify(ASPECT_STEP.request, null, 2)
const STUDIO_ASSETS: readonly AssetKey[] = ['mac-arm64', 'linux-x86_64']

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </div>
  )
}

function Snippet({ code }: { code: string }) {
  return <pre className="command-scroll overflow-x-auto rounded-lg bg-muted px-3 py-2.5 font-mono text-xs leading-relaxed">{code}</pre>
}

function Line({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
}

function StudioCard({ release }: { release: DesktopRelease }) {
  return (
    <Card title="Edit locally in Studio">
      <Line>mcut Studio {release.version}</Line>
      <div className="flex flex-wrap gap-2">
        {STUDIO_ASSETS.map((key) => (
          <Button key={key} variant="outline" size="sm" nativeButton={false} render={<a href={release.assets[key].url} download />}>
            {ASSET_TARGETS[key].os}
          </Button>
        ))}
      </div>
      <Line>Captions run on device</Line>
      <Line>Projects stay on disk</Line>
    </Card>
  )
}

export function ThreeWaysIn({ release }: { release: DesktopRelease | null }) {
  return (
    <section className="flex flex-col gap-5">
      <h2 className="text-2xl tracking-tight">{release === null ? 'Same edit, two ways in' : 'Same edit, three ways in'}</h2>
      <div className={cn('grid gap-8', release === null ? 'sm:grid-cols-2' : 'sm:grid-cols-3')}>
        <Card title="Build with the SDK">
          <Snippet code={SDK_SNIPPET} />
          <Line>{'The same JSON travels over MCP as apply_commands.'}</Line>
          <Link href="/docs" className="text-sm font-medium underline-offset-4 hover:underline">
            Quickstart
          </Link>
        </Card>
        <Card title="Connect an agent">
          <Snippet code={AGENT_SNIPPET} />
          <Line>Connect Cursor to Studio on port 44737.</Line>
          <Link href="/docs/studio/connect-cursor" className="text-sm font-medium underline-offset-4 hover:underline">
            Connect Cursor
          </Link>
        </Card>
        {release !== null && <StudioCard release={release} />}
      </div>
    </section>
  )
}
