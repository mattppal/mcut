import {
  getProjectDurationMs,
  type Project,
  type TimelineElement,
  type Track,
} from '@mcut/timeline'

/**
 * Things `parseProject` cannot reject (it validates shape, not cross-entity
 * invariants) but that make a project render wrong or export badly. Commands
 * maintain these invariants; hand-edited or generated JSON may not.
 */
export interface LintIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
}

export function lintProject(project: Project): LintIssue[] {
  const issues: LintIssue[] = []
  const error = (code: string, message: string) => issues.push({ severity: 'error', code, message })
  const warn = (code: string, message: string) => issues.push({ severity: 'warning', code, message })

  const linkCounts = new Map<string, number>()

  for (const track of project.tracks) {
    if (track.elements.length === 0) {
      warn('empty-track', `track "${track.name}" (${track.id}) has no elements`)
    }
    const sorted = [...track.elements].sort((a, b) => a.startMs - b.startMs)
    for (let i = 0; i < sorted.length; i++) {
      const element = sorted[i]!
      const next = sorted[i + 1]
      if (next && next.startMs < element.startMs + element.durationMs) {
        error(
          'overlap',
          `elements "${element.id}" and "${next.id}" overlap on track "${track.name}" ` +
            `(${element.startMs}–${element.startMs + element.durationMs}ms vs ${next.startMs}ms)`,
        )
      }
      lintElement(project, track, element, sorted, i, { error, warn })
      if (element.linkId) {
        linkCounts.set(element.linkId, (linkCounts.get(element.linkId) ?? 0) + 1)
      }
    }
  }

  for (const [linkId, count] of linkCounts) {
    if (count < 2) {
      warn('broken-link', `linkId "${linkId}" is held by a single element (its partner was removed)`)
    }
  }

  if (getProjectDurationMs(project) === 0) {
    warn('empty-project', 'project has no content (duration 0ms)')
  }

  return issues
}

interface Reporters {
  error: (code: string, message: string) => void
  warn: (code: string, message: string) => void
}

function lintElement(
  project: Project,
  track: Track,
  element: TimelineElement,
  sorted: TimelineElement[],
  index: number,
  { error, warn }: Reporters,
): void {
  if ('assetId' in element && !project.assets[element.assetId]) {
    error('missing-asset', `element "${element.id}" references missing asset "${element.assetId}"`)
  }

  if ('keyframes' in element && element.keyframes) {
    for (const [property, keyframes] of Object.entries(element.keyframes)) {
      for (const keyframe of keyframes ?? []) {
        if (keyframe.timeMs > element.durationMs) {
          warn(
            'keyframe-out-of-range',
            `element "${element.id}" has a ${property} keyframe at ${keyframe.timeMs}ms, ` +
              `beyond its ${element.durationMs}ms duration (it will never be reached)`,
          )
        }
      }
    }
  }

  if ('transition' in element && element.transition) {
    const next = sorted[index + 1]
    if (!next || next.startMs !== element.startMs + element.durationMs) {
      warn(
        'transition-without-neighbor',
        `element "${element.id}" has a transition but no exactly-adjacent next clip on ` +
          `track "${track.name}" (transitions need a butt cut)`,
      )
    }
  }

  if (element.type === 'caption' && element.text.trim() === '') {
    warn('empty-caption', `caption "${element.id}" has no text`)
  }

  if (element.type === 'multicam') {
    if (element.angles.length === 0 || element.angles[0]!.atMs !== 0) {
      error('multicam-first-angle', `multicam "${element.id}" must have an angle cut at 0ms`)
    }
    for (const angle of element.angles) {
      if (!project.layouts.some((layout) => layout.id === angle.layoutId)) {
        error(
          'missing-layout',
          `multicam "${element.id}" cuts to unknown layout "${angle.layoutId}" at ${angle.atMs}ms`,
        )
      }
      if (angle.atMs >= element.durationMs) {
        warn(
          'angle-beyond-end',
          `multicam "${element.id}" has an angle cut at ${angle.atMs}ms, at or beyond its ` +
            `${element.durationMs}ms duration`,
        )
      }
    }
    for (const source of element.sources) {
      if (!project.assets[source.assetId]) {
        error(
          'missing-asset',
          `multicam "${element.id}" source "${source.key}" references missing asset "${source.assetId}"`,
        )
      }
    }
    if (
      element.audioSource !== undefined &&
      !element.sources.some((source) => source.key === element.audioSource)
    ) {
      error(
        'missing-audio-source',
        `multicam "${element.id}" plays audio from unknown source "${element.audioSource}"`,
      )
    }
  }
}
