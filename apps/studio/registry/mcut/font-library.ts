"use client";

import { useSyncExternalStore } from "react";
import type { ExportFontFaceInit } from "@mcut/media";
import { useEditor, useEngineSync } from "@mcut/react";
import type { Project } from "@mcut/timeline";
import { z } from "zod";
import { parseGoogleFontCss, weightDescriptorMatches } from "./font-css";

export type FontSource = "generic" | "google" | "system" | "uploaded";
export type FontCategory = "sans-serif" | "serif" | "display" | "handwriting" | "monospace";

export interface FontOption {
  family: string;
  source: FontSource;
  category: FontCategory;
  weights: number[];
  hasItalic: boolean;
  variableWeight?: { min: number; max: number };
}

export type SystemFontStatus = "unsupported" | "idle" | "loading" | "ready" | "denied";

export interface FontLibraryState {
  options: FontOption[];
  systemStatus: SystemFontStatus;
  recents: string[];
}

interface GoogleFontEntry {
  family: string;
  category: FontCategory;
  weights: number[];
  italic?: boolean;
  variable?: boolean;
}

const W_FULL = [100, 200, 300, 400, 500, 600, 700, 800, 900];

export const GOOGLE_FONTS: GoogleFontEntry[] = [
  { family: "Anton", category: "display", weights: [400] },
  { family: "Bebas Neue", category: "display", weights: [400] },
  { family: "Archivo Black", category: "display", weights: [400] },
  { family: "Alfa Slab One", category: "display", weights: [400] },
  { family: "Oswald", category: "display", weights: [200, 300, 400, 500, 600, 700], variable: true },
  { family: "Bangers", category: "display", weights: [400] },
  { family: "Luckiest Guy", category: "display", weights: [400] },
  { family: "Titan One", category: "display", weights: [400] },
  { family: "Passion One", category: "display", weights: [400, 700, 900] },
  { family: "Russo One", category: "display", weights: [400] },
  { family: "Black Ops One", category: "display", weights: [400] },
  { family: "Bungee", category: "display", weights: [400] },
  { family: "Lilita One", category: "display", weights: [400] },
  { family: "Righteous", category: "display", weights: [400] },
  { family: "Concert One", category: "display", weights: [400] },
  { family: "Abril Fatface", category: "display", weights: [400] },
  { family: "Inter", category: "sans-serif", weights: W_FULL, italic: true, variable: true },
  { family: "Roboto", category: "sans-serif", weights: [100, 300, 400, 500, 700, 900], italic: true, variable: true },
  { family: "Montserrat", category: "sans-serif", weights: W_FULL, italic: true, variable: true },
  { family: "Poppins", category: "sans-serif", weights: W_FULL, italic: true },
  { family: "Open Sans", category: "sans-serif", weights: [300, 400, 500, 600, 700, 800], italic: true, variable: true },
  { family: "Lato", category: "sans-serif", weights: [100, 300, 400, 700, 900], italic: true },
  { family: "Work Sans", category: "sans-serif", weights: W_FULL, italic: true, variable: true },
  { family: "Rubik", category: "sans-serif", weights: [300, 400, 500, 600, 700, 800, 900], italic: true, variable: true },
  { family: "Nunito", category: "sans-serif", weights: [200, 300, 400, 500, 600, 700, 800, 900], italic: true, variable: true },
  { family: "Raleway", category: "sans-serif", weights: W_FULL, italic: true, variable: true },
  { family: "Manrope", category: "sans-serif", weights: [200, 300, 400, 500, 600, 700, 800], variable: true },
  { family: "Space Grotesk", category: "sans-serif", weights: [300, 400, 500, 600, 700], variable: true },
  { family: "Barlow", category: "sans-serif", weights: W_FULL, italic: true },
  { family: "Archivo", category: "sans-serif", weights: W_FULL, italic: true, variable: true },
  { family: "Outfit", category: "sans-serif", weights: W_FULL, variable: true },
  { family: "Figtree", category: "sans-serif", weights: [300, 400, 500, 600, 700, 800, 900], italic: true, variable: true },
  { family: "Playfair Display", category: "serif", weights: [400, 500, 600, 700, 800, 900], italic: true, variable: true },
  { family: "Merriweather", category: "serif", weights: [300, 400, 700, 900], italic: true },
  { family: "Lora", category: "serif", weights: [400, 500, 600, 700], italic: true, variable: true },
  { family: "DM Serif Display", category: "serif", weights: [400], italic: true },
  { family: "Libre Baskerville", category: "serif", weights: [400, 700], italic: true },
  { family: "Instrument Serif", category: "serif", weights: [400], italic: true },
  { family: "Caveat", category: "handwriting", weights: [400, 500, 600, 700], variable: true },
  { family: "Pacifico", category: "handwriting", weights: [400] },
  { family: "Lobster", category: "handwriting", weights: [400] },
  { family: "Dancing Script", category: "handwriting", weights: [400, 500, 600, 700], variable: true },
  { family: "Permanent Marker", category: "handwriting", weights: [400] },
  { family: "Shadows Into Light", category: "handwriting", weights: [400] },
  { family: "Satisfy", category: "handwriting", weights: [400] },
  { family: "Kalam", category: "handwriting", weights: [300, 400, 700] },
  { family: "JetBrains Mono", category: "monospace", weights: [100, 200, 300, 400, 500, 600, 700, 800], italic: true, variable: true },
  { family: "Roboto Mono", category: "monospace", weights: [100, 200, 300, 400, 500, 600, 700], italic: true, variable: true },
  { family: "IBM Plex Mono", category: "monospace", weights: [100, 200, 300, 400, 500, 600, 700], italic: true },
  { family: "Space Mono", category: "monospace", weights: [400, 700], italic: true },
];

