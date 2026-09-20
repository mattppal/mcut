import { BrandMark } from '@/components/brand-mark'
import Link from 'next/link'

export function SiteHeader() {
  return (
    <header className="mx-auto flex w-full max-w-2xl items-center justify-between px-6 py-6">
      <BrandMark wordmark className="tracking-wide" />
      <nav className="flex items-center gap-5 text-sm">
        <Link className="text-muted-foreground transition-colors hover:text-foreground" href="/downloads">
          Download
        </Link>
        <Link className="text-muted-foreground transition-colors hover:text-foreground" href="/docs">
          Docs
        </Link>
        <a className="text-muted-foreground transition-colors hover:text-foreground" href="https://github.com/mattppal/mcut">
          GitHub
        </a>
        <a className="text-muted-foreground transition-colors hover:text-foreground" href="https://github.com/mattppal/mcut/tree/main/packages">
          Packages
        </a>
      </nav>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center gap-x-5 gap-y-2 px-6 py-6 text-xs text-muted-foreground">
        <span>Apache-2.0</span>
        <a className="transition-colors hover:text-foreground" href="/.well-known/agent-skills/mcut/SKILL.md">
          Agent skill
        </a>
        <span className="ml-auto font-mono">@mcut/*</span>
      </div>
    </footer>
  )
}
