export {
  createAssetId,
  createElementId,
  createGroupId,
  createLayoutId,
  createLinkId,
  createMarkerId,
  createPresetId,
  createProjectId,
  createTrackId,
  type AssetId,
  type ElementId,
  type GroupId,
  type MarkerId,
  type TrackId,
} from './id'

export {
  getEffectiveVolume,
  getFadeGain,
  hasFades,
  type FadeableElement,
} from './audio'

export {
  resolveElementAudioSource,
  type ElementAudioSource,
  type ElementAudioSourceType,
} from './audio-source'

export { migrateProject, ProjectFormatError, PROJECT_VERSION } from './migrations'

export {
  getElementType,
  listElementTypes,
  type ElementTypeEntry,
} from './element-registry'

export {
  createDefaultLayouts,
  getLayout,
  layoutSchema,
  layoutSlotSchema,
  type Layout,
  type LayoutSlot,
} from './layouts'

export { listPresets, propertyPresetSchema, type PropertyPreset } from './presets'

export {
  applyRunStyle,
  getRunStyleAt,
  normalizeRuns,
  shiftRunsForEdit,
  textRunSchema,
  textRunStyleSchema,
  type TextRun,
  type TextRunStyle,
  type TextRunStylePatch,
} from './rich-text'

export {
  cropSchema,
  DEFAULT_SHADOW,
  shadowSchema,
  strokeSchema,
  type Crop,
  type Shadow,
  type Stroke,
} from './style'

export {
  getActiveAngleIndex,
  getActiveLayout,
  getAngleTransitionAt,
  getMulticamAudioSource,
  getMulticamSourceTimeMs,
  splitAngles,
  type AngleCut,
  type AngleTransitionWindow,
} from './multicam'

export { getFrameRequests, type FrameRequest } from './frame-requests'

export {
  captureThumbnailTemplate,
  expandThumbnailTemplate,
  findThumbnailTrack,
  THUMBNAIL_FRAME_COUNT,
  THUMBNAIL_TEMPLATES,
  THUMBNAIL_TRACK_NAME,
  thumbnailDurationMs,
  thumbnailItemSchema,
  thumbnailTemplateSchema,
  type ThumbnailItem,
  type ThumbnailTemplate,
} from './thumbnails'

export {
  captureZoomPreset,
  expandZoomPreset,
  ZOOM_PRESETS,
  ZOOMABLE_PROPERTIES,
  zoomPresetSchema,
  type ZoomPreset,
} from './zoom-presets'

export {
  EFFECT_TYPES,
  blendModeSchema,
  buildFilterString,
  effectSchema,
  effectsSchema,
  getEffectType,
  listEffectTypes,
  registerEffectType,
  type EffectTypeConfig,
  motionBlurSchema,
  toCompositeOperation,
  type BlendMode,
  type Effect,
  type EffectType,
  type MotionBlur,
} from './effects'

export {
  BUILTIN_TRANSITION_TYPES,
  TRANSITION_TYPES,
  listTransitionTypes,
  registerTransitionType,
  getActiveTransitionPairs,
  getRenderableElements,
  getTransitionCompletion,
  getTransitionPair,
  transitionSchema,
  transitionTypeSchema,
  type RenderableElement,
  type Transition,
  type TransitionPair,
  type TransitionType,
} from './transitions'

export {
  getAverageSpeed,
  getSourceSpanMs,
  getSourceTimeMs,
  getSpeedAt,
  makeConstantSpeedMap,
  splitTimeMap,
  timeMapSchema,
  type TimeMap,
  type TimeMappedElement,
} from './speed'

export { frameToMs, msPerFrame, msToFrame, quantizeMsToFrame } from './time'

export {
  applyEdgeTrim,
  getEdgeTrimRange,
  type EdgeTrimRange,
  type TrimEdge,
} from './edge-trim'

