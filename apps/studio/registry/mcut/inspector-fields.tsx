"use client";

import { useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronRightIcon, Undo2Icon } from "@/lib/hugeicons";
import { useEditor } from "@mcut/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { panelSectionLabelClass } from "./editor-primitives";
import { clamp } from "./math";
import {
  ColorPicker,
  ColorPickerAlpha,
  ColorPickerEyeDropper,
  ColorPickerHue,
  ColorPickerOutput,
  ColorPickerSelection,
} from "@/components/kibo-ui/color-picker";

/**
 * The inspector's field vocabulary, shared by every editing surface (element
 * properties, multicam layout slots, project settings) so the same controls —
 * and muscle memory — apply everywhere. One row = a w-16 label + the control;
 * `Section` groups rows under a collapsible header.
 */

/** Label + control row; the layout primitive every field builds on. */
export function FieldRow({
  label,
  title,
  children,
}: {
  label: React.ReactNode;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-muted-foreground" title={title}>
        {label}
      </span>
      {children}
    </div>
  );
}

/** The ONE input look for inspector fields (and the spinner-free numeric variant). */
export const inspectorInputClass = "h-full font-mono text-xs";
const numericInputClass = cn(
  inspectorInputClass,
  "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
);

/**
 * THE inspector number input, Figma-style: drag anywhere on the field (or
 * its label) to scrub the value horizontally — one undo entry per scrub — and
 * a clean click (or Tab) drops into text editing; commit on blur/Enter.
 */
export function NumberField({
  label,
  value,
  onCommit,
  step = 1,
  min,
  max,
  unit,
  scrubPerPx,
  controls,
  className,
}: {
  /** Row label; omit for compact embeds (the input still scrubs). */
  label?: string;
  value: number;
  onCommit: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  /** Value change per pointer px while scrubbing. Default `step/2`. */
  scrubPerPx?: number;
  /** Trailing row controls (keyframe navigator). */
  controls?: React.ReactNode;
  className?: string;
}) {
  const engine = useEditor();
  const id = useId();
  const [text, setText] = useState(String(value));
  const [scrubbing, setScrubbing] = useState(false);
  const [editing, setEditing] = useState(false);
  const scrubRef = useRef<{ startX: number; base: number; moved: boolean } | null>(null);
  // Enter commits and blurs in one tick; the blur handler must not commit
  // AGAIN against the stale pre-dispatch `value` (that re-dispatch pushed a
  // no-op history entry, so the first undo afterwards appeared to do nothing).
  const skipBlurCommitRef = useRef(false);

  // Resync when the element changes underneath us (drag, undo, reselect).
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue && !scrubbing && !editing) {
    setLastValue(value);
    setText(String(value));
  }

  const commitText = () => {
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) {
      setText(String(value));
      return;
    }
    const next = clamp(parsed, min, max);
    if (next !== value) onCommit(next);
    setText(String(next));
  };

  const scrubDown = (event: ReactPointerEvent<HTMLElement>) => {
    scrubRef.current = { startX: event.clientX, base: value, moved: false };
    engine.beginTransaction();
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const scrubMove = (event: ReactPointerEvent<HTMLElement>) => {
    const scrub = scrubRef.current;
    if (!scrub) return;
    if (!scrub.moved) {
      if (Math.abs(event.clientX - scrub.startX) < 3) return;
      scrub.moved = true;
      setScrubbing(true);
    }
    const perPx = scrubPerPx ?? step / 2;
    const decimals = step < 1 ? 2 : 0;
    const raw = scrub.base + (event.clientX - scrub.startX) * perPx;
    const next = clamp(Number(raw.toFixed(decimals)), min, max);
    setText(String(next));
    onCommit(next);
  };
  /** Ends a scrub; returns true when the pointer never moved (a click). */
  const scrubUp = (event: ReactPointerEvent<HTMLElement>): boolean => {
    const scrub = scrubRef.current;
    if (!scrub) return false;
    scrubRef.current = null;
    engine.endTransaction();
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (scrub.moved) {
      setScrubbing(false);
      setLastValue(NaN); // force resync from store on next render
      return false;
    }
    return true;
  };

  // The input surface scrubs too (Figma): preventDefault holds off focus;
  // a clean click then enters edit mode, dragging never does.
  const onInputPointerDown = (event: ReactPointerEvent<HTMLInputElement>) => {
    if (editing || event.button !== 0) return;
    event.preventDefault();
    scrubDown(event);
  };
  const onInputPointerUp = (event: ReactPointerEvent<HTMLInputElement>) => {
    if (editing) return;
    const input = event.currentTarget;
    if (scrubUp(event)) {
      input.focus();
      input.select();
    }
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {label !== undefined && (
        <label
          htmlFor={id}
          className="w-16 shrink-0 cursor-ew-resize text-xs text-muted-foreground select-none hover:text-primary"
          title="Drag to adjust"
          onPointerDown={scrubDown}
          onPointerMove={scrubMove}
          onPointerUp={scrubUp}
          onPointerCancel={scrubUp}
          // Label activation forwards focus into the input after EVERY scrub
          // — and editor shortcuts (incl. ⌘Z) are suppressed while an input
          // has focus, so undo went dead until the user clicked elsewhere
          // (usually losing their selection). Cancelling the click keeps the
          // label a pure scrub handle; clicking the input still edits.
          onClick={(event) => event.preventDefault()}
        >
          {label}
        </label>
      )}
      <InputGroup className="h-7 flex-1">
        <InputGroupInput
          id={id}
          type="number"
          step={step}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setEditing(true)}
          onBlur={() => {
            setEditing(false);
            if (skipBlurCommitRef.current) {
              skipBlurCommitRef.current = false;
              return;
            }
            commitText();
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            commitText();
            // Commit-and-exit (Figma/Premiere): leaving edit mode returns
            // keyboard shortcuts to the editor right away.
            skipBlurCommitRef.current = true;
            e.currentTarget.blur();
          }}
          onPointerDown={onInputPointerDown}
          onPointerMove={(e) => !editing && scrubMove(e)}
          onPointerUp={onInputPointerUp}
          onPointerCancel={(e) => !editing && scrubUp(e)}
          className={cn(numericInputClass, !editing && "cursor-ew-resize select-none")}
        />
        {unit && (
          <InputGroupAddon align="inline-end" className="text-2xs text-muted-foreground">
            {unit}
          </InputGroupAddon>
        )}
      </InputGroup>
      {controls}
    </div>
  );
}