const GENERIC_FONTS: FontOption[] = [
  { family: "sans-serif", source: "generic", category: "sans-serif", weights: W_FULL, hasItalic: true },
  { family: "serif", source: "generic", category: "serif", weights: W_FULL, hasItalic: true },
  { family: "monospace", source: "generic", category: "monospace", weights: W_FULL, hasItalic: true },
];

const listeners = new Set<() => void>();
let snapshot: FontLibraryState | null = null;

function notify(): void {
  snapshot = null;
  for (const listener of listeners) listener();
}

interface SystemFace {
  postscriptName: string;
  style: string;
  weight: number;
  italic: boolean;
  data: LocalFontData;
}

const uploadedRecordSchema = z.object({
  id: z.string(),
  family: z.string(),
  weight: z.number(),
  italic: z.boolean(),
  data: z.instanceof(ArrayBuffer),
});

type UploadedRecord = z.infer<typeof uploadedRecordSchema>;

let systemStatus: SystemFontStatus = "idle";
const systemFamilies = new Map<string, SystemFace[]>();
const uploadedRecords: UploadedRecord[] = [];

interface LocalFontData {
  postscriptName: string;
  fullName: string;
  family: string;
  style: string;
  blob(): Promise<Blob>;
}

declare global {
  interface Window {
    queryLocalFonts?: (options?: { postscriptNames?: string[] }) => Promise<LocalFontData[]>;
  }
}

export function isSystemFontAccessSupported(): boolean {
  return typeof window !== "undefined" && typeof window.queryLocalFonts === "function";
}

const RECENTS_KEY = "mcut:fonts:recents:v1";
const SYSTEM_ENABLED_KEY = "mcut:fonts:system-enabled:v1";
const MAX_RECENTS = 8;

function readRecents(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(RECENTS_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((f): f is string => typeof f === "string") : [];
  } catch {
    return [];
  }
}

export function pushRecentFont(family: string): void {
  if (typeof window === "undefined") return;
  const next = [family, ...readRecents().filter((f) => f !== family)].slice(0, MAX_RECENTS);
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
  }
  notify();
}

