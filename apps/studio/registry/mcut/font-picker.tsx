"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ensureFontLoaded,
  ensureFontPreview,
  isSystemFontAccessSupported,
  loadSystemFonts,
  pushRecentFont,
  uploadFontFiles,
  useFontLibrary,
  type FontCategory,
  type FontOption,
} from "./font-library";

/**
 * The font family picker (Figma/Canva-style): search, category filters,
 * recents on top, then uploaded → system → library groups — every row
 * rendered in its own typeface. System fonts arrive via the Local Font
 * Access API behind an explicit button (Chromium desktop); font-file upload
 * is the everywhere fallback.
 */

const CATEGORY_FILTERS: Array<{ key: FontCategory; label: string }> = [
  { key: "display", label: "Display" },
  { key: "sans-serif", label: "Sans" },
  { key: "serif", label: "Serif" },
  { key: "handwriting", label: "Script" },
  { key: "monospace", label: "Mono" },
];

const SOURCE_GROUPS: Array<{ source: FontOption["source"]; heading: string }> = [
  { source: "uploaded", heading: "Uploaded" },
  { source: "system", heading: "This computer" },
  { source: "google", heading: "Library" },
  { source: "generic", heading: "Defaults" },
];

function fontFamilyCss(family: string): string {
  return /[,"']/.test(family) ? family : `"${family}", sans-serif`;
}

function FontRow({
  option,
  selected,
  onPick,
}: {
  option: FontOption;
  selected: boolean;
  onPick: (family: string) => void;
}) {
  // Lazy per-family preview subset so the row shows its real face.
  useEffect(() => ensureFontPreview(option.family), [option.family]);
  return (
    <CommandItem
      value={option.family}
      keywords={[option.category]}
      className={cn("text-sm", selected && "bg-accent/60")}
      onSelect={() => onPick(option.family)}
    >
      <span className="truncate" style={{ fontFamily: fontFamilyCss(option.family) }}>
        {option.family}
      </span>
      {option.hasItalic && (
        <span className="ml-auto pl-2 text-2xs text-muted-foreground italic">i</span>
      )}
    </CommandItem>
  );
}

export function FontPicker({
  value,
  weight = 400,
  italic = false,
  onSelect,
  className,
}: {
  /** Current font family. */
  value: string;
  /** Current weight/style — preloaded for the picked family so the canvas updates without a fallback flash. */
  weight?: number;
  italic?: boolean;
  onSelect: (family: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FontCategory | null>(null);
  const library = useFontLibrary();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const pick = (family: string) => {
    setOpen(false);
    pushRecentFont(family);
    void ensureFontLoaded(family, weight, italic);
    onSelect(family);
  };

  const byFamily = new Map(library.options.map((o) => [o.family, o]));
  const recents = library.recents
    .map((family) => byFamily.get(family))
    .filter((o): o is FontOption => o !== undefined && (category === null || o.category === category));
  const groups = SOURCE_GROUPS.map(({ source, heading }) => ({
    heading,
    options: library.options.filter(
      (o) =>
        o.source === source &&
        // System families have no reliable category metadata; only the
        // library/default groups narrow under a category filter.
        (category === null || o.source === "system" || o.source === "uploaded" || o.category === category),
    ),
  })).filter((group) => group.options.length > 0);

  const onUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const { added, failed } = await uploadFontFiles(files);
    if (added.length > 0) toast.success(`Added ${[...new Set(added)].join(", ")}`);
    if (failed.length > 0) toast.error(`Could not read ${failed.join(", ")}`);
  };

  const onLoadSystemFonts = async () => {
    const ok = await loadSystemFonts();
    if (ok) toast.success("System fonts added to the picker");
    else toast.error("Font access was denied — check the site permission and try again");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex h-7 w-full min-w-0 items-center rounded-md border border-input bg-transparent px-2 text-left text-xs hover:bg-accent/40",
              className,
            )}
            title="Change font"
          />
        }
      >
        <span className="truncate" style={{ fontFamily: fontFamilyCss(value) }}>
          {value}
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" side="left" align="start">
        <Command>
          <CommandInput placeholder="Search fonts…" />
          <div className="flex gap-1 px-2 pt-1.5">
            {CATEGORY_FILTERS.map(({ key, label }) => (
              <Button
                key={key}
                size="xs"
                variant={category === key ? "secondary" : "ghost"}
                className="h-5 flex-1 px-1 text-2xs"
                onClick={() => setCategory(category === key ? null : key)}
              >
                {label}
              </Button>
            ))}
          </div>
          <CommandList className="max-h-72">
            <CommandEmpty>No fonts match.</CommandEmpty>
            {recents.length > 0 && (
              <CommandGroup heading="Recent">
                {recents.map((option) => (
                  <FontRow
                    key={`recent-${option.family}`}
                    option={option}
                    selected={option.family === value}
                    onPick={pick}
                  />
                ))}
              </CommandGroup>
            )}
            {groups.map((group) => (
              <CommandGroup key={group.heading} heading={group.heading}>
                {group.options.map((option) => (
                  <FontRow
                    key={option.family}
                    option={option}
                    selected={option.family === value}
                    onPick={pick}
                  />
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          <div className="flex items-center gap-1.5 border-t border-border/60 p-1.5">
            {isSystemFontAccessSupported() && library.systemStatus !== "ready" && (
              <Button
                size="xs"
                variant="outline"
                className="flex-1"
                disabled={library.systemStatus === "loading"}
                onClick={() => void onLoadSystemFonts()}
              >
                {library.systemStatus === "loading" ? "Loading…" : "Use system fonts"}
              </Button>
            )}
            <Button
              size="xs"
              variant="outline"
              className="flex-1"
              onClick={() => fileInputRef.current?.click()}
            >
              Upload font…
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".ttf,.otf,.woff,.woff2,.ttc,font/*"
              className="hidden"
              onChange={(event) => {
                void onUpload(event.target.files);
                event.target.value = "";
              }}
            />
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
