export function mustFind<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`)
  return value
}
