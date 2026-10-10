declare module '*.onnx' {
  const bytes: Uint8Array<ArrayBuffer>
  export default bytes
}
