import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'mcut Studio',
  robots: { index: false },
}

export default async function EmbedPage() {
  const { EmbedClient } = await import('./embed-client')

  return <EmbedClient />
}
