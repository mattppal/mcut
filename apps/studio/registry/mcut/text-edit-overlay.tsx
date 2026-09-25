'use client'

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useDocumentEvent, useEditor, useEditorState, usePlayback } from '@mcut/react'
import { applyRunStyle, getRunStyleAt, resolveAnimatedElement, shiftRunsForEdit, type TextElement, type TextRun, type TextRunStylePatch } from '@mcut/timeline'
import { Button } from '@/components/ui/button'
import { useEditorUI } from './editor-ui'

function keepTheEditableSelectionThroughToolbarPresses(event: ReactPointerEvent<HTMLDivElement>): void {
  event.preventDefault()
  event.stopPropagation()
}

function readEditableText(root: HTMLElement): string {
  let out = ''
  const walk = (node: Node, isRoot: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node as Text).data
      return
    }
    if (node instanceof HTMLElement) {
      if (node.tagName === 'BR') {
        out += '\n'
        return
      }
      const isBlock = !isRoot && (node.tagName === 'DIV' || node.tagName === 'P')
      if (isBlock && out.length > 0 && !out.endsWith('\n')) out += '\n'
      for (const child of node.childNodes) walk(child, false)
    }
  }
  walk(root, true)
  return out
}

function rangeTextLength(range: Range): number {
  const probe = document.createElement('div')
  probe.appendChild(range.cloneContents())
  return readEditableText(probe).length
}

function selectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  const head = document.createRange()
  head.selectNodeContents(root)
  head.setEnd(range.startContainer, range.startOffset)
  const start = rangeTextLength(head)
  return { start, end: start + rangeTextLength(range) }
}

function setSelectionOffsets(root: HTMLElement, start: number, end: number): void {
  const locate = (target: number): { node: Node; offset: number } => {
    let remaining = target
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let last: Text | null = null
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      last = node
      if (remaining <= node.data.length) return { node, offset: remaining }
      remaining -= node.data.length
    }
    return last ? { node: last, offset: last.data.length } : { node: root, offset: 0 }
  }
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  const from = locate(start)
  const to = locate(end)
  range.setStart(from.node, from.offset)
  range.setEnd(to.node, to.offset)
  selection.removeAllRanges()
  selection.addRange(range)
}

function renderSpans(root: HTMLElement, text: string, runs: readonly TextRun[]): void {
  const edges = new Set<number>([0, text.length])
  for (const run of runs) {
    if (run.start > 0 && run.start < text.length) edges.add(run.start)
    if (run.end > 0 && run.end < text.length) edges.add(run.end)
  }
  const sorted = [...edges].sort((a, b) => a - b)
  const children: Node[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!
    const b = sorted[i + 1]!
    const style = getRunStyleAt(runs, a)
    const span = document.createElement('span')
    if (style.color) span.style.color = style.color
    if (style.fontWeight !== undefined) span.style.fontWeight = String(style.fontWeight)
    if (style.fontStyle) span.style.fontStyle = style.fontStyle
    span.textContent = text.slice(a, b)
    children.push(span)
  }
  root.replaceChildren(...children)
}

function rangeHas(runs: readonly TextRun[], start: number, end: number, predicate: (style: ReturnType<typeof getRunStyleAt>) => boolean): boolean {
  if (end <= start) return predicate(getRunStyleAt(runs, start))
  for (let offset = start; offset < end;) {
    const style = getRunStyleAt(runs, offset)
    if (!predicate(style)) return false
    const run = runs.find((r) => offset >= r.start && offset < r.end)
    offset = run ? run.end : offset + 1
  }
  return true
}

interface TextSession {
  text: string
  runs: TextRun[]
}

interface ToolbarSelection {
  start: number
  end: number
  x: number
  y: number
}

export function TextEditOverlay() {
  const { editingTextId } = useEditorUI()
  const element = useEditorState((s): TextElement | null => {
    if (!editingTextId) return null
    for (const track of s.project.tracks) {
      const found = track.elements.find((e) => e.id === editingTextId)
      if (found && found.type === 'text') return found
    }
    return null
  })
  if (!element) return null
  return <TextEditor key={element.id} element={element} />
}

