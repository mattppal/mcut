import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ASPECT_COMMAND, ASPECT_STEP } from '@/lib/agent-script'
import { ASSET_TARGETS, type AssetKey, type DesktopRelease } from '@/lib/desktop-release'
import { landerCopy, type LanderCopy } from '@/lib/lander-copy'
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

function StudioCard({ release, copy }: { release: DesktopRelease; copy: NonNullable<LanderCopy['studio']> }) {
  const [lead, ...rest] = copy.lines
  return (
    <Card title={copy.title}>
      <Line>{lead}</Line>
      <div className="flex flex-wrap gap-2">
        {STUDIO_ASSETS.map((key) => (
          <Button key={key} variant="outline" size="sm" nativeButton={false} render={<a href={release.assets[key].url} download />}>
            {ASSET_TARGETS[key].os}
          </Button>
        ))}
      </div>
      {rest.map((line) => (
        <Line key={line}>{line}</Line>
      ))}
    </Card>
  )
}

export function ThreeWaysIn({ release }: { release: DesktopRelease | null }) {
  const copy = landerCopy(release)
  return (
    <section className="flex flex-col gap-5">
      <h2 className="text-2xl tracking-tight">{copy.waysTitle}</h2>
      <div className={cn('grid gap-8', copy.studio === null ? 'sm:grid-cols-2' : 'sm:grid-cols-3')}>
        <Card title={copy.sdk.title}>
          <Snippet code={SDK_SNIPPET} />
          <Line>{copy.sdk.line}</Line>
          <Link href="/docs" className="text-sm font-medium underline-offset-4 hover:underline">
            {copy.sdk.link}
          </Link>
        </Card>
        <Card title={copy.mcp.title}>
          <Snippet code={AGENT_SNIPPET} />
          <Line>{copy.mcp.line}</Line>
          <Link href="/docs/studio/connect-cursor" className="text-sm font-medium underline-offset-4 hover:underline">
            {copy.mcp.link}
          </Link>
        </Card>
        {release !== null && copy.studio !== null && <StudioCard release={release} copy={copy.studio} />}
      </div>
    </section>
  )
}
