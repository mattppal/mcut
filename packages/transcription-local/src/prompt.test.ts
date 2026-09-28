import { describe, expect, test } from 'bun:test'
import { promptedDecoderIds, type WhisperPromptTokenizer } from './prompt'

const SPECIAL = new Map([
  ['<|startofprev|>', 50361],
  ['<|startoftranscript|>', 50258],
  ['<|en|>', 50259],
  ['<|transcribe|>', 50359],
])

const tokenizer: WhisperPromptTokenizer = {
  encode: (text) => [...text].map((char) => char.charCodeAt(0)),
  convert_tokens_to_ids: (token) => SPECIAL.get(token),
}

const decode = (ids: readonly number[]) => String.fromCharCode(...ids)

describe('promptedDecoderIds', () => {
  test('puts the vocabulary between <|startofprev|> and the start of transcript, with language and task for a multilingual model', () => {
    const ids = promptedDecoderIds(tokenizer, ['Grokbot', ' Karen X. Cheng ', ''], 'en')
    expect(ids?.slice(0, 1)).toEqual([50361])
    expect(ids?.slice(-3)).toEqual([50258, 50259, 50359])
    expect(decode(ids?.slice(1, -3) ?? [])).toBe(' Grokbot, Karen X. Cheng.')
  })

  test('an English-only model gets no language or task token', () => {
    expect(promptedDecoderIds(tokenizer, ['mcut'], null)?.slice(-1)).toEqual([50258])
  })

  test('keeps only the last 223 prompt tokens', () => {
    const ids = promptedDecoderIds(tokenizer, ['x'.repeat(400), 'Grokbot'], null) ?? []
    expect(ids).toHaveLength(225)
    expect(decode(ids.slice(-11, -1))).toBe(', Grokbot.')
  })

  test('no vocabulary, or a language the tokenizer does not know, leaves the decoder unprompted', () => {
    expect(promptedDecoderIds(tokenizer, [' '], 'en')).toBeNull()
    expect(promptedDecoderIds(tokenizer, ['Grokbot'], 'xx')).toBeNull()
  })

  test('a language code in another case or with a region still names the language token', () => {
    expect(promptedDecoderIds(tokenizer, ['Grokbot'], 'EN-us')?.slice(-2)).toEqual([50259, 50359])
  })
})
