function spokenWordList(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, '')
    .split(/\s+/)
    .filter(Boolean)
}

function isOrderedSubsequence(needle: readonly string[], haystack: readonly string[]): boolean {
  if (needle.length === 0) return false
  let index = 0
  for (const word of haystack) {
    if (word === needle[index]) {
      index += 1
      if (index === needle.length) return true
    }
  }
  return false
}

export function captionTranscriptsMatch(incomingText: string, projectText: string): boolean {
  const incoming = spokenWordList(incomingText)
  const project = spokenWordList(projectText)
  return isOrderedSubsequence(project, incoming) || isOrderedSubsequence(incoming, project)
}
