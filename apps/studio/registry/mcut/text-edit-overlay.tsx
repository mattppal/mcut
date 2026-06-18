"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor, useEditorState, usePlayback } from "@mcut/react";
import {
  applyRunStyle,
  getRunStyleAt,
  resolveAnimatedElement,
  shiftRunsForEdit,
  type TextElement,
  type TextRun,
  type TextRunStylePatch,
} from "@mcut/timeline";
import { Button } from "@/components/ui/button";
import { useEditorUI } from "./editor-ui";

/**
 * Inline text editing ON the canvas (double-click a text element): a
 * contentEditable mirror of the element — same font, spacing, box, and
 * per-run styling — overlaid exactly on its frame while the compositor
 * skips drawing it (the editor IS the WYSIWYG render). A floating toolbar
 * over the selection styles ranges (bold / italic / color → rich-text
 * runs). The whole session is one engine transaction: every keystroke
 * dispatches live (history off), and closing the editor commits a single
 * undo entry.
 */

/** Editable DOM → plain text ('\n' from text nodes, <br>, and block starts). */
function readEditableText(root: HTMLElement): string {
  let out = "";
  const walk = (node: Node, isRoot: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node as Text).data;
      return;
    }
    if (node instanceof HTMLElement) {
      if (node.tagName === "BR") {
        out += "\n";
        return;
      }
      const isBlock = !isRoot && (node.tagName === "DIV" || node.tagName === "P");
      if (isBlock && out.length > 0 && !out.endsWith("\n")) out += "\n";
      for (const child of node.childNodes) walk(child, false);
    }
  };
  walk(root, true);
  return out;
}

/** Character length of a range's contents, measured like readEditableText. */
function rangeTextLength(range: Range): number {
  const probe = document.createElement("div");
  probe.appendChild(range.cloneContents());
  return readEditableText(probe).length;
}

/** Current selection as character offsets into the editable's text. */
function selectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const head = document.createRange();
  head.selectNodeContents(root);
  head.setEnd(range.startContainer, range.startOffset);
  const start = rangeTextLength(head);
  return { start, end: start + rangeTextLength(range) };
}

/** Restore a character-offset selection inside the editable. */
function setSelectionOffsets(root: HTMLElement, start: number, end: number): void {
  const locate = (target: number): { node: Node; offset: number } => {
    let remaining = target;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      last = node;
      if (remaining <= node.data.length) return { node, offset: remaining };
      remaining -= node.data.length;
    }
    return last ? { node: last, offset: last.data.length } : { node: root, offset: 0 };
  };
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  const from = locate(start);
  const to = locate(end);
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Rebuild the editable's children as run-styled spans (newlines stay in text). */
function renderSpans(root: HTMLElement, text: string, runs: readonly TextRun[]): void {
  const edges = new Set<number>([0, text.length]);
  for (const run of runs) {
    if (run.start > 0 && run.start < text.length) edges.add(run.start);
    if (run.end > 0 && run.end < text.length) edges.add(run.end);
  }
  const sorted = [...edges].sort((a, b) => a - b);
  const children: Node[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    const style = getRunStyleAt(runs, a);
    const span = document.createElement("span");
    if (style.color) span.style.color = style.color;
    if (style.fontWeight !== undefined) span.style.fontWeight = String(style.fontWeight);
    if (style.fontStyle) span.style.fontStyle = style.fontStyle;
    span.textContent = text.slice(a, b);
    children.push(span);
  }
  root.replaceChildren(...children);
}

/** True when every character in [start, end) resolves bold / italic. */
function rangeHas(
  runs: readonly TextRun[],
  start: number,
  end: number,
  predicate: (style: ReturnType<typeof getRunStyleAt>) => boolean,
): boolean {
  if (end <= start) return predicate(getRunStyleAt(runs, start));
  for (let offset = start; offset < end; ) {
    const style = getRunStyleAt(runs, offset);
    if (!predicate(style)) return false;
    const run = runs.find((r) => offset >= r.start && offset < r.end);
    offset = run ? run.end : offset + 1;
  }
  return true;
}

