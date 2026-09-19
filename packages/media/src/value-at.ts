export function valueAt<T>(list: ArrayLike<T>, index: number): T {
  const value = list[index]
  if (value === undefined) {
    throw new RangeError(`Index ${index} is out of range for a list of length ${list.length}`)
  }
  return value
}
