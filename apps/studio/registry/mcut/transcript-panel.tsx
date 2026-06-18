"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  LinkIcon,
  PlusIcon,
  ScissorsIcon,
  SearchIcon,
  SparklesIcon,
  XIcon,
} from "@/lib/hugeicons";
import { toast } from "sonner";
import { extractAudioToWav } from "@mcut/media";
import { useEditor, usePlayback, useProject, useSelectedElement } from "@mcut/react";
import {
  isElementActiveAt,
  type CaptionElement,
  type ElementAudioSource,
  type Project,
  resolveElementAudioSource,
} from "@mcut/timeline";
import {
  buildApplyCaptionsCommand,
  mapCaptionWords,
  mergeCaptions,
  replaceAllMatches,
  replaceMatch,
  retypeWord,
  searchCaptions,
  splitCaptionAtWord,
  type TranscriptMatch,
  type TranscriptResult,
} from "@mcut/transcription";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmptyState, PanelHeader, PanelSectionLabel, Spinner } from "./editor-primitives";
import { formatTimecode } from "./format";
import {
  addTranscriptKeyword,
  consumePendingTranscriptFind,
  removeTranscriptKeyword,
  TRANSCRIPT_FIND_EVENT,
  useTranscriptKeywords,
} from "./transcript-keywords";

export interface TranscriptPanelProps {
  className?: string;
  /** Same handler as the captions panel — used by "Re-transcribe clip". */
  transcribe?: (audio: Blob) => Promise<TranscriptResult>;
}

function captionsOf(project: Project): CaptionElement[] {
  return project.tracks
    .flatMap((track) => track.elements)
    .filter((e): e is CaptionElement => e.type === "caption")
    .sort((a, b) => a.startMs - b.startMs);
}

/** Word indices of a caption covered by any of the given matches. */
function matchedWordIndices(captionId: string, matches: TranscriptMatch[]): Set<number> {
  const indices = new Set<number>();
  for (const match of matches) {
    if (match.captionId !== captionId) continue;
    if (match.firstWord === undefined || match.lastWord === undefined) continue;
    for (let i = match.firstWord; i <= match.lastWord; i++) indices.add(i);
  }
  return indices;
}

interface WordSelection {
  captionId: string;
  wordIndex: number;
}

/**
 * Transcript tooling over word-timed captions: fast find (⌘F), persisted
 * keyword highlights (soft ticks on the timeline ruler), replace with word
 * timings preserved, and repair — retype a word, split/merge captions,
 * re-transcribe one clip. Works identically for AssemblyAI- and
 * Whisper-produced transcripts.
 */