function buildSnapshot(): FontLibraryState {
  const uploaded = new Map<string, FontOption>();
  for (const record of uploadedRecords) {
    const existing = uploaded.get(record.family);
    if (existing) {
      if (!existing.weights.includes(record.weight)) {
        existing.weights = [...existing.weights, record.weight].sort((a, b) => a - b);
      }
      existing.hasItalic = existing.hasItalic || record.italic;
    } else {
      uploaded.set(record.family, {
        family: record.family,
        source: "uploaded",
        category: "sans-serif",
        weights: [record.weight],
        hasItalic: record.italic,
      });
    }
  }
  const system: FontOption[] = [...systemFamilies.entries()]
    .map(([family, faces]) => ({
      family,
      source: "system" as const,
      category: "sans-serif" as const,
      weights: [...new Set(faces.map((f) => f.weight))].sort((a, b) => a - b),
      hasItalic: faces.some((f) => f.italic),
    }))
    .sort((a, b) => a.family.localeCompare(b.family));
  const google: FontOption[] = GOOGLE_FONTS.map((entry) => ({
    family: entry.family,
    source: "google",
    category: entry.category,
    weights: entry.weights,
    hasItalic: entry.italic ?? false,
    ...(entry.variable && entry.weights.length > 1
      ? {
          variableWeight: {
            min: entry.weights[0]!,
            max: entry.weights[entry.weights.length - 1]!,
          },
        }
      : {}),
  }));
  return {
    options: [...uploaded.values(), ...system, ...google, ...GENERIC_FONTS],
    systemStatus: isSystemFontAccessSupported() ? systemStatus : "unsupported",
    recents: readRecents(),
  };
}

const SERVER_STATE: FontLibraryState = { options: [], systemStatus: "unsupported", recents: [] };

export function getFontLibraryState(): FontLibraryState {
  snapshot ??= buildSnapshot();
  return snapshot;
}

export function subscribeFontLibrary(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function getFontLibraryServerState(): FontLibraryState {
  return SERVER_STATE;
}

export function findFontOption(family: string): FontOption | undefined {
  return getFontLibraryState().options.find((o) => o.family === family);
}

function googleCss2Url(entry: GoogleFontEntry, text?: string): string {
  const family = entry.family.replace(/ /g, "+");
  // Google Fonts CSS2 rejects a wght range against a static family, so only variable families request a range. https://developers.google.com/fonts/docs/css2
  const min = entry.weights[0] ?? 400;
  const max = entry.weights[entry.weights.length - 1] ?? 400;
  const stops = entry.variable && max > min ? [`${min}..${max}`] : entry.weights;
  const axes = entry.italic
    ? `:ital,wght@${[
        ...stops.map((w) => `0,${w}`),
        ...stops.map((w) => `1,${w}`),
      ].join(";")}`
    : `:wght@${stops.join(";")}`;
  const subset = text ? `&text=${encodeURIComponent(text)}` : "";
  return `https://fonts.googleapis.com/css2?family=${family}${axes}${subset}&display=swap`;
}

const injectedStylesheets = new Map<string, Promise<void>>();

function ensureStylesheetParsed(url: string): Promise<void> {
  let pending = injectedStylesheets.get(url);
  if (!pending) {
    pending = new Promise<void>((resolve) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      link.onload = () => resolve();
      link.onerror = () => resolve();
      document.head.appendChild(link);
    });
    injectedStylesheets.set(url, pending);
  }
  return pending;
}

export function closestWeight(available: number[], wanted: number): number {
  return available.reduce(
    (best, w) => (Math.abs(w - wanted) < Math.abs(best - wanted) ? w : best),
    available[0] ?? 400,
  );
}

function fontLoadSpec(family: string, weight: number, italic: boolean): string {
  return `${italic ? "italic " : ""}${weight} 64px "${family}"`;
}

async function ensureGoogleFont(entry: GoogleFontEntry, weight: number, italic: boolean): Promise<void> {
  await ensureStylesheetParsed(googleCss2Url(entry));
  const min = entry.weights[0] ?? 400;
  const max = entry.weights[entry.weights.length - 1] ?? 400;
  const w = entry.variable
    ? Math.round(Math.min(max, Math.max(min, weight)))
    : closestWeight(entry.weights, weight);
  await document.fonts.load(fontLoadSpec(entry.family, w, italic && (entry.italic ?? false)));
}