export function SliderField({
  label,
  value,
  onCommit,
  min = 0,
  max = 1,
  step = 0.01,
  display,
  controls,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  display?: string;
  controls?: React.ReactNode;
}) {
  return (
    <FieldRow label={label}>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onCommit(Array.isArray(v) ? (v[0] ?? value) : v)}
        className="flex-1"
      />
      <span className="w-9 shrink-0 text-right font-mono text-2xs text-muted-foreground">
        {display ?? value.toFixed(2)}
      </span>
      {controls}
    </FieldRow>
  );
}

function toCssColor([r, g, b, a]: [number, number, number, number]): string {
  if (a >= 1) {
    const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Math.round(a * 100) / 100})`;
}

export function ColorField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const engine = useEditor();
  const [text, setText] = useState(value);
  const [editing, setEditing] = useState(false);
  // Resync the hex input when the element changes underneath us (undo, presets).
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue && !editing) {
    setLastValue(value);
    setText(value);
  }

  // One undo entry per picker gesture: the picker commits on every pointer
  // move, which used to record a history entry per tick — undo then crawled
  // back through dozens of intermediate colors instead of reverting the drag.
  const beginPickerGesture = () => {
    engine.beginTransaction();
    const end = () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      engine.endTransaction();
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  return (
    <FieldRow label={label}>
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label={`${label} color`}
              className="size-7 shrink-0 rounded-md ring-1 ring-foreground/15"
              style={{ backgroundColor: value }}
            />
          }
        />
        <PopoverContent
          className="w-64 p-3"
          side="left"
          onPointerDownCapture={beginPickerGesture}
        >
          <ColorPicker
            className="flex flex-col gap-3"
            defaultValue={value}
            onChange={(rgba) => onCommit(toCssColor(rgba as [number, number, number, number]))}
          >
            <ColorPickerSelection className="h-28" />
            <div className="flex items-center gap-3">
              <ColorPickerEyeDropper />
              <div className="grid w-full gap-1.5">
                <ColorPickerHue />
                <ColorPickerAlpha />
              </div>
            </div>
            <ColorPickerOutput />
          </ColorPicker>
        </PopoverContent>
      </Popover>
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          // Commit once on exit, not per keystroke (each keystroke was a
          // history entry — and invalid intermediate colors like "#f").
          if (text !== value) onCommit(text);
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="h-7 flex-1 font-mono text-xs"
      />
    </FieldRow>
  );
}

export function Section({
  title,
  children,
  actions,
  onReset,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  /** Header affordances (preset menu, …); shown on hover like reset. */
  actions?: React.ReactNode;
  onReset?: () => void;
  defaultOpen?: boolean;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="group/section">
      <div className="flex items-center">
        <CollapsibleTrigger
          render={
            <button
              type="button"
              className={cn(
                "flex flex-1 items-center gap-1 py-1 hover:text-foreground",
                panelSectionLabelClass,
              )}
            />
          }
        >
          <ChevronRightIcon className="size-3 transition-transform group-data-open/section:rotate-90" />
          {title}
        </CollapsibleTrigger>
        {actions}
        {onReset && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-5 opacity-0 group-hover/section:opacity-100"
            title={`Reset ${title.toLowerCase()}`}
            onClick={onReset}
          >
            <Undo2Icon />
          </Button>
        )}
      </div>
      <CollapsibleContent className="flex flex-col gap-1.5 pt-1 pb-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ChoiceRow<T extends string>({
  label,
  value,
  options,
  onCommit,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onCommit: (value: T) => void;
}) {
  return (
    <FieldRow label={label}>
      <div className="flex flex-1 gap-1">
        {options.map((option) => (
          <Button
            key={option}
            size="xs"
            variant={option === value ? "secondary" : "ghost"}
            className={cn("flex-1 capitalize", option === value && "font-semibold")}
            onClick={() => onCommit(option)}
          >
            {option}
          </Button>
        ))}
      </div>
    </FieldRow>
  );
}
