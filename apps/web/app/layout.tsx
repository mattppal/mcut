import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif, Inter } from "next/font/google";
import { RootProvider } from "fumadocs-ui/provider/next";
import "./globals.css";
import { cn } from "@/lib/utils";

const inter = Inter({subsets:['latin'],variable:'--font-sans'});
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  style: "italic",
  weight: "400",
  variable: "--font-logo",
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const ogTitle = "Open source video editing for agents";
const ogDescription =
  "TypeScript packages for timelines, media, captions, CLI workflows, and MCP tools.";
const ogImage = `/og?title=${encodeURIComponent(ogTitle)}&description=${encodeURIComponent(
  ogDescription,
)}`;

export const metadata: Metadata = {
  metadataBase: new URL("https://mcut.com"),
  title: "mcut — open source video SDK and editor",
  description:
    "Open-source video editing SDK for TypeScript apps. Use the mcut packages today, then join the waitlist for the full editor.",
  openGraph: {
    title: "mcut — open source video SDK and editor",
    description:
      "Open-source video editing SDK for TypeScript apps. Use the mcut packages today, then join the waitlist for the full editor.",
    siteName: "mcut",
    type: "website",
    images: [
      {
        url: ogImage,
        width: 1200,
        height: 630,
        alt: "mcut open source video editing for agents",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "mcut — open source video SDK and editor",
    description:
      "Open-source video editing SDK for TypeScript apps. Use the mcut packages today, then join the waitlist for the full editor.",
    images: [ogImage],
  },
  icons: {
    icon: [
      {
        url: "/favicon-light.svg",
        media: "(prefers-color-scheme: light)",
        type: "image/svg+xml",
      },
      {
        url: "/favicon-dark.svg",
        media: "(prefers-color-scheme: dark)",
        type: "image/svg+xml",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "h-full",
        "antialiased",
        geistSans.variable,
        geistMono.variable,
        instrumentSerif.variable,
        "font-sans",
        inter.variable,
      )}
    >
      <body className="min-h-full flex flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
