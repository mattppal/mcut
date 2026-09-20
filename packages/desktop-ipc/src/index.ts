export { DESKTOP_INVOKES, DesktopError, desktopErrorSchema, desktopInfoSchema, invokeResultSchema, updateStateSchema } from './contract'
export type {
  DesktopErrorCode,
  DesktopErrorShape,
  DesktopInfo,
  DesktopInvokeChannel,
  DesktopResult,
  InvokeHandlers,
  InvokeInput,
  InvokeOutput,
  UpdateState,
} from './contract'
export { menuMessageSchema, readDesktopApi } from './api'
export type { DesktopApi, MenuAction } from './api'
