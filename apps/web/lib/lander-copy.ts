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
  traceIntro: 'An agent is editing this video over MCP.',
  waitlistButton: 'Join the waitlist',
  waitlistJoined: 'You are on the waitlist.',
  sdk: {
    title: 'From TypeScript',
    line: 'engine.dispatch takes the same command object the agent sent.',
    link: 'Read the quickstart',
  },
} as const

export function landerCopy(release: DesktopRelease | null): LanderCopy {
  if (release === null) {
    return {
      ...SHARED,
      subhead: 'Below is mcut Studio, the editor built on the SDK. On a desktop browser an agent is editing it live over MCP, and you can take over.',
      waitlistLead: 'Studio is not public yet. Join the waitlist for the first build.',
      waitlistHint: 'The SDK is open source today on GitHub and npm.',
      phoneHeroLabel: 'mcut Studio, join the waitlist',
      waysTitle: 'Two ways to make the same edit',
      mcp: {
        title: 'From an agent',
        line: 'The MCP server exposes this request as a tool. The live bridge into Studio ships with the desktop build.',
        link: 'Connect an agent',
      },
      studio: null,
    }
  }
  return {
    ...SHARED,
    subhead: 'Below is mcut Studio, the editor built on the SDK. On a desktop browser an agent is editing it live over MCP, and you can take over.',
    waitlistLead: `mcut Studio ${release.version} is out for macOS and Linux. Join the waitlist for release notes.`,
    waitlistHint: 'One email per release and nothing else.',
    phoneHeroLabel: 'Get mcut Studio for desktop',
    waysTitle: 'Three ways to make the same edit',
    mcp: {
      title: 'From an agent',
      line: 'Connect Cursor to Studio on port 44737 and the same request runs on your desktop.',
      link: 'Connect an agent',
    },
    studio: {
      title: 'From the desktop',
      lines: [`mcut Studio ${release.version} for macOS and Linux.`, 'Captions run on this device.', 'Projects stay on your disk.'],
    },
  }
}
