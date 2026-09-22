import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'mcut Studio',
  robots: { index: false },
}

const PRELOAD_CLIP = `
const clip = new URLSearchParams(location.search).get('clip')
if (clip) window.mcutEmbedClip = fetch(clip, { priority: 'low' })
`

export default async function EmbedPage() {
  const { EmbedClient } = await import('./embed-client')

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: PRELOAD_CLIP }} />
      <EmbedClient />
    </>
  )
}
