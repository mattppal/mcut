import { BrandMark } from '@/components/brand-mark'
import Link from 'next/link'

const NAV_LINK = 'inline-flex min-h-11 items-center px-1 -mx-1 text-muted-foreground transition-colors hover:text-foreground sm:min-h-0 sm:px-0 sm:mx-0'

export function SiteHeader() {
  return (
    <header className="mx-auto flex w-full max-w-2xl items-center justify-between px-6 py-4 sm:py-6">
      <BrandMark wordmark className="tracking-wide" />
      <nav className="flex items-center gap-3 text-sm sm:gap-5">
        <Link className={NAV_LINK} href="/downloads">
          Download
        </Link>
        <Link className={NAV_LINK} href="/docs">
          Docs
        </Link>
        <a className={NAV_LINK} href="https://github.com/mattppal/mcut">
          GitHub
        </a>
        <a className={NAV_LINK} href="https://github.com/mattppal/mcut/tree/main/packages">
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
        <a className="inline-flex min-h-11 items-center px-1 -mx-1 transition-colors hover:text-foreground sm:min-h-0 sm:px-0 sm:mx-0" href="/.well-known/agent-skills/mcut/SKILL.md">
          Agent skill
        </a>
        <span className="ml-auto font-mono">@mcut/*</span>
      </div>
    </footer>
  )
}
