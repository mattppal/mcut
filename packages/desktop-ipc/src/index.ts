export { DESKTOP_INVOKES, DesktopError, desktopErrorSchema, desktopInfoSchema, invokeResultSchema } from './contract'
export type {
  DesktopErrorCode,
  DesktopErrorShape,
  DesktopInfo,
  DesktopInvokeChannel,
  DesktopResult,
  InvokeHandlers,
  InvokeInput,
  InvokeOutput,
} from './contract'
export { menuMessageSchema, readDesktopApi } from './api'
export type { DesktopApi, MenuAction } from './api'
