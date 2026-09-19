/**
 * The browser tier is capped to a representative subset so it finishes in a
 * few minutes; the Bun tier in packages/media covers every fixture and
 * mutation. `browserFixtures` decode in the codec-stripped Playwright
 * Chromium build (VP9, AV1, Opus, PCM, FLAC). `proprietaryCodecFixtures`
 * need H.264 and AAC decoders and only run when MCUT_CHROME_PATH points at
 * a full Chrome.
 */

export interface BrowserFixture {
  id: string;
  /** Media card badge for the recipe's expected duration (m:ss, whole seconds). */
  badge: string;
}

export const browserFixtures: readonly BrowserFixture[] = [
  { id: "counter-vp9-webm", badge: "0:03" },
  { id: "counter-vp9-mkv", badge: "0:03" },
  { id: "counter-av1-mkv", badge: "0:03" },
  { id: "odd-361x203-vp9-webm", badge: "0:02" },
  { id: "tiny-1x1-vp9-webm", badge: "0:01" },
  { id: "gaps-opus-webm", badge: "0:06" },
  { id: "gaps-pcm-wav", badge: "0:06" },
  { id: "gaps-flac", badge: "0:06" },
];

export const proprietaryCodecFixtures: readonly BrowserFixture[] = [
  { id: "rotate90-h264-mp4", badge: "0:02" },
  { id: "vfr-h264-mp4", badge: "0:04" },
  { id: "one-frame-h264-mp4", badge: "0:00" },
  { id: "portrait-360x640-h264-mp4", badge: "0:02" },
  { id: "still-image-h264-mp4", badge: "0:02" },
  { id: "no-audio-h264-mp4", badge: "0:02" },
];

/**
 * A `whole` file (moov moved after mdat) must import with its source badge.
 * Anything else may be rejected with a typed toast or import as a partial
 * file no longer than its source.
 */
export type BrowserMutation =
  | { id: string; outcome: "reject-or-partial" }
  | { id: string; outcome: "whole"; badge: string };

export const browserMutations: readonly BrowserMutation[] = [
  { id: "gaps-opus-ogg.trunc50", outcome: "reject-or-partial" },
  { id: "counter-h264-mp4.head4k", outcome: "reject-or-partial" },
  { id: "counter-vp9-webm.trunc50", outcome: "reject-or-partial" },
  { id: "counter-h264-mp4.moovend", outcome: "whole", badge: "0:03" },
];