export function ensureFontPreview(family: string): void {
  if (typeof document === "undefined") return;
  const entry = GOOGLE_FONTS.find((e) => e.family === family);
  if (!entry) return;
  const preview: GoogleFontEntry = {
    ...entry,
    weights: [closestWeight(entry.weights, 400)],
    italic: false,
    variable: false,
  };
  void ensureStylesheetParsed(googleCss2Url(preview, family));
}

function weightFromStyleName(style: string): number {
  const s = style.toLowerCase();
  if (/hairline|thin/.test(s)) return 100;
  if (/extra\s*-?light|ultra\s*-?light/.test(s)) return 200;
  if (/light/.test(s)) return 300;
  if (/medium/.test(s)) return 500;
  if (/semi\s*-?bold|demi/.test(s)) return 600;
  if (/extra\s*-?bold|ultra\s*-?bold/.test(s)) return 800;
  if (/black|heavy/.test(s)) return 900;
  if (/bold/.test(s)) return 700;
  return 400;
}

function isItalicStyleName(style: string): boolean {
  return /italic|oblique/i.test(style);
}

function indexSystemFonts(fonts: LocalFontData[]): void {
  systemFamilies.clear();
  for (const font of fonts) {
    const faces = systemFamilies.get(font.family) ?? [];
    faces.push({
      postscriptName: font.postscriptName,
      style: font.style,
      weight: weightFromStyleName(font.style),
      italic: isItalicStyleName(font.style),
      data: font,
    });
    systemFamilies.set(font.family, faces);
  }
}

// queryLocalFonts requires transient activation, so the first enumeration must run from a user gesture. https://developer.mozilla.org/en-US/docs/Web/API/Window/queryLocalFonts
export async function loadSystemFonts(): Promise<boolean> {
  if (!isSystemFontAccessSupported()) return false;
  systemStatus = "loading";
  notify();
  try {
    const fonts = await window.queryLocalFonts!();
    indexSystemFonts(fonts);
    systemStatus = "ready";
    try {
      window.localStorage.setItem(SYSTEM_ENABLED_KEY, "1");
    } catch {
    }
    notify();
    return true;
  } catch {
    systemStatus = "denied";
    notify();
    return false;
  }
}

async function restoreSystemFonts(): Promise<void> {
  if (!isSystemFontAccessSupported()) return;
  try {
    if (window.localStorage.getItem(SYSTEM_ENABLED_KEY) !== "1") return;
  } catch {
    return;
  }
  try {
    const status = await navigator.permissions.query({
      name: "local-fonts" as PermissionName,
    });
    if (status.state !== "granted") return;
  } catch {
    return;
  }
  await loadSystemFonts();
}

const registeredSystemFamilies = new Set<string>();

function dedupeFaces(faces: SystemFace[]): SystemFace[] {
  const byKey = new Map<string, SystemFace>();
  for (const face of faces) {
    const key = `${face.weight}:${face.italic ? "i" : "n"}`;
    const existing = byKey.get(key);
    if (!existing || face.style.length < existing.style.length) byKey.set(key, face);
  }
  return [...byKey.values()];
}

async function ensureSystemFamily(family: string): Promise<void> {
  if (registeredSystemFamilies.has(family)) return;
  const faces = systemFamilies.get(family);
  if (!faces || faces.length === 0) return;
  registeredSystemFamilies.add(family);
  const results = await Promise.allSettled(
    dedupeFaces(faces).map(async (face) => {
      const buffer = await (await face.data.blob()).arrayBuffer();
      const fontFace = new FontFace(family, buffer, {
        weight: String(face.weight),
        style: face.italic ? "italic" : "normal",
      });
      await fontFace.load();
      document.fonts.add(fontFace);
    }),
  );
  if (results.every((r) => r.status === "rejected")) {
    registeredSystemFamilies.delete(family);
  }
}

const DB_NAME = "mcut-fonts";
const DB_STORE = "uploaded";

function openFontDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) {
        request.result.createObjectStore(DB_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
  });
}

async function dbPutFont(record: UploadedRecord): Promise<void> {
  const db = await openFontDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("font save failed"));
  });
  db.close();
}

