import { InstallCommands } from '@/components/install-commands'
import { SignupForm } from '@/components/signup-form'
import { SiteFooter, SiteHeader } from '@/components/site-chrome'
import { desktopRelease } from '@/lib/desktop-release.generated'
import Link from 'next/link'

const POINTS: [string, React.ReactNode][] = [
  ['SDK available', 'Use the TypeScript packages for timelines, previews, media/export, captions, React interfaces, and CLI workflows.'],
  ['Built for agents', 'Compose edits through serializable commands, editor operators, CLI tools, and MCP server packages.'],
  [
    'Studio',
    <>
      The desktop editor uses the same engine for cutting, captioning, exporting, and agent-assisted video work.{' '}
      <Link className="text-foreground underline underline-offset-4" href="/downloads">
        Download it
      </Link>{' '}
      for macOS or Linux.
    </>,
  ],
]

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
    <div className="flex flex-1 flex-col bg-background text-foreground">
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6">
        <section className="flex flex-col gap-6 pt-24 pb-16">
          <h1 className="text-5xl leading-[1.12] tracking-tight text-balance">
            Open source video editing for <Serif>agents</Serif>
          </h1>
          {release === null ? (
            <p className="max-w-md leading-relaxed text-muted-foreground">The full mcut editor is coming soon. Join the waitlist for early access.</p>
          ) : (
            <>
              <p className="max-w-md leading-relaxed text-muted-foreground">
                mcut Studio {release.version} is out for macOS and Linux.{' '}
                <Link className="text-foreground underline underline-offset-4" href="/downloads">
                  Download
                </Link>
              </p>
              <p className="max-w-md leading-relaxed text-muted-foreground">Join the waitlist for updates.</p>
            </>
          )}
          <SignupForm />
        </section>

        <InstallCommands />

        <dl className="pt-4 pb-24">
          {POINTS.map(([term, body]) => (
            <div key={term} className="grid gap-1 border-b py-4 last:border-b-0 sm:grid-cols-[11rem_1fr] sm:gap-6">
              <dt className="text-sm font-medium">{term}</dt>
              <dd className="text-sm leading-relaxed text-muted-foreground">{body}</dd>
            </div>
          ))}
        </dl>
      </main>

      <SiteFooter />
    </div>
  )
}