export function TranscriptPanel({ className, transcribe }: TranscriptPanelProps) {
  const engine = useEditor();
  const project = useProject();
  const captions = useMemo(() => captionsOf(project), [project]);

  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedWord, setSelectedWord] = useState<WordSelection | null>(null);
  const [keywordDraft, setKeywordDraft] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  const keywords = useTranscriptKeywords(project.id);
  const trimmedQuery = query.trim();
  const matches = useMemo(() => searchCaptions(captions, trimmedQuery), [captions, trimmedQuery]);
  const keywordMatches = useMemo(
    () => keywords.flatMap((keyword) => searchCaptions(captions, keyword)),
    [captions, keywords],
  );
  const active = matches.length > 0 ? matches[Math.min(activeIndex, matches.length - 1)]! : null;

  // ⌘F lands here: focus (and select) the search box, also right after the
  // shell switched tabs and this panel just mounted.
  useEffect(() => {
    const focus = () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    if (consumePendingTranscriptFind()) focus();
    window.addEventListener(TRANSCRIPT_FIND_EVENT, focus);
    return () => window.removeEventListener(TRANSCRIPT_FIND_EVENT, focus);
  }, []);

  // First Enter after typing lands on the current hit; subsequent ones advance.
  const navigatedRef = useRef(false);
  const goTo = (index: number) => {
    if (matches.length === 0) return;
    const wrapped = ((index % matches.length) + matches.length) % matches.length;
    navigatedRef.current = true;
    setActiveIndex(wrapped);
    engine.seek(matches[wrapped]!.timeMs);
  };
  const step = (direction: 1 | -1) => {
    goTo(navigatedRef.current ? activeIndex + direction : activeIndex);
  };

  const replaceCurrent = () => {
    if (!active) return;
    const caption = captions.find((c) => c.id === active.captionId);
    if (!caption) return;
    const patch = replaceMatch(caption, active, replacement);
    try {
      engine.dispatch({
        type: "updateElement",
        elementId: patch.captionId,
        patch: { text: patch.text, words: patch.words ?? [] },
      });
    } catch {
      return;
    }
    // The hit list reflows; keep the cursor at the same ordinal.
    setActiveIndex((i) => i);
  };

  const replaceEverywhere = () => {
    const patches = replaceAllMatches(captions, trimmedQuery, replacement);
    if (patches.length === 0) return;
    engine.transact(() => {
      for (const patch of patches) {
        try {
          engine.dispatch({
            type: "updateElement",
            elementId: patch.captionId,
            patch: { text: patch.text, words: patch.words ?? [] },
          });
        } catch {
          // Caption vanished mid-apply.
        }
      }
    });
    toast.success(`Replaced ${matches.length} ${matches.length === 1 ? "match" : "matches"}`);
  };

  const retranscribe = useRetranscribe(transcribe);

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <PanelHeader>
        <PanelSectionLabel>Transcript</PanelSectionLabel>
      </PanelHeader>

      <div className="flex shrink-0 flex-col gap-2 px-3 pb-2">
        {/* Find */}
        <div className="flex items-center gap-1">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={query}
              placeholder="Find in transcript…"
              className="h-7 pl-7 text-xs"
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
                navigatedRef.current = false;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  step(event.shiftKey ? -1 : 1);
                }
                if (event.key === "Escape") event.currentTarget.blur();
              }}
            />
          </div>
          <span className="w-12 text-center font-mono text-2xs text-muted-foreground">
            {trimmedQuery ? `${matches.length === 0 ? 0 : Math.min(activeIndex, matches.length - 1) + 1}/${matches.length}` : ""}
          </span>
          <Button variant="ghost" size="icon-xs" title="Previous match (⇧↵)" disabled={matches.length === 0} onClick={() => step(-1)}>
            <ChevronUpIcon />
          </Button>
          <Button variant="ghost" size="icon-xs" title="Next match (↵)" disabled={matches.length === 0} onClick={() => step(1)}>
            <ChevronDownIcon />
          </Button>
        </div>

        {/* Replace */}
        {trimmedQuery && (
          <div className="flex items-center gap-1">
            <Input
              value={replacement}
              placeholder="Replace with…"
              className="h-7 flex-1 text-xs"
              onChange={(event) => setReplacement(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  replaceCurrent();
                }
              }}
            />
            <Button variant="outline" size="xs" disabled={!active} onClick={replaceCurrent}>
              Replace
            </Button>
            <Button variant="outline" size="xs" disabled={matches.length === 0} onClick={replaceEverywhere}>
              All
            </Button>
          </div>
        )}

        {/* Keywords */}
        <div className="flex flex-col gap-1">
          <PanelSectionLabel>Keywords</PanelSectionLabel>
          <div className="flex flex-wrap items-center gap-1">
            {keywords.map((keyword) => (
              <button
                key={keyword}
                type="button"
                title={`${countOf(captions, keyword)} occurrences · click to remove`}
                className="flex items-center gap-1 rounded-full bg-(--clip-caption)/15 px-2 py-0.5 text-2xs text-(--clip-caption) hover:bg-(--clip-caption)/25"
                onClick={() => removeTranscriptKeyword(project.id, keyword)}
              >
                {keyword}
                <span className="font-mono opacity-70">{countOf(captions, keyword)}</span>
                <XIcon className="size-2.5" />
              </button>
            ))}
            <form
              className="flex items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                if (keywordDraft.trim()) {
                  addTranscriptKeyword(project.id, keywordDraft);
                  setKeywordDraft("");
                }
              }}
            >
              <Input
                value={keywordDraft}
                placeholder="Add keyword"
                className="h-6 w-28 text-2xs"
                onChange={(event) => setKeywordDraft(event.target.value)}
              />
              <Button type="submit" variant="ghost" size="icon-xs" title="Add keyword (marks occurrences on the timeline ruler)">
                <PlusIcon />
              </Button>
            </form>
          </div>
        </div>

        {/* Repair: re-transcribe the selected clip */}
        {transcribe && (
          <Button
            variant="outline"
            size="xs"
            disabled={retranscribe.isPending || !retranscribe.eligible}
            title={
              retranscribe.eligible
                ? "Re-run transcription on the selected clip's time range only"
                : "Select a video, audio, or multicam clip first"
            }
            onClick={() => retranscribe.mutate()}
          >
            {retranscribe.isPending ? <Spinner /> : <SparklesIcon />}
            {retranscribe.isPending ? "Re-transcribing…" : "Re-transcribe selected clip"}
          </Button>
        )}
      </div>

      {captions.length === 0 ? (
        <EmptyState
          className="mx-3 mb-3 flex-1"
          icon={SearchIcon}
          description="No transcript yet. Auto-caption a clip in the Captions tab first."
        />
      ) : (
        <ScrollArea className="min-h-0 flex-1 scroll-mask-b">
          <div className="flex flex-col gap-0.5 px-3 pb-3">
            {captions.map((caption, index) => (
              <TranscriptRow
                key={caption.id}
                caption={caption}
                previous={index > 0 ? captions[index - 1]! : null}
                activeMatch={active?.captionId === caption.id ? active : null}
                queryMatches={matches}
                keywordMatches={keywordMatches}
                selectedWord={selectedWord?.captionId === caption.id ? selectedWord : null}
                onSelectWord={setSelectedWord}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

/** Occurrence count for a keyword chip. */
function countOf(captions: CaptionElement[], keyword: string): number {
  return searchCaptions(captions, keyword).length;
}

// ---------------------------------------------------------------------------

function useRetranscribe(transcribe: TranscriptPanelProps["transcribe"]) {
  const engine = useEditor();
  const selected = useSelectedElement();
  const source = selected ? resolveElementAudioSource(engine.project, selected.element.id) : null;
  const mutation = useMutation({
    mutationFn: async () => {
      if (!transcribe || !source) throw new Error("Select a video, audio, or multicam clip first.");
      const wav = await extractAudioToWav(source.asset.src);
      if (!wav) throw new Error(`"${source.asset.name ?? source.asset.id}" has no audio track.`);
      const result = await transcribe(wav);
      return { result, source };
    },
    onSuccess: ({ result, source }: { result: TranscriptResult; source: ElementAudioSource }) => {
      const start = source.timelineStartMs;
      const end = source.timelineStartMs + source.timelineDurationMs;
      engine.transact(() => {
        // Only this clip's range is re-done: captions overlapping it go,
        // everything else stays.
        for (const caption of captionsOf(engine.project)) {
          if (caption.startMs < end && caption.startMs + caption.durationMs > start) {
            try {
              engine.dispatch({ type: "removeElement", elementId: caption.id });
            } catch {
              // Already gone.
            }
          }
        }
        engine.dispatch(
          buildApplyCaptionsCommand(result, {
            replace: false,
            timeOffsetMs: source.timelineStartMs,
            sourceStartMs: source.sourceStartMs,
            sourceEndMs: source.sourceEndMs,
          }),
        );
      });
      toast.success("Clip re-transcribed");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Transcription failed");
    },
  });
  return { ...mutation, eligible: !!source && !!transcribe };
}

// ---------------------------------------------------------------------------

function TranscriptRow({
  caption,
  previous,
  activeMatch,
  queryMatches,
  keywordMatches,
  selectedWord,
  onSelectWord,
}: {
  caption: CaptionElement;
  previous: CaptionElement | null;
  activeMatch: TranscriptMatch | null;
  queryMatches: TranscriptMatch[];
  keywordMatches: TranscriptMatch[];
  selectedWord: WordSelection | null;
  onSelectWord: (selection: WordSelection | null) => void;
}) {
  const engine = useEditor();
  const playbackActive = usePlayback((s) => isElementActiveAt(caption, s.currentTimeMs));
  const mapped = useMemo(() => mapCaptionWords(caption), [caption]);
  const queryWords = useMemo(
    () => matchedWordIndices(caption.id, queryMatches),
    [caption.id, queryMatches],
  );
  const keywordWords = useMemo(
    () => matchedWordIndices(caption.id, keywordMatches),
    [caption.id, keywordMatches],
  );
  const activeWords = useMemo(
    () => (activeMatch ? matchedWordIndices(caption.id, [activeMatch]) : new Set<number>()),
    [caption.id, activeMatch],
  );
  const [editing, setEditing] = useState<number | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (activeMatch) rowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeMatch]);

  const dispatchContent = (patch: { text: string; words?: { text: string; startMs: number; endMs: number }[] }) => {
    try {
      engine.dispatch({
        type: "updateElement",
        elementId: caption.id,
        patch: { text: patch.text, words: patch.words ?? [] },
      });
    } catch {
      // Invalid intermediate state.
    }
  };

  const splitAt = (wordIndex: number) => {
    const result = splitCaptionAtWord(caption, wordIndex);
    if (!result) return;
    const location = engine.project.tracks.find((t) => t.elements.some((e) => e.id === caption.id));
    if (!location) return;
    engine.transact(() => {
      engine.dispatch({
        type: "updateElement",
        elementId: caption.id,
        patch: { text: result.left.text, words: result.left.words, durationMs: result.left.durationMs },
      });
      engine.dispatch({
        type: "addElement",
        trackId: location.id,
        element: { type: "caption", style: caption.style, ...result.right },
      });
    });
    onSelectWord(null);
  };

  const mergeUp = () => {
    if (!previous) return;
    const merged = mergeCaptions(previous, caption);
    engine.transact(() => {
      engine.dispatch({ type: "removeElement", elementId: caption.id });
      engine.dispatch({
        type: "updateElement",
        elementId: previous.id,
        patch: {
          text: merged.text,
          words: merged.words ?? [],
          startMs: merged.startMs,
          durationMs: merged.durationMs,
        },
      });
    });
    onSelectWord(null);
  };

  return (
    <div
      ref={rowRef}
      className={cn(
        "group rounded-lg p-2 transition-colors hover:bg-muted/60",
        playbackActive && "bg-primary/10",
        activeMatch && "ring-1 ring-primary/40",
      )}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="cursor-pointer font-mono text-2xs text-muted-foreground hover:text-foreground"
          title="Seek to caption"
          onClick={() => engine.seek(caption.startMs)}
        >
          {formatTimecode(caption.startMs)}
        </button>
        <div className="flex-1" />
        {previous && (
          <Button
            variant="ghost"
            size="icon-xs"
            title="Merge with previous caption"
            className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
            onClick={mergeUp}
          >
            <LinkIcon />
          </Button>
        )}
      </div>

      {mapped ? (
        <p className="flex flex-wrap gap-x-1 gap-y-0.5 p-1 text-xs leading-5">
          {mapped.map((m, i) => {
            if (editing === i) {
              return (
                <WordEditor
                  key={`${i}-edit`}
                  initial={m.word.text}
                  onCommit={(value) => {
                    setEditing(null);
                    if (value && value !== m.word.text) {
                      const patch = retypeWord(caption, i, value);
                      if (patch) dispatchContent(patch);
                    }
                  }}
                  onCancel={() => setEditing(null)}
                />
              );
            }
            const isSelected = selectedWord?.wordIndex === i;
            return (
              <span key={i} className="relative">
                <button
                  type="button"
                  title="Click to seek · double-click to retype"
                  className={cn(
                    "cursor-pointer rounded px-0.5 hover:bg-muted",
                    keywordWords.has(i) && "bg-(--clip-caption)/20 text-(--clip-caption)",
                    queryWords.has(i) && "bg-primary/15",
                    activeWords.has(i) && "bg-primary/30",
                    isSelected && "ring-1 ring-primary",
                  )}
                  onClick={() => {
                    engine.seek(caption.startMs + m.word.startMs);
                    onSelectWord(isSelected ? null : { captionId: caption.id, wordIndex: i });
                  }}
                  onDoubleClick={() => {
                    onSelectWord(null);
                    setEditing(i);
                  }}
                >
                  {m.word.text}
                </button>
                {isSelected && i > 0 && (
                  <span className="absolute -top-6 left-0 z-10 flex gap-0.5 rounded-md border bg-popover p-0.5 shadow-sm">
                    <Button variant="ghost" size="icon-xs" title="Split caption before this word" onClick={() => splitAt(i)}>
                      <ScissorsIcon />
                    </Button>
                  </span>
                )}
              </span>
            );
          })}
        </p>
      ) : (
        // Word timings were invalidated (manual edit) — caption-level only.
        <p
          className="cursor-pointer p-1 text-xs leading-5 text-muted-foreground"
          title="No word timings (edited caption) — click to seek"
          onClick={() => engine.seek(caption.startMs)}
        >
          {caption.text}
        </p>
      )}
    </div>
  );
}

function WordEditor({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <input
      autoFocus
      value={value}
      size={Math.max(3, value.length)}
      className="rounded border border-primary bg-input/50 px-0.5 text-xs outline-none"
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => onCommit(value.trim())}
      onKeyDown={(event) => {
        if (event.key === "Enter") onCommit(value.trim());
        if (event.key === "Escape") onCancel();
      }}
    />
  );
}
