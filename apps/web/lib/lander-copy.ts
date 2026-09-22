import type { DesktopRelease } from './desktop-release'

export interface LanderCopy {
  subhead: string
  traceIntro: string
  waitlistLead: string
  waitlistHint: string
  waitlistButton: string
  waitlistJoined: string
  phoneHeroLabel: string
  waysTitle: string
  sdk: { title: string; line: string; link: string }
  mcp: { title: string; line: string; link: string }
  studio: { title: string; lines: readonly string[] } | null
}

const SHARED = {
  subhead: 'This is mcut Studio, the editor built on the mcut SDK. On a desktop browser an agent is editing it live, and you can take over.',
  traceIntro: 'An agent is editing this video.',
  waitlistButton: 'Join the waitlist',
  waitlistJoined: 'You are on the waitlist.',
  sdk: {
    title: 'From TypeScript',
    line: "The agent's action ran this command through engine.dispatch.",
    link: 'Read the quickstart',
  },
} as const

const MCP = { title: 'From an agent', link: 'Connect an agent' } as const

export function landerCopy(release: DesktopRelease | null): LanderCopy {
  if (release === null) {
    return {
      ...SHARED,
      waitlistLead: 'Studio is not public yet. Join the waitlist for the first build.',
      waitlistHint: 'The SDK is open source today on GitHub and npm.',
      phoneHeroLabel: 'Join the mcut Studio waitlist',
      waysTitle: 'Two ways to make the same edit',
      mcp: { ...MCP, line: 'The MCP server exposes this request as a tool.' },
      studio: null,
    }
  }
  return {
    ...SHARED,
    waitlistLead: `mcut Studio ${release.version} is out for macOS and Linux. Join the waitlist for release notes.`,
    waitlistHint: 'One email per release and nothing else.',
    phoneHeroLabel: 'Get mcut Studio for desktop',
    waysTitle: 'Three ways to make the same edit',
    mcp: { ...MCP, line: 'Connect Cursor to Studio on port 44737 and the same request runs on your desktop.' },
    studio: {
      title: 'From the desktop',
      lines: [`mcut Studio ${release.version} for macOS and Linux.`, 'Captions run on this device.', 'Projects stay on your disk.'],
    },
  }
}
