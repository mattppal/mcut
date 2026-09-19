import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { DESKTOP_INVOKES, type DesktopInfo } from './contract'

describe('DESKTOP_INVOKES', () => {
  test('a malformed project.save input is rejected with a zod error', () => {
    const malformed = { project: { name: 'no id, no size, no fps' }, path: 42 }
    expect(() => DESKTOP_INVOKES['project.save'].input.parse(malformed)).toThrow(z.ZodError)
  })

  test('a valid app.info output parses to the literal object', () => {
    const info: DesktopInfo = {
      appVersion: '0.1.0',
      platform: 'linux',
      mcp: {
        url: 'http://127.0.0.1:44737/mcp?token=0123456789abcdef',
        cursorInstallUrl: 'cursor://anysphere.cursor-deeplink/mcp/install?name=mcut&config=eyJ1cmwiOiJodHRwOi8vMTI3LjAuMC4xOjQ0NzM3L21jcCJ9',
      },
      transcription: { configured: false },
    }
    expect(DESKTOP_INVOKES['app.info'].output.parse(info)).toEqual(info)
  })
})
