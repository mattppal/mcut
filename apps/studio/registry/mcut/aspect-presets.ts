/**
 * Canvas aspect-ratio presets (platform delivery formats). Applying one sets
 * the project's width/height via `updateProject`; fps is untouched. Elements
 * keep their transforms — center-origin coordinates make a canvas resize a
 * reframe, not a layout break.
 */
export const ASPECT_PRESETS = [
  { id: "16-9", label: "16:9", hint: "YouTube / landscape", width: 1920, height: 1080 },
  { id: "9-16", label: "9:16", hint: "Shorts / Reels / TikTok", width: 1080, height: 1920 },
  { id: "1-1", label: "1:1", hint: "Square", width: 1080, height: 1080 },
  { id: "4-5", label: "4:5", hint: "Portrait feed", width: 1080, height: 1350 },
] as const;

export type AspectPreset = (typeof ASPECT_PRESETS)[number];

export function matchesAspect(project: { width: number; height: number }, preset: AspectPreset): boolean {
  return project.width * preset.height === project.height * preset.width;
}
