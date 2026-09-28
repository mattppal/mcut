import { describe, expect, spyOn, test } from 'bun:test'
import { AssemblyAI, type TranscribeParams } from 'assemblyai'
import { createAssemblyAIProvider, normalizeAssemblyAIResult } from './index'

describe('createAssemblyAIProvider', () => {
  test('rejects with a cancellation error when the signal is already aborted', async () => {
    const provider = createAssemblyAIProvider({ apiKey: 'test' })
    const signal = AbortSignal.abort()
    await expect(provider.transcribe({ audio: new Uint8Array(4), mimeType: 'audio/wav' }, { signal })).rejects.toThrow(/cancelled/)
  })

  test('sends the vocabulary as keyterms, dropping blanks, duplicates, and phrases over six words', async () => {
    const client = new AssemblyAI({ apiKey: 'test' })
    const submitted: TranscribeParams[] = []
    spyOn(client.transcripts, 'submit').mockImplementation(async (params) => {
      submitted.push(params)
      throw new Error('stop after submit')
    })
    const provider = createAssemblyAIProvider({ client })
    const vocabulary = ['Grokbot', ' Karen X. Cheng ', 'Grokbot', '', 'one two three four five six seven']
    await expect(provider.transcribe({ audio: new Uint8Array(4) }, { vocabulary })).rejects.toThrow('stop after submit')
    expect(submitted[0]?.keyterms_prompt).toEqual(['Grokbot', 'Karen X. Cheng'])
  })
})

describe('normalizeAssemblyAIResult', () => {
  test('maps words with confidence and speakers', () => {
    const result = normalizeAssemblyAIResult({
      text: 'Hello world',
      language_code: 'en',
      audio_duration: 1.5,
      words: [
        { text: 'Hello', start: 0, end: 400, confidence: 0.99, speaker: 'A' },
        { text: 'world', start: 450, end: 900, confidence: 0.97, speaker: 'A' },
      ],
      utterances: [{ text: 'Hello world', start: 0, end: 900, speaker: 'A' }],
    })
    expect(result.words).toEqual([
      { text: 'Hello', startMs: 0, endMs: 400, confidence: 0.99, speaker: 'A' },
      { text: 'world', startMs: 450, endMs: 900, confidence: 0.97, speaker: 'A' },
    ])
    expect(result.segments).toEqual([{ text: 'Hello world', startMs: 0, endMs: 900, speaker: 'A' }])
    expect(result.language).toBe('en')
    expect(result.durationMs).toBe(1500)
  })

  test('tolerates null fields from unfinished transcripts', () => {
    const result = normalizeAssemblyAIResult({
      text: null,
      words: null,
      utterances: null,
      language_code: null,
      audio_duration: null,
    })
    expect(result).toEqual({ text: '', words: [], segments: [] })
  })

  test('omits speaker when null', () => {
    const result = normalizeAssemblyAIResult({
      text: 'Hi',
      words: [{ text: 'Hi', start: 10, end: 200, speaker: null }],
    })
    expect(result.words).toEqual([{ text: 'Hi', startMs: 10, endMs: 200 }])
  })
})