function TextEditor({ element }: { element: TextElement }) {
  const engine = useEditor()
  const { setEditingTextId } = useEditorUI()
  const projectWidth = useEditorState((s) => s.project.width)
  const projectHeight = useEditorState((s) => s.project.height)
  const timeMs = usePlayback((s) => Math.round(s.currentTimeMs))

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [editable, setEditable] = useState<HTMLDivElement | null>(null)
  const [initial] = useState<TextSession>(() => ({
    text: element.text,
    runs: [...(element.runs ?? [])],
  }))
  const [session, setSession] = useState(initial)
  const [selection, setSelection] = useState<ToolbarSelection | null>(null)

  const attachEditable = useCallback(
    (node: HTMLDivElement | null) => {
      setEditable(node)
      if (!node) return
      renderSpans(node, initial.text, initial.runs)
      node.focus()
      setSelectionOffsets(node, 0, initial.text.length)
    },
    [initial],
  )

  useDocumentEvent('selectionchange', () => {
    const container = containerRef.current
    if (!editable || !container) return
    const offsets = selectionOffsets(editable)
    const sel = window.getSelection()
    if (!offsets || !sel || sel.rangeCount === 0) {
      setSelection(null)
      return
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    const host = container.getBoundingClientRect()
    const anchor = rect.width > 0 || rect.height > 0 ? rect : editable.getBoundingClientRect()
    setSelection({
      ...offsets,
      x: anchor.left + anchor.width / 2 - host.left,
      y: anchor.top - host.top,
    })
  })

  const dispatchLive = (patch: Record<string, unknown>) => {
    try {
      engine.dispatch({ type: 'updateElement', elementId: element.id, patch }, { history: false })
    } catch {}
  }

  const commit = () => {
    if (session.text.trim() === '') {
      try {
        engine.dispatch({ type: 'removeElement', elementId: element.id })
      } catch {}
    }
    setEditingTextId(null)
  }

  const onInput = () => {
    if (!editable) return
    const text = readEditableText(editable)
    const runs = shiftRunsForEdit(session.runs, session.text, text)
    setSession({ text, runs })
    dispatchLive({ text, runs: runs.length > 0 ? runs : undefined })
  }

  const applyToSelection = (patch: TextRunStylePatch) => {
    if (!editable || !selection || selection.end <= selection.start) return
    const runs = applyRunStyle(session.runs, selection.start, selection.end, patch, session.text.length)
    setSession({ text: session.text, runs })
    renderSpans(editable, session.text, runs)
    setSelectionOffsets(editable, selection.start, selection.end)
    editable.focus()
    dispatchLive({ runs: runs.length > 0 ? runs : undefined })
  }

  const { runs } = session
  const baseBold = element.style.fontWeight >= 600
  const baseItalic = element.style.fontStyle === 'italic'
  const selBold = selection !== null && rangeHas(runs, selection.start, selection.end, (s) => (s.fontWeight ?? element.style.fontWeight) >= 600)
  const selItalic =
    selection !== null && rangeHas(runs, selection.start, selection.end, (s) => (s.fontStyle ?? element.style.fontStyle ?? 'normal') === 'italic')

  const cqw = (projectPx: number) => `${(projectPx / projectWidth) * 100}cqw`
  const resolved = resolveAnimatedElement(element, timeMs)
  const style = resolved.style
  const scaleX = Math.abs(resolved.transform.scaleX)
  const scaleY = Math.abs(resolved.transform.scaleY)
  const fontSize = style.fontSize * scaleY
  const boxWidth = element.box ? element.box.width * scaleX : null

  return (
    <div ref={containerRef} className="absolute inset-0 z-20 [container-type:inline-size]">
      <div className="absolute inset-0" onPointerDown={commit} />
      <div
        ref={attachEditable}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-mcut-text-editor=""
        spellCheck={false}
        className="absolute outline-2 outline-dashed outline-primary/70"
        style={{
          left: cqw(projectWidth / 2 + resolved.transform.x),
          top: cqw(projectHeight / 2 + resolved.transform.y),
          transform: `translate(-50%, -50%)${resolved.transform.rotation ? ` rotate(${resolved.transform.rotation}deg)` : ''}`,
          width: boxWidth ? cqw(boxWidth) : 'max-content',
          minWidth: cqw(fontSize),
          whiteSpace: boxWidth ? 'pre-wrap' : 'pre',
          overflowWrap: boxWidth ? 'break-word' : undefined,
          fontFamily: style.fontFamily,
          fontWeight: style.fontWeight,
          fontStyle: style.fontStyle,
          fontSize: cqw(fontSize),
          lineHeight: style.lineHeight ?? 1.25,
          letterSpacing: cqw((style.letterSpacing ?? 0) * scaleY),
          textAlign: style.align,
          textTransform: style.textTransform === 'none' ? undefined : style.textTransform,
          color: style.color,
          caretColor: style.color,
          backgroundColor: style.backgroundColor || undefined,
          padding: style.backgroundColor ? cqw(style.fontSize * 0.25 * scaleY) : undefined,
          borderRadius: style.backgroundColor ? cqw(style.fontSize * 0.15 * scaleY) : undefined,
          WebkitTextStroke: style.stroke && style.stroke.width > 0 ? `${cqw(style.stroke.width * scaleY)} ${style.stroke.color}` : undefined,
          textShadow: style.shadow
            ? `${cqw(style.shadow.offsetX * scaleY)} ${cqw(style.shadow.offsetY * scaleY)} ${cqw(style.shadow.blur * scaleY)} ${style.shadow.color}`
            : undefined,
        }}
        onInput={onInput}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') {
            event.preventDefault()
            commit()
            return
          }
          if (event.key === 'Enter' && !event.shiftKey && !event.metaKey) {
            event.preventDefault()
            document.execCommand('insertText', false, '\n')
          }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
            event.preventDefault()
            applyToSelection({ fontWeight: selBold ? (baseBold ? 400 : null) : 700 })
          }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'i') {
            event.preventDefault()
            applyToSelection({ fontStyle: selItalic ? (baseItalic ? 'normal' : null) : 'italic' })
          }
        }}
        onPointerDown={(event) => event.stopPropagation()}
      />
      {selection && selection.end > selection.start && (
        <div
          data-mcut-text-toolbar=""
          className="absolute z-30 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-md bg-overlay/85 p-0.5 backdrop-blur"
          style={{ left: selection.x, top: Math.max(28, selection.y) - 6 }}
          onPointerDown={keepTheEditableSelectionThroughToolbarPresses}
        >
          <Button
            variant={selBold ? 'secondary' : 'ghost'}
            size="icon-xs"
            title="Bold (⌘B)"
            onClick={() => applyToSelection({ fontWeight: selBold ? (baseBold ? 400 : null) : 700 })}
          >
            <span className="text-xs font-bold">B</span>
          </Button>
          <Button
            variant={selItalic ? 'secondary' : 'ghost'}
            size="icon-xs"
            title="Italic (⌘I)"
            onClick={() => applyToSelection({ fontStyle: selItalic ? (baseItalic ? 'normal' : null) : 'italic' })}
          >
            <span className="font-serif text-xs italic">I</span>
          </Button>
          <input
            type="color"
            title="Text color for the selection"
            className="size-5 cursor-pointer appearance-none rounded-sm border-0 bg-transparent p-0.5"
            value={/^#[0-9a-fA-F]{6}$/.test(getRunStyleAt(runs, selection.start).color ?? '') ? getRunStyleAt(runs, selection.start).color! : '#ffffff'}
            onChange={(event) => applyToSelection({ color: event.target.value })}
          />
        </div>
      )}
    </div>
  )
}
