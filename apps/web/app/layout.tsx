import type { Metadata } from 'next'
import { Caveat, Geist, Geist_Mono, Instrument_Serif, Inter } from 'next/font/google'
import { RootProvider } from 'fumadocs-ui/provider/next'
import './globals.css'
import { cn } from '@/lib/utils'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  style: 'italic',
  weight: '400',
  variable: '--font-logo',
})

const caveat = Caveat({ subsets: ['latin'], weight: '600', variable: '--font-hand', preload: false })

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  preload: false,
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  preload: false,
})

const ogTitle = 'Open source video editing for agents'
const ogDescription = 'A TypeScript timeline engine, an MCP server, and an editor built on them.'
const ogImage = `/og?title=${encodeURIComponent(ogTitle)}&description=${encodeURIComponent(ogDescription)}`

export const metadata: Metadata = {
  metadataBase: new URL('https://mcut.com'),
  title: 'mcut, open source video editing for agents',
  description:
    'A TypeScript timeline engine, an MCP server, and an editor built on them. Agents edit through the same commands you do, and every edit stays undoable.',
  openGraph: {
    title: 'mcut, open source video editing for agents',
    description:
      'A TypeScript timeline engine, an MCP server, and an editor built on them. Agents edit through the same commands you do, and every edit stays undoable.',
    siteName: 'mcut',
    type: 'website',
    images: [
      {
        url: ogImage,
        width: 1200,
        height: 630,
        alt: 'mcut open source video editing for agents',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'mcut, open source video editing for agents',
    description:
      'A TypeScript timeline engine, an MCP server, and an editor built on them. Agents edit through the same commands you do, and every edit stays undoable.',
    images: [ogImage],
  },
  icons: {
    icon: [
      {
        url: '/favicon-light.svg',
        media: '(prefers-color-scheme: light)',
        type: 'image/svg+xml',
      },
      {
        url: '/favicon-dark.svg',
        media: '(prefers-color-scheme: dark)',
        type: 'image/svg+xml',
      },
    ],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn('h-full', 'antialiased', geistSans.variable, geistMono.variable, instrumentSerif.variable, caveat.variable, 'font-sans', inter.variable)}
    >
      <body className="min-h-full flex flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  )
}