const uploadedRowsSchema = z.array(z.unknown()).catch([]);

function parseUploadedRecords(rows: unknown): UploadedRecord[] {
  return uploadedRowsSchema.parse(rows).flatMap((row) => {
    const record = uploadedRecordSchema.safeParse(row);
    return record.success ? [record.data] : [];
  });
}

async function dbListFonts(): Promise<UploadedRecord[]> {
  const db = await openFontDb();
  const records = await new Promise<UploadedRecord[]>((resolve, reject) => {
    const request = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).getAll();
    request.onsuccess = () => resolve(parseUploadedRecords(request.result));
    request.onerror = () => reject(request.error ?? new Error("font load failed"));
  });
  db.close();
  return records;
}

export async function removeUploadedFontFamily(family: string): Promise<void> {
  const removed = uploadedRecords.filter((r) => r.family === family);
  if (removed.length === 0) return;
  for (let i = uploadedRecords.length - 1; i >= 0; i--) {
    if (uploadedRecords[i]!.family === family) uploadedRecords.splice(i, 1);
  }
  notify();
  try {
    const db = await openFontDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      for (const record of removed) tx.objectStore(DB_STORE).delete(record.id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("font delete failed"));
    });
    db.close();
  } catch {
  }
}

// OpenType sfnt version tags, the TrueType Collection header, and table tags. https://learn.microsoft.com/en-us/typography/opentype/spec/otff
const SFNT_TAG = {
  ttcCollection: 0x74746366,
  trueTypeOutlines: 0x00010000,
  cffOutlines: 0x4f54544f,
  appleTrueType: 0x74727565,
  nameTable: 0x6e616d65,
};
// OpenType name table name ids and platform ids. https://learn.microsoft.com/en-us/typography/opentype/spec/name
const NAME_ID = { family: 1, subfamily: 2, typographicFamily: 16, typographicSubfamily: 17 };
const PLATFORM_ID = { unicode: 0, macintosh: 1, windows: 3 };

function parseFontNames(buffer: ArrayBuffer): { family?: string; subfamily?: string } {
  try {
    const view = new DataView(buffer);
    let base = 0;
    if (view.getUint32(0) === SFNT_TAG.ttcCollection) base = view.getUint32(12);
    const tag = view.getUint32(base);
    if (
      tag !== SFNT_TAG.trueTypeOutlines &&
      tag !== SFNT_TAG.cffOutlines &&
      tag !== SFNT_TAG.appleTrueType
    ) {
      return {};
    }
    const numTables = view.getUint16(base + 4);
    let nameTable = -1;
    for (let i = 0; i < numTables; i++) {
      const record = base + 12 + i * 16;
      if (view.getUint32(record) === SFNT_TAG.nameTable) {
        nameTable = view.getUint32(record + 8);
        break;
      }
    }
    if (nameTable < 0) return {};
    const count = view.getUint16(nameTable + 2);
    const stringsStart = nameTable + view.getUint16(nameTable + 4);
    const wantedNameIds = new Set(Object.values(NAME_ID));
    const names = new Map<number, string>();
    for (let i = 0; i < count; i++) {
      const record = nameTable + 6 + i * 12;
      const platformId = view.getUint16(record);
      const nameId = view.getUint16(record + 6);
      const length = view.getUint16(record + 8);
      const offset = stringsStart + view.getUint16(record + 10);
      if (!wantedNameIds.has(nameId)) continue;
      let value = "";
      if (platformId === PLATFORM_ID.windows || platformId === PLATFORM_ID.unicode) {
        for (let j = 0; j + 1 < length; j += 2) value += String.fromCharCode(view.getUint16(offset + j));
      } else if (platformId === PLATFORM_ID.macintosh) {
        for (let j = 0; j < length; j++) value += String.fromCharCode(view.getUint8(offset + j));
      } else {
        continue;
      }
      const windowsEntryWins = platformId === PLATFORM_ID.windows || !names.has(nameId);
      if (value && windowsEntryWins) names.set(nameId, value);
    }
    return {
      family: names.get(NAME_ID.typographicFamily) ?? names.get(NAME_ID.family),
      subfamily: names.get(NAME_ID.typographicSubfamily) ?? names.get(NAME_ID.subfamily),
    };
  } catch {
    return {};
  }
}

