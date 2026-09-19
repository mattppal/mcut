import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import { cn } from '@/lib/utils'

const inter = localFont({
  src: './fonts/inter-latin.woff2',
  weight: '100 900',
  variable: '--font-sans',
})

const instrumentSerif = localFont({
  src: './fonts/instrument-serif-italic-latin.woff2',
  style: 'italic',
  weight: '400',
  variable: '--font-logo',
})

const geistMono = localFont({
  src: './fonts/geist-mono-latin.woff2',
  weight: '100 900',
  variable: '--font-geist-mono',
})

export const metadata: Metadata = {
  title: 'mcut Studio',
  description: 'A browser-based video editor for building multi-track compositions, captions, and exports.',
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
    <html lang="en" className={cn('h-full', 'antialiased', geistMono.variable, instrumentSerif.variable, 'font-sans', inter.variable)}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