export function TextEditOverlay() {
  const engine = useEditor();
  const { editingTextId, setEditingTextId } = useEditorUI();
  const element = useEditorState((s) => {
    if (!editingTextId) return null;
    for (const track of s.project.tracks) {
      const found = track.elements.find((e) => e.id === editingTextId);
      if (found && found.type === "text") return found;
    }
    return null;
  }) as TextElement | null;
  const projectSize = useEditorState((s) => ({ width: s.project.width, height: s.project.height }));
  const timeMs = usePlayback((s) => Math.round(s.currentTimeMs));

  const containerRef = useRef<HTMLDivElement | null>(null);
  const editableRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0);
  // The editing session's source of truth (DOM ↔ model sync). Handlers
  // read/write the ref; `runs` mirrors into state for render (toolbar
  // active flags, color swatch) so render never touches the ref.
  const sessionRef = useRef<{ text: string; runs: TextRun[] } | null>(null);
  const [runs, setRuns] = useState<TextRun[]>([]);
  const [selection, setSelection] = useState<{
    start: number;
    end: number;
    x: number;
    y: number;
  } | null>(null);

  // Track the container's px scale (project px → screen px).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () =>
      setScale(container.clientWidth > 0 ? container.clientWidth / projectSize.width : 0);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [projectSize.width, editingTextId]);

  // Session lifecycle: one transaction per editing session; mount renders
  // the runs as spans and selects everything (Figma's double-click).
  useEffect(() => {
    if (!editingTextId) return;
    const current = engine.project;
    let original: TextElement | null = null;
    for (const track of current.tracks) {
      const found = track.elements.find((e) => e.id === editingTextId);
      if (found?.type === "text") original = found;
    }
    if (!original) return;
    sessionRef.current = { text: original.text, runs: [...(original.runs ?? [])] };
    setRuns(sessionRef.current.runs);
    engine.beginTransaction();
    const editable = editableRef.current;
    if (editable) {
      renderSpans(editable, original.text, original.runs ?? []);
      editable.focus();
      setSelectionOffsets(editable, 0, original.text.length);
    }
    return () => {
      sessionRef.current = null;
      engine.endTransaction();
    };
  }, [editingTextId, engine]);

  // Selection → toolbar position (container-relative).
  useEffect(() => {
    if (!editingTextId) return;
    const onSelectionChange = () => {
      const editable = editableRef.current;
      const container = containerRef.current;
      if (!editable || !container) return;
      const offsets = selectionOffsets(editable);
      const sel = window.getSelection();
      if (!offsets || !sel || sel.rangeCount === 0) {
        setSelection(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const host = container.getBoundingClientRect();
      const anchor = rect.width > 0 || rect.height > 0 ? rect : editable.getBoundingClientRect();
      setSelection({
        ...offsets,
        x: anchor.left + anchor.width / 2 - host.left,
        y: anchor.top - host.top,
      });
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [editingTextId]);

  if (!editingTextId || !element || scale < 0) return null;

  const dispatchLive = (patch: Record<string, unknown>) => {
    try {
      engine.dispatch(
        { type: "updateElement", elementId: element.id, patch },
        { history: false },
      );
    } catch {
      // Element vanished mid-edit.
    }
  };

  const commit = () => {
    const session = sessionRef.current;
    if (session && session.text.trim() === "") {
      // Empty text exits as a delete (the transaction collapses it all).
      try {
        engine.dispatch({ type: "removeElement", elementId: element.id });
      } catch {
        // Already gone.
      }
    }
    setEditingTextId(null); // unmount effect ends the transaction
    setSelection(null);
  };

  const onInput = () => {
    const editable = editableRef.current;
    const session = sessionRef.current;
    if (!editable || !session) return;
    const newText = readEditableText(editable);
    session.runs = shiftRunsForEdit(session.runs, session.text, newText);
    session.text = newText;
    setRuns(session.runs);
    dispatchLive({ text: newText, runs: session.runs.length > 0 ? session.runs : undefined });
  };

  const applyToSelection = (patch: TextRunStylePatch) => {
    const editable = editableRef.current;
    const session = sessionRef.current;
    if (!editable || !session || !selection || selection.end <= selection.start) return;
    session.runs = applyRunStyle(
      session.runs,
      selection.start,
      selection.end,
      patch,
      session.text.length,
    );
    setRuns(session.runs);
    renderSpans(editable, session.text, session.runs);
    setSelectionOffsets(editable, selection.start, selection.end);
    editable.focus();
    dispatchLive({ runs: session.runs.length > 0 ? session.runs : undefined });
  };

  const baseBold = element.style.fontWeight >= 600;
  const baseItalic = element.style.fontStyle === "italic";
  const selBold =
    selection !== null &&
    rangeHas(runs, selection.start, selection.end, (s) => (s.fontWeight ?? element.style.fontWeight) >= 600);
  const selItalic =
    selection !== null &&
    rangeHas(
      runs,
      selection.start,
      selection.end,
      (s) => (s.fontStyle ?? element.style.fontStyle ?? "normal") === "italic",
    );

  // WYSIWYG placement: the element's resolved frame, in container px.
  const resolved = resolveAnimatedElement(element, timeMs);
  const style = resolved.style;
  const scaleX = Math.abs(resolved.transform.scaleX) * scale;
  const scaleY = Math.abs(resolved.transform.scaleY) * scale;
  const fontPx = style.fontSize * scaleY;
  const padPx = style.backgroundColor ? style.fontSize * 0.25 * scaleY : 0;
  const centerX = (projectSize.width / 2 + resolved.transform.x) * scale;
  const centerY = (projectSize.height / 2 + resolved.transform.y) * scale;
  // Box width drives wrapping; measure-derived width keeps free text stable.
  const boxWidthPx = element.box ? element.box.width * scaleX : null;

  return (
    <div ref={containerRef} className="absolute inset-0 z-20">
      {/* Click-away backdrop: commits (Figma semantics). */}
      <div className="absolute inset-0" onPointerDown={commit} />
      <div
        ref={editableRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-mcut-text-editor=""
        spellCheck={false}
        className="absolute outline-2 outline-dashed outline-primary/70"
        style={{
          left: centerX,
          top: centerY,
          transform: `translate(-50%, -50%)${
            resolved.transform.rotation ? ` rotate(${resolved.transform.rotation}deg)` : ""
          }`,
          width: boxWidthPx ? `${boxWidthPx}px` : "max-content",
          minWidth: fontPx,
          whiteSpace: boxWidthPx ? "pre-wrap" : "pre",
          overflowWrap: boxWidthPx ? "break-word" : undefined,
          fontFamily: style.fontFamily,
          fontWeight: style.fontWeight,
          fontStyle: style.fontStyle,
          fontSize: `${fontPx}px`,
          lineHeight: style.lineHeight ?? 1.25,
          letterSpacing: `${(style.letterSpacing ?? 0) * scaleY}px`,
          textAlign: style.align,
          textTransform: style.textTransform === "none" ? undefined : style.textTransform,
          color: style.color,
          caretColor: style.color,
          backgroundColor: style.backgroundColor || undefined,
          padding: padPx ? `${padPx}px` : undefined,
          borderRadius: style.backgroundColor ? `${style.fontSize * 0.15 * scaleY}px` : undefined,
          WebkitTextStroke:
            style.stroke && style.stroke.width > 0
              ? `${style.stroke.width * scaleY}px ${style.stroke.color}`
              : undefined,
          textShadow: style.shadow
            ? `${style.shadow.offsetX * scaleY}px ${style.shadow.offsetY * scaleY}px ${
                style.shadow.blur * scaleY
              }px ${style.shadow.color}`
            : undefined,
        }}
        onInput={onInput}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            commit();
            return;
          }
          if (event.key === "Enter" && !event.shiftKey && !event.metaKey) {
            // Plain text newline (keeps the DOM to text nodes + spans).
            event.preventDefault();
            document.execCommand("insertText", false, "\n");
          }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
            event.preventDefault();
            applyToSelection({ fontWeight: selBold ? (baseBold ? 400 : null) : 700 });
          }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "i") {
            event.preventDefault();
            applyToSelection({ fontStyle: selItalic ? (baseItalic ? "normal" : null) : "italic" });
          }
        }}
        onPointerDown={(event) => event.stopPropagation()}
      />
      {selection && selection.end > selection.start && (
        <div
          data-mcut-text-toolbar=""
          className="absolute z-30 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-md bg-overlay/85 p-0.5 shadow-md backdrop-blur"
          style={{ left: selection.x, top: Math.max(28, selection.y) - 6 }}
          onPointerDown={(event) => {
            // Keep the editable's selection alive through toolbar clicks.
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <Button
            variant={selBold ? "secondary" : "ghost"}
            size="icon-xs"
            title="Bold (⌘B)"
            onClick={() => applyToSelection({ fontWeight: selBold ? (baseBold ? 400 : null) : 700 })}
          >
            <span className="text-xs font-bold">B</span>
          </Button>
          <Button
            variant={selItalic ? "secondary" : "ghost"}
            size="icon-xs"
            title="Italic (⌘I)"
            onClick={() =>
              applyToSelection({ fontStyle: selItalic ? (baseItalic ? "normal" : null) : "italic" })
            }
          >
            <span className="font-serif text-xs italic">I</span>
          </Button>
          <input
            type="color"
            title="Text color for the selection"
            className="size-5 cursor-pointer appearance-none rounded-sm border-0 bg-transparent p-0.5"
            value={
              /^#[0-9a-fA-F]{6}$/.test(getRunStyleAt(runs, selection.start).color ?? "")
                ? getRunStyleAt(runs, selection.start).color!
                : "#ffffff"
            }
            onChange={(event) => applyToSelection({ color: event.target.value })}
          />
        </div>
      )}
    </div>
  );
}