function familyFromFilename(filename: string): { family: string; subfamily: string } {
  const stem = filename.replace(/\.(ttf|otf|woff2?|ttc)$/i, "").replace(/[-_]+/g, " ");
  const styleWords =
    /\b(thin|extra ?light|ultra ?light|light|regular|normal|book|medium|semi ?bold|demi ?bold|bold|extra ?bold|ultra ?bold|black|heavy|italic|oblique)\b/gi;
  const styles = stem.match(styleWords) ?? [];
  const family = stem.replace(styleWords, "").replace(/\s+/g, " ").trim();
  return { family: family || stem.trim() || "Uploaded font", subfamily: styles.join(" ") || "Regular" };
}

async function registerUploadedRecord(record: UploadedRecord): Promise<void> {
  const fontFace = new FontFace(record.family, record.data, {
    weight: String(record.weight),
    style: record.italic ? "italic" : "normal",
  });
  await fontFace.load();
  document.fonts.add(fontFace);
}

export async function uploadFontFiles(files: Iterable<File>): Promise<{ added: string[]; failed: string[] }> {
  const added: string[] = [];
  const failed: string[] = [];
  for (const file of files) {
    try {
      const data = await file.arrayBuffer();
      const parsed = parseFontNames(data);
      const fallback = familyFromFilename(file.name);
      const family = parsed.family ?? fallback.family;
      const subfamily = parsed.subfamily ?? fallback.subfamily;
      const record: UploadedRecord = {
        id: `font-${family}-${subfamily}`.toLowerCase().replace(/\s+/g, "-"),
        family,
        weight: weightFromStyleName(subfamily),
        italic: isItalicStyleName(subfamily),
        data,
      };
      await registerUploadedRecord(record);
      const existing = uploadedRecords.findIndex((r) => r.id === record.id);
      if (existing >= 0) uploadedRecords.splice(existing, 1);
      uploadedRecords.push(record);
      added.push(family);
      try {
        await dbPutFont(record);
      } catch {
      }
    } catch {
      failed.push(file.name);
    }
  }
  if (added.length > 0) notify();
  return { added, failed };
}

const GENERIC_FAMILY_NAMES = new Set([
  ...GENERIC_FONTS.map((f) => f.family),
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
]);

export async function ensureFontLoaded(family: string, weight = 400, italic = false): Promise<void> {
  if (typeof document === "undefined") return;
  const name = family.trim();
  if (GENERIC_FAMILY_NAMES.has(name) || name.includes(",")) return;
  try {
    const google = GOOGLE_FONTS.find((e) => e.family === name);
    if (google) {
      await ensureGoogleFont(google, weight, italic);
      return;
    }
    if (systemFamilies.has(name)) {
      await ensureSystemFamily(name);
    }
    await document.fonts.load(fontLoadSpec(name, weight, italic));
  } catch {
  }
}

interface FontSpec {
  family: string;
  weight: number;
  italic: boolean;
}

export function collectProjectFontSpecs(project: Project): FontSpec[] {
  const specs = new Map<string, FontSpec>();
  for (const track of project.tracks) {
    for (const element of track.elements) {
      if (element.type !== "text" && element.type !== "caption") continue;
      const style = element.style;
      const italic = "fontStyle" in style && style.fontStyle === "italic";
      const key = `${style.fontFamily}|${style.fontWeight}|${italic ? "i" : "n"}`;
      if (!specs.has(key)) {
        specs.set(key, { family: style.fontFamily, weight: style.fontWeight, italic });
      }
    }
  }
  return [...specs.values()];
}

export async function ensureProjectFontsLoaded(project: Project): Promise<void> {
  await Promise.allSettled(
    collectProjectFontSpecs(project).map((spec) => ensureFontLoaded(spec.family, spec.weight, spec.italic)),
  );
}

