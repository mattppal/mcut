export interface BrowserFixture {
  id: string;
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

export type BrowserMutation =
  | { id: string; outcome: "reject-or-partial" }
  | { id: string; outcome: "whole"; badge: string };

export const browserMutations: readonly BrowserMutation[] = [
  { id: "gaps-opus-ogg.trunc50", outcome: "reject-or-partial" },
  { id: "counter-h264-mp4.head4k", outcome: "reject-or-partial" },
  { id: "counter-vp9-webm.trunc50", outcome: "reject-or-partial" },
  { id: "counter-h264-mp4.moovend", outcome: "whole", badge: "0:03" },
];
