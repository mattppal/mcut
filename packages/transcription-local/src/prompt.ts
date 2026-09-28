export interface WhisperPromptTokenizer {
  encode(text: string, options: { add_special_tokens: boolean }): number[]
  convert_tokens_to_ids(token: string): number | undefined
}

const MAX_PROMPT_TOKENS = 223

export function promptedDecoderIds(tokenizer: WhisperPromptTokenizer, vocabulary: readonly string[], language: string | null): number[] | null {
  const terms = vocabulary.map((term) => term.trim()).filter(Boolean)
  if (terms.length === 0) return null
  const prompt = tokenizer.encode(` ${terms.join(', ')}.`, { add_special_tokens: false }).slice(-MAX_PROMPT_TOKENS)
  const special = ['<|startofprev|>', '<|startoftranscript|>', ...(language === null ? [] : [`<|${language}|>`, '<|transcribe|>'])].map((token) =>
    tokenizer.convert_tokens_to_ids(token),
  )
  const ids = special.filter((id) => id !== undefined)
  if (ids.length !== special.length) return null
  return [...ids.slice(0, 1), ...prompt, ...ids.slice(1)]
}