async function googleExportFaces(entry: GoogleFontEntry, specs: FontSpec[]): Promise<ExportFontFaceInit[]> {
  let css = "";
  try {
    const response = await fetch(googleCss2Url(entry));
    if (response.ok) css = await response.text();
  } catch {
    return [];
  }
  const min = entry.weights[0] ?? 400;
  const max = entry.weights[entry.weights.length - 1] ?? 400;
  const wantedWeights = new Set(
    specs.map((spec) =>
      entry.variable
        ? Math.round(Math.min(max, Math.max(min, spec.weight)))
        : closestWeight(entry.weights, spec.weight),
    ),
  );
  const wantItalic = new Set(specs.map((spec) => spec.italic && (entry.italic ?? false)));
  return parseGoogleFontCss(css)
    .filter((face) => {
      const italicFace = face.style?.includes("italic") ?? false;
      if (!wantItalic.has(italicFace)) return false;
      return [...wantedWeights].some((weight) => weightDescriptorMatches(face.weight, weight));
    })
    .map((face) => ({
      family: entry.family,
      ...(face.weight ? { weight: face.weight } : {}),
      ...(face.style ? { style: face.style } : {}),
      ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}),
      source: face.url,
    }));
}

export async function collectProjectFontExports(project: Project): Promise<ExportFontFaceInit[]> {
  const byFamily = new Map<string, FontSpec[]>();
  for (const spec of collectProjectFontSpecs(project)) {
    const name = spec.family.trim();
    if (GENERIC_FAMILY_NAMES.has(name) || name.includes(",")) continue;
    byFamily.set(name, [...(byFamily.get(name) ?? []), spec]);
  }

  const out: ExportFontFaceInit[] = [];
  for (const [family, specs] of byFamily) {
    const google = GOOGLE_FONTS.find((e) => e.family === family);
    if (google) {
      out.push(...(await googleExportFaces(google, specs)));
      continue;
    }
    const uploaded = uploadedRecords.filter((r) => r.family === family);
    if (uploaded.length > 0) {
      for (const record of uploaded) {
        out.push({
          family,
          weight: String(record.weight),
          style: record.italic ? "italic" : "normal",
          source: record.data.slice(0),
        });
      }
      continue;
    }
    const faces = systemFamilies.get(family);
    if (!faces || faces.length === 0) continue;
    const chosen = new Map<string, SystemFace>();
    for (const spec of specs) {
      const styled = faces.filter((f) => f.italic === spec.italic);
      const pool = styled.length > 0 ? styled : faces;
      const weight = closestWeight([...new Set(pool.map((f) => f.weight))], spec.weight);
      const face = dedupeFaces(pool.filter((f) => f.weight === weight))[0];
      if (face) chosen.set(face.postscriptName, face);
    }
    for (const face of chosen.values()) {
      try {
        out.push({
          family,
          weight: String(face.weight),
          style: face.italic ? "italic" : "normal",
          source: await (await face.data.blob()).arrayBuffer(),
        });
      } catch {
      }
    }
  }
  return out;
}

let initPromise: Promise<void> | null = null;

export function initFontLibrary(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  initPromise ??= (async () => {
    try {
      const records = await dbListFonts();
      const results = await Promise.allSettled(records.map(registerUploadedRecord));
      uploadedRecords.push(...records.filter((_, i) => results[i]!.status === "fulfilled"));
      if (records.length > 0) notify();
    } catch {
    }
    await restoreSystemFonts();
  })();
  return initPromise;
}

export function useFontLibrary(): FontLibraryState {
  return useSyncExternalStore(subscribeFontLibrary, getFontLibraryState, getFontLibraryServerState);
}

function projectFontKey(project: Project): string {
  return collectProjectFontSpecs(project)
    .map((spec) => `${spec.family}|${spec.weight}|${spec.italic ? "i" : "n"}`)
    .sort()
    .join(",");
}

export function useProjectFontLoader(): void {
  const engine = useEditor();
  useEngineSync(
    engine.store,
    (state) => projectFontKey(state.project),
    () => {
      void initFontLibrary().then(() => ensureProjectFontsLoaded(engine.project));
    },
  );
}
