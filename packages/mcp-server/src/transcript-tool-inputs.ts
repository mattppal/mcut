import { z } from 'zod'
import { silenceCutOptionsSchema } from '@mcut/editor'
import { elementIdSchema } from '@mcut/timeline'
import { captionsCommandOptionsSchema, transcriptInputSchema } from '@mcut/transcription'

const transcriptInput = transcriptInputSchema.describe('Transcript JSON with word timings in source-media milliseconds, the same shape `mcut captions` reads.')

export const applyCaptionsInputSchema = captionsCommandOptionsSchema.extend({
  transcript: transcriptInputSchema
    .describe(
      'Transcript JSON with word timings in source-media milliseconds. Omit it with elementId to reuse the transcript stored for that audio, ' +
        'which ensure_transcript, find_retakes, and an earlier apply_captions keep.',
    )
    .optional(),
  scope: z
    .enum(['source', 'clip'])
    .describe(
      'With elementId. "source" (the default) captions every piece on that track that plays the same audio. replace then clears only captions over pieces the transcript has words for, and captions over no clip. "clip" captions elementId alone.',
    )
    .optional(),
})

export const applySilenceCutsInputSchema = silenceCutOptionsSchema.extend({
  elementId: elementIdSchema.describe(
    'The clip to cut. It must play forward at 1x, with no time remap. A multicam is cut on its audio source, and one with none fails until setMulticamAudio.',
  ),
  transcript: transcriptInput,
})

export const removeRangesInputSchema = z.strictObject({
  ranges: z
    .array(z.object({ startMs: z.number().min(0), endMs: z.number().positive() }))
    .min(1)
    .max(500)
    .describe('Ranges to remove, in any order. Extra fields are ignored, so find_retakes candidates can be passed as they are.'),
  time: z
    .enum(['timeline', 'source'])
    .describe(
      '"timeline" (the default) reads ranges as timeline ms, like find_retakes candidates. "source" reads them as source-media ms of elementId\'s audio.',
    )
    .optional(),
  elementId: elementIdSchema
    .describe(
      'Only with time "source". A clip with source audio, including a multicam. Every piece on its track that plays that audio forward at 1x maps the ranges to the timeline.',
    )
    .optional(),
})

export const removeRangesDescription =
  'Remove a list of time ranges from the whole timeline as one undo step, so it needs no transact. Inside a transact it takes timeline ranges only. Every unlocked track loses the span, so video, multicam, audio, and captions stay in sync, ' +
  'and everything after each range shifts left. Ranges can come in any order and may overlap. A clip spanning a range becomes two pieces. ' +
  'Pass find_retakes candidates as they are, in timeline ms. With time "source" and elementId, ranges are source-media ms of that clip\'s audio, ' +
  'mapped through every piece on its track that plays it, so they stay valid after earlier cuts. ' +
  'Use this to cut retakes and any list of spans instead of splitElement, trimElement, and rippleDelete. ' +
  'After it, call apply_captions with elementId set to any remaining piece, replace true, and no transcript to rebuild captions from the stored transcript.'
