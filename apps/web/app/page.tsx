import { HeroDemo } from '@/components/hero-demo'
import { InstallCommands } from '@/components/install-commands'
import { SignupForm } from '@/components/signup-form'
import { SiteFooter, SiteHeader } from '@/components/site-chrome'
import { ThreeWaysIn } from '@/components/three-ways-in'
import { DEMO_CLIP } from '@/lib/demo-clip'
import { landerCopy } from '@/lib/lander-copy'
import { publicRelease } from '@/lib/release-gate'

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
  const release = publicRelease()
  const copy = landerCopy(release)

  return (
    <div className="flex flex-1 flex-col overflow-x-clip bg-background text-foreground">
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-6">
        <section className="mx-auto flex max-w-2xl flex-col items-center gap-4 pt-10 pb-8 text-center sm:pt-14 sm:pb-10">
          <h1 className="text-4xl leading-[1.12] tracking-tight text-balance sm:text-5xl">
            Open source video editing for <Serif>agents</Serif>
          </h1>
          <p className="max-w-md leading-relaxed text-muted-foreground">{copy.subhead}</p>
        </section>
        <HeroDemo clip={DEMO_CLIP} traceIntro={copy.traceIntro} phoneHeroLabel={copy.phoneHeroLabel} />
        <section id="waitlist" className="mx-auto flex w-full max-w-2xl flex-col gap-6 pt-10 pb-12 sm:pt-12 sm:pb-16">
          <p className="max-w-md leading-relaxed text-muted-foreground">{copy.waitlistLead}</p>
          <SignupForm hint={copy.waitlistHint} button={copy.waitlistButton} joined={copy.waitlistJoined} />
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
