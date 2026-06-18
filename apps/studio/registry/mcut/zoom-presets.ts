import { ZOOM_PRESETS, type ZoomPreset } from "@mcut/timeline";

function punchOutPreset(preset: ZoomPreset): ZoomPreset {
  if (preset.name !== "Punch out") return preset;

  return {
    ...preset,
    tracks: {
      ...preset.tracks,
      "scale.x": [
        { t: 0, value: 1, easing: preset.tracks["scale.x"]?.[0]?.easing },
        { t: 1, value: 0.8 },
      ],
      "scale.y": [
        { t: 0, value: 1, easing: preset.tracks["scale.y"]?.[0]?.easing },
        { t: 1, value: 0.8 },
      ],
    },
  };
}

export const STUDIO_ZOOM_PRESETS: ZoomPreset[] = ZOOM_PRESETS.map(punchOutPreset);

