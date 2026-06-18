"use client";

// Multicam: source roles, audio pick, sync nudges, waveform autosync, and the angle cut style.

import { useState } from "react";
import { useEditor } from "@mcut/react";
import { listTransitionTypes, type TimelineElement } from "@mcut/timeline";
import { findSyncOffsetMs } from "@mcut/media";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "./editor-primitives";
import { NumberField, Section } from "./inspector-fields";

export function MulticamSection({ element }: { element: TimelineElement & { type: "multicam" } }) {
  const engine = useEditor();
  const [syncing, setSyncing] = useState(false);
  const dispatch = (command: Record<string, unknown> & { type: string }) => {
    try {
      engine.dispatch(command);
    } catch (error) {
      // "Nothing happened" reads as a bug — say why the edit was refused.
      toast.error(error instanceof Error ? error.message : "Edit failed");
    }
  };

  /**
   * Waveform autosync: correlate every source's loudness envelope against
   * the first source and rewrite trims so the room audio lines up. The sync
   * nudge fields stay for the last word.
   */
  const autoSync = async () => {
    if (element.sources.length < 2 || syncing) return;
    setSyncing(true);
    try {
      const assets = engine.project.assets;
      const reference = element.sources[0]!;
      const referenceAsset = assets[reference.assetId];
      if (!referenceAsset) throw new Error("Reference media is missing");
      const trims = new Map<string, number>([[reference.key, reference.trimStartMs]]);
      let lowConfidence = false;
      for (const source of element.sources.slice(1)) {
        const asset = assets[source.assetId];
        if (!asset) continue;
        const result = await findSyncOffsetMs(referenceAsset.src, asset.src);
        if (!result) throw new Error(`"${source.key}" has no audio track to sync with`);
        if (result.confidence < 1.3) lowConfidence = true;
        // offsetMs = how much this source started AFTER the reference; its
        // trim compensates in the opposite direction.
        trims.set(source.key, reference.trimStartMs - result.offsetMs);
      }
      // Negative trims mean a source has no content yet at multicam start:
      // shift every trim up equally (relative sync is what matters).
      const lift = Math.max(0, -Math.min(...trims.values()));
      engine.transact(() => {
        for (const [sourceKey, trimStartMs] of trims) {
          dispatch({
            type: "setMulticamSourceTrim",
            elementId: element.id,
            sourceKey,
            trimStartMs: Math.round(trimStartMs + lift),
          });
        }
      });
      toast[lowConfidence ? "warning" : "success"](
        lowConfidence
          ? "Synced, but the waveforms barely matched — check it and nudge manually if needed"
          : "Sources synced by waveform",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Auto-sync failed");
    } finally {
      setSyncing(false);
    }
  };

  // Roles a source can take: every key the project's layout slots reference,
  // plus whatever the sources currently hold.
  const roleOptions = Array.from(
    new Set([
      ...engine.project.layouts.flatMap((layout) => layout.slots.map((slot) => slot.source)),
      ...element.sources.map((source) => source.key),
    ]),
  );

  return (
    <Section title="Multicam">
      {element.sources.map((source, i) => {
        const asset = engine.project.assets[source.assetId];
        const label = asset?.name ?? `Clip ${i + 1}`;
        return (
          <div key={source.key} className="flex items-center gap-2">
            <span className="w-16 shrink-0 truncate text-xs text-muted-foreground" title={label}>
              {label}
            </span>
            <Select
              value={source.key}
              onValueChange={(key) =>
                key &&
                key !== source.key &&
                dispatch({
                  type: "setMulticamSourceKey",
                  elementId: element.id,
                  sourceKey: source.key,
                  newKey: key,
                })
              }
            >
              <SelectTrigger size="sm" className="w-full flex-1 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((role) => (
                  <SelectItem key={role} value={role} className="text-xs capitalize">
                    {role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}
      <p className="text-2xs text-muted-foreground">
        Roles decide which layout slot shows each clip — picking a taken role swaps the two.
      </p>
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-xs text-muted-foreground">Audio</span>
        <Select
          value={element.audioSource ?? "none"}
          onValueChange={(key) =>
            dispatch({
              type: "setMulticamAudio",
              elementId: element.id,
              sourceKey: !key || key === "none" ? null : key,
            })
          }
        >
          <SelectTrigger size="sm" className="w-full flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none" className="text-xs">
              Muted
            </SelectItem>
            {element.sources.map((source) => (
              <SelectItem key={source.key} value={source.key} className="text-xs capitalize">
                {source.key}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {element.sources.map((source) => (
        <NumberField
          key={source.key}
          label={`${source.key} sync`}
          value={source.trimStartMs / 1000}
          step={0.05}
          min={0}
          unit="s"
          onCommit={(seconds) =>
            dispatch({
              type: "setMulticamSourceTrim",
              elementId: element.id,
              sourceKey: source.key,
              trimStartMs: Math.round(seconds * 1000),
            })
          }
        />
      ))}
      {element.sources.length >= 2 && (
        <Button variant="outline" size="xs" disabled={syncing} onClick={() => void autoSync()}>
          {syncing && <Spinner />}
          {syncing ? "Listening…" : "Auto-sync by audio"}
        </Button>
      )}
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-xs text-muted-foreground">Cut style</span>
        <Select
          value={element.angleTransition?.type ?? "cut"}
          onValueChange={(type) =>
            dispatch({
              type: "setMulticamAngleTransition",
              elementId: element.id,
              transition:
                !type || type === "cut"
                  ? null
                  : { type, durationMs: element.angleTransition?.durationMs ?? 500 },
            })
          }
        >
          <SelectTrigger size="sm" className="w-full flex-1 text-xs">
            <SelectValue className="capitalize">
              {element.angleTransition ? element.angleTransition.type.replace("-", " ") : "Jump cut"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cut" className="text-xs">
              Jump cut
            </SelectItem>
            {listTransitionTypes().map((type) => (
              <SelectItem key={type} value={type} className="text-xs capitalize">
                {type.replace("-", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {element.angleTransition && (
        <NumberField
          label="Blend"
          value={element.angleTransition.durationMs / 1000}
          step={0.1}
          min={0.1}
          max={5}
          unit="s"
          onCommit={(seconds) =>
            dispatch({
              type: "setMulticamAngleTransition",
              elementId: element.id,
              transition: {
                type: element.angleTransition!.type,
                durationMs: Math.round(seconds * 1000),
              },
            })
          }
        />
      )}
      <p className="text-2xs text-muted-foreground">
        {element.angles.length} cut{element.angles.length === 1 ? "" : "s"} — switch with 1–9 in
        Multicam mode (cuts while playing, corrects while paused). The cut style applies to every
        switch.
      </p>
      <Button
        variant="outline"
        size="xs"
        onClick={() => dispatch({ type: "flattenMulticam", elementId: element.id })}
      >
        Flatten to plain clips
      </Button>
    </Section>
  );
}
