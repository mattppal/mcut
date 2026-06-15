import { BrandMark } from "@/components/brand-mark";
import { InstallCommands } from "@/components/install-commands";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const POINTS: [string, React.ReactNode][] = [
  [
    "Open source",
    "The Apache-2.0 SDK is available now: timeline engine, editor operators, compositor, media/export, React bindings, transcription, CLI, and MCP server packages.",
  ],
  [
    "Editor, coming soon",
    "The editor will package the same edit model into a polished app for cutting, captioning, exporting, and agent-assisted video work.",
  ],
  [
    "Timeline engine",
    "Typed project model, serializable commands, multi-track invariants, undo/redo, selectors, and reactive stores in @mcut/timeline.",
  ],
  [
    "Editor operators",
    "User-level edit behavior lives in @mcut/editor: gesture planning, core operators, and higher-level actions without framework dependencies.",
  ],
  [
    "Preview and export",
    "@mcut/compositor renders frames with Canvas2D; @mcut/media handles probing, thumbnails, audio extraction, and WebCodecs export to MP4, WebM, or MKV.",
  ],
  [
    "React bindings",
    "@mcut/react provides the editor provider, hooks, player canvas, playback clock, selection overlay, and audio preview for custom interfaces.",
  ],
  [
    "Captions",
    "@mcut/transcription normalizes transcripts, captions, SRT, and VTT. Providers ship for AssemblyAI, Vercel AI SDK models, and on-device Whisper.",
  ],
  [
    "Agent tools",
    "@mcut/cli runs headless edits from the command line. The upcoming editor owns the live MCP tooling, browser-session bridge, and human tool browser.",
  ],
  [
    "Apache-2.0",
    "Core packages, providers, CLI, and MCP server ship with an explicit patent grant for commercial adoption.",
  ],
];

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
  );
}

function SignupForm() {
  return (
    <form aria-label="Join the mcut editor waitlist" className="max-w-md">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="signup-email">
          Email address
        </label>
        <Input
          id="signup-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          className="h-9 bg-background"
          required
        />
        <Button type="button" size="lg" className="h-9 sm:w-auto">
          Join editor waitlist
        </Button>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        For editor early access only. The OSS SDK is available now on GitHub and npm.
      </p>
    </form>
  );
}

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-2xl items-center justify-between px-6 py-6">
        <BrandMark wordmark className="tracking-wide" />
        <nav className="flex items-center gap-5 text-sm">
          <a
            className="text-muted-foreground transition-colors hover:text-foreground"
            href="https://github.com/mattppal/mcut"
          >
            GitHub
          </a>
          <a
            className="text-muted-foreground transition-colors hover:text-foreground"
            href="https://github.com/mattppal/mcut/tree/main/packages"
          >
            Packages
          </a>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6">
        <section className="flex flex-col gap-6 pt-24 pb-16">
          <h1 className="text-5xl tracking-tight text-balance">
            Open source editing you own. <Serif>Editor</Serif> coming soon.
          </h1>
          <p className="max-w-md leading-relaxed text-muted-foreground">
            mcut is two things: an Apache-2.0 TypeScript video editing SDK you can
            use today, and a full editor built on the same engine. Join the list for
            editor early access.
          </p>
          <SignupForm />
        </section>

        <InstallCommands />

        <dl className="pt-4 pb-24">
          {POINTS.map(([term, body]) => (
            <div
              key={term}
              className="grid gap-1 border-b py-4 last:border-b-0 sm:grid-cols-[11rem_1fr] sm:gap-6"
            >
              <dt className="text-sm font-medium">{term}</dt>
              <dd className="text-sm leading-relaxed text-muted-foreground">{body}</dd>
            </div>
          ))}
        </dl>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center gap-x-5 gap-y-2 px-6 py-6 text-xs text-muted-foreground">
          <span>Apache-2.0</span>
          <a
            className="transition-colors hover:text-foreground"
            href="/.well-known/agent-skills/mcut/SKILL.md"
          >
            Agent skill
          </a>
          <span className="ml-auto font-mono">@mcut/*</span>
        </div>
      </footer>
    </div>
  );
}
