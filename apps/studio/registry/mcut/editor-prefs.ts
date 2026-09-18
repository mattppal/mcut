import type { PreviewQuality } from "@mcut/react";
import { z } from "zod";

const previewQualitySchema = z.union([
  z.literal("auto"),
  z.literal("full"),
  z.number().positive(),
]) satisfies z.ZodType<PreviewQuality>;

const pref = <Schema extends z.ZodType>(schema: Schema) => schema.optional().catch(undefined);

const editorPrefsSchema = z.object({
  pxPerMs: pref(z.number()),
  snapEnabled: pref(z.boolean()),
  autoCrossfade: pref(z.boolean()),
  theme: pref(z.enum(["dark", "light"])),
  previewQuality: pref(previewQualitySchema),
});

export type EditorPrefs = z.infer<typeof editorPrefsSchema>;

export function parseEditorPrefs(stored: string | null): EditorPrefs {
  if (stored === null) return {};
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return {};
  }
  const prefs = editorPrefsSchema.safeParse(value);
  return prefs.success ? prefs.data : {};
}
