import { HeroDemo } from '@/components/hero-demo'
import { InstallCommands } from '@/components/install-commands'
import { SignupForm } from '@/components/signup-form'
import { SiteFooter, SiteHeader } from '@/components/site-chrome'
import { ThreeWaysIn } from '@/components/three-ways-in'
import { DEMO_CLIP } from '@/lib/demo-clip'
import { desktopRelease } from '@/lib/desktop-release.generated'

function Serif({ children }: { children: React.ReactNode }) {
  return (
    <em
      className="box-decoration-clone rounded-sm bg-violet-200/80 px-1 font-bold tracking-wide text-foreground dark:bg-violet-500/35"
      style={{
        fontFamily: "var(--font-logo), 'Instrument Serif', Georgia, serif",
      }}
    >
      {children}
    </em>
  )
}

export default function Home() {
  const release = desktopRelease

  return (
    <div className="flex flex-1 flex-col overflow-x-clip bg-background text-foreground">
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-6">
        <section className="mx-auto flex max-w-2xl flex-col items-center gap-4 pt-10 pb-8 text-center sm:pt-14 sm:pb-10">
          <h1 className="text-4xl leading-[1.12] tracking-tight text-balance sm:text-5xl">
            Open source video editing for <Serif>agents</Serif>
          </h1>
          <p className="max-w-md leading-relaxed text-muted-foreground">
            This is the real Studio build. An agent is editing it through the same MCP tools it would use on your desktop.
          </p>
        </section>
        <HeroDemo clip={DEMO_CLIP} />
        <section className="mx-auto flex w-full max-w-2xl flex-col gap-6 pt-10 pb-12 sm:pt-12 sm:pb-16">
          <p className="max-w-md leading-relaxed text-muted-foreground">
            {release === null
              ? 'The full editor is coming soon. Join the waitlist for early access.'
              : `mcut Studio ${release.version} is out for macOS and Linux. Join the waitlist for updates.`}
          </p>
          <SignupForm />
        </section>
        <div className="mx-auto w-full max-w-5xl">
          <ThreeWaysIn release={release} />
        </div>
        <div className="mx-auto w-full max-w-2xl pt-10 pb-24">
          <InstallCommands />
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
