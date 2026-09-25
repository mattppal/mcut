export function mixVoice(dry: Float32Array, wet: Float32Array, amount: number): Float32Array<ArrayBuffer> {
  if (dry.length !== wet.length) throw new RangeError(`dry has ${dry.length} samples and wet has ${wet.length}`)
  return Float32Array.from(dry, (sample, index) => sample * (1 - amount) + (wet[index] ?? 0) * amount)
}
