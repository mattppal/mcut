import { z } from 'zod'
import { silenceCutOptionsSchema } from '@mcut/editor'
import { elementIdSchema } from '@mcut/timeline'
import { captionsCommandOptionsSchema, transcriptInputSchema } from '@mcut/transcription'

const transcriptInput = transcriptInputSchema.describe('Transcript JSON with word timings in source-media milliseconds, the same shape `mcut captions` reads.')

export const applyCaptionsInputSchema = captionsCommandOptionsSchema.extend({
  transcript: transcriptInput,
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