export {
  collectSnapTargets,
  nearestSnapTarget,
  snapClip,
  snapTime,
  type CollectSnapTargetsOptions,
  type SnapClipResult,
  type SnapOptions,
  type SnapResult,
  type SnapTarget,
  type SnapTargetKind,
} from './snap'

export {
  MIN_ELEMENT_DURATION_MS,
  assetIdSchema,
  assetRefSchema,
  audioElementSchema,
  captionElementSchema,
  captionStyleSchema,
  captionWordSchema,
  createProject,
  elementIdSchema,
  elementInputSchema,
  elementSchema,
  groupIdSchema,
  imageElementSchema,
  markerIdSchema,
  markerSchema,
  multicamElementSchema,
  parseProject,
  projectSchema,
  registerTimelineElementType,
  textElementSchema,
  textBoxSchema,
  textShadowSchema,
  textStrokeSchema,
  textStyleSchema,
  trackIdSchema,
  trackSchema,
  transformSchema,
  videoElementSchema,
  type AssetKind,
  type AssetRef,
  type AudioElement,
  type AngleCutRef,
  type CaptionElement,
  type CaptionStyle,
  type CaptionWord,
  type CreateProjectOptions,
  type ElementTypeConfig,
  type ImageElement,
  type Marker,
  type MulticamElement,
  type MulticamSource,
  type Project,
  type TextElement,
  type TextBox,
  type TextShadow,
  type TextStroke,
  type TextStyle,
  type TimelineElement,
  type TimelineElementInput,
  type Track,
  type Transform,
  type VideoElement,
} from './model'

export {
  CommandError,
  applyCommand,
  getCommandDefinition,
  listCommands,
  listToolDefinitions,
  registerCommand,
  type AnyCommand,
  type CommandDefinition,
  type ToolDefinition,
} from './commands'

export {
  EditorEngine,
  type DispatchOptions,
  type EditorEngineOptions,
  type EditorState,
  type PlaybackState,
  type SelectionState,
  type TransactionOptions,
} from './engine'

export {
  canPlace,
  findNearestFreeSlot,
  getActiveElements,
  getElement,
  getElementLocation,
  getGroupedElementIds,
  getLinkedElementIds,
  getProjectDurationMs,
  getTrack,
  isElementActiveAt,
  rangesOverlap,
  type ActiveElement,
  type ElementLocation,
} from './selectors'

export {
  ANIMATABLE_PROPERTIES,
  animatableProperties,
  animatablePropertySchema,
  cubicBezierAt,
  easingSchema,
  elementSupportsProperty,
  evaluateEasing,
  getAnimatedValue,
  getKeyframes,
  getStaticValue,
  hasKeyframes,
  interpolateTrack,
  isOnKeyframe,
  keyframeSchema,
  keyframesSchema,
  resolveAnimatedElement,
  splitKeyframes,
  upsertKeyframe,
  type AnimatableProperty,
  type Easing,
  type Keyframe,
  type KeyframeMap,
} from './keyframes'

export {
  ANIMATION_PRESET_CATEGORIES,
  ANIMATION_PRESET_DEFAULT_DURATION_MS,
  EASINGS,
  MOTION_BLUR_PRESETS,
  animationPresetOptionsSchema,
  animationPresetSchema,
  expandAnimationPreset,
  type AnimationPreset,
  type AnimationPresetOptions,
} from './animation-presets'

export { CAPTION_STYLE_PRESETS, type CaptionStylePreset } from './caption-presets'

export { summarizeProject } from './summarize'

export {
  getProjectCaptions,
  getProjectMediaContext,
  getProjectTranscript,
  type ProjectCaptionRef,
  type ProjectMediaAssetContext,
  type ProjectMediaContext,
  type ProjectMediaElementContext,
  type ProjectMediaTrackContext,
  type ProjectTranscriptCaptionContext,
  type ProjectTranscriptContext,
  type ProjectTranscriptOptions,
  type ProjectTranscriptWordContext,
  type ProjectViewContextOptions,
} from './project-context'

export { toOtio, toOtioJson, type OtioExportOptions } from './otio'
