import { BrandMark } from "@/components/brand-mark";
import { InstallCommands } from "@/components/install-commands";
import { SignupForm } from "@/components/signup-form";

const POINTS: [string, React.ReactNode][] = [
  [
    "SDK available",
    "Use the TypeScript packages for timelines, previews, media/export, captions, React interfaces, and CLI workflows.",
  ],
  [
    "Built for agents",
    "Compose edits through serializable commands, editor operators, CLI tools, and MCP server packages.",
  ],
  [
    "Editor coming soon",
    "The full editor will use the same engine for cutting, captioning, exporting, and agent-assisted video work.",
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
          <h1 className="text-5xl leading-[1.12] tracking-tight text-balance">
            Open source video editing for <Serif>agents</Serif>
          </h1>
          <p className="max-w-md leading-relaxed text-muted-foreground">
            The full mcut editor is coming soon. Join the waitlist for early
            access.
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
