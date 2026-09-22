import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DownloadList } from '@/components/download-list'
import { SiteFooter, SiteHeader } from '@/components/site-chrome'
import { Button } from '@/components/ui/button'
import { STUDIO_RELEASED, publicRelease } from '@/lib/release-gate'

const RELEASES_URL = 'https://github.com/mattppal/mcut/releases?q=mcut-desktop&expanded=true'

export const metadata: Metadata = {
  title: 'Download mcut Studio',
  description: 'Download mcut Studio for macOS or Linux.',
}

function formatReleaseDate(publishedAt: string): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(new Date(publishedAt))
}

export default function DownloadsPage() {
  if (!STUDIO_RELEASED) notFound()
  const release = publicRelease()
  const linuxName = release === null ? null : release.assets['linux-x86_64'].name

  return (
    <div className="flex flex-1 flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-6 pt-10 pb-24 sm:pt-16">
        <div className="flex flex-col gap-4">
          <h1 className="text-4xl leading-[1.12] tracking-tight text-balance sm:text-5xl">Download mcut Studio</h1>
          {release === null ? (
            <>
              <p className="max-w-md leading-relaxed text-muted-foreground">Builds for macOS and Linux are published on GitHub Releases.</p>
              <Button nativeButton={false} render={<a href={RELEASES_URL} />}>
                All releases
              </Button>
            </>
          ) : (
            <>
              <p className="max-w-md leading-relaxed text-muted-foreground">
                Version {release.version}, released {formatReleaseDate(release.publishedAt)}.{' '}
                <a className="text-foreground underline underline-offset-4" href={release.notesUrl}>
                  Release notes
                </a>
                .{' '}
                <a className="text-foreground underline underline-offset-4" href={RELEASES_URL}>
                  All releases
                </a>
                .
              </p>
              <DownloadList release={release} />
            </>
          )}
        </div>
        {linuxName !== null ? (
          <>
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-medium">macOS</h2>
              <p className="leading-relaxed text-muted-foreground">
                Open the disk image and drag mcut Studio into Applications. The app is signed ad hoc and is not notarized by Apple, so the first launch stops on
                a Gatekeeper dialog. Click Done, open System Settings, go to Privacy & Security, and click Open Anyway next to mcut Studio. Later launches open
                with a double-click. Full steps are on{' '}
                <Link className="text-foreground underline underline-offset-4" href="/docs/studio/install">
                  Install Studio
                </Link>
                .
              </p>
            </section>
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-medium">Linux</h2>
              <p className="leading-relaxed text-muted-foreground">Make the AppImage executable and run it.</p>
              <pre className="overflow-x-auto font-mono text-xs leading-relaxed">{`chmod +x ${linuxName}\n./${linuxName}`}</pre>
              <p className="leading-relaxed text-muted-foreground">
                On a machine without FUSE, run it with <span className="font-mono text-xs">--appimage-extract-and-run</span>. See the{' '}
                <a className="text-foreground underline underline-offset-4" href="https://docs.appimage.org/user-guide/troubleshooting/fuse.html">
                  AppImage FUSE troubleshooting guide
                </a>
                .
              </p>
            </section>
            <p className="text-sm text-muted-foreground">Windows is not supported yet.</p>
          </>
        ) : null}
      </main>
      <SiteFooter />
    </div>
  )
}
