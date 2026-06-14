import { forwardRef, type SVGProps } from "react";
import { HugeiconsIcon, type HugeiconsIconProps } from "@hugeicons/react";
import {
  Add01Icon as PlusSvg,
  Alert01Icon as TriangleAlertSvg,
  AlignBottomIcon as AlignBottomSvg,
  AlignHorizontalCenterIcon as AlignCenterHorizontalSvg,
  AlignLeftIcon as AlignLeftSvg,
  AlignRightIcon as AlignRightSvg,
  AlignTopIcon as AlignTopSvg,
  AlignVerticalCenterIcon as AlignCenterVerticalSvg,
  ArrowRight01Icon as ArrowRightSvg,
  Backward01Icon as SkipBackSvg,
  BotIcon as BotSvg,
  CameraIcon as CameraSvg,
  Cancel01Icon as XSvg,
  CaptionsIcon as CaptionsSvg,
  CheckIcon as CheckSvg,
  ChevronDownIcon as ChevronDownSvg,
  ChevronFirstIcon as ChevronFirstSvg,
  ChevronLastIcon as ChevronLastSvg,
  ChevronRightIcon as ChevronRightSvg,
  ChevronUpIcon as ChevronUpSvg,
  CircleCheckIcon as CircleCheckSvg,
  ClapperboardIcon as ClapperboardSvg,
  Copy01Icon as CopySvg,
  Delete02Icon as Trash2Svg,
  Download01Icon as DownloadSvg,
  DropperIcon as PipetteSvg,
  EyeIcon as EyeSvg,
  EyeOffIcon as EyeOffSvg,
  FileVideoIcon as FileVideoSvg,
  Film01Icon as FilmSvg,
  FolderOpenIcon as FolderOpenSvg,
  GripVerticalIcon as GripVerticalSvg,
  Image01Icon as ImageSvg,
  InformationCircleIcon as InfoSvg,
  KeyboardIcon as KeyboardSvg,
  Layers01Icon as LayersSvg,
  Link01Icon as LinkSvg,
  Loading01Icon as Loader2Svg,
  // Locked/unlocked must read as one toggle: both come from the SquareLock
  // family (the round LockIcon next to SquareUnlock01 looked like two icons).
  SquareLock01Icon as LockSvg,
  MagnetIcon as MagnetSvg,
  Maximize01Icon as MaximizeSvg,
  Moon02Icon as MoonSvg,
  Sun01Icon as SunSvg,
  MusicNote01Icon as MusicSvg,
  NextIcon as StepForwardSvg,
  OctagonXIcon as OctagonXSvg,
  PackageIcon as PackageSvg,
  PauseIcon as PauseSvg,
  PlayIcon as PlaySvg,
  PreviousIcon as StepBackSvg,
  RatioIcon as RatioSvg,
  Redo02Icon as Redo2Svg,
  Resize01Icon as ScaleSvg,
  ScissorIcon as ScissorsSvg,
  Search01Icon as SearchSvg,
  SparklesIcon as SparklesSvg,
  SquareUnlock01Icon as LockOpenSvg,
  SwatchIcon as SwatchSvg,
  TextIcon as TypeSvg,
  Undo02Icon as Undo2Svg,
  Upload01Icon as UploadSvg,
  VolumeHighIcon as Volume2Svg,
  VolumeMute01Icon as VolumeXSvg,
  ZapIcon as ZapSvg,
  ZoomInAreaIcon as ZoomInSvg,
  ZoomOutAreaIcon as ZoomOutSvg,
} from "@hugeicons/core-free-icons";

type HugeIconDefinition = HugeiconsIconProps["icon"];
type IconProps = Omit<HugeiconsIconProps, "icon"> & SVGProps<SVGSVGElement>;

function createHugeIcon(name: string, icon: HugeIconDefinition) {
  const Icon = forwardRef<SVGSVGElement, IconProps>(
    ({ strokeWidth = 2, ...props }, ref) => (
      <HugeiconsIcon ref={ref} icon={icon} strokeWidth={strokeWidth} {...props} />
    ),
  );
  Icon.displayName = name;
  return Icon;
}

export const AlignBottomIcon = createHugeIcon("AlignBottomIcon", AlignBottomSvg);
export const AlignCenterHorizontalIcon = createHugeIcon("AlignCenterHorizontalIcon", AlignCenterHorizontalSvg);
export const AlignCenterVerticalIcon = createHugeIcon("AlignCenterVerticalIcon", AlignCenterVerticalSvg);
export const AlignLeftIcon = createHugeIcon("AlignLeftIcon", AlignLeftSvg);
export const AlignRightIcon = createHugeIcon("AlignRightIcon", AlignRightSvg);
export const AlignTopIcon = createHugeIcon("AlignTopIcon", AlignTopSvg);
export const ArrowRightIcon = createHugeIcon("ArrowRightIcon", ArrowRightSvg);
export const BotIcon = createHugeIcon("BotIcon", BotSvg);
export const CameraIcon = createHugeIcon("CameraIcon", CameraSvg);
export const CaptionsIcon = createHugeIcon("CaptionsIcon", CaptionsSvg);
export const CheckIcon = createHugeIcon("CheckIcon", CheckSvg);
export const ChevronDownIcon = createHugeIcon("ChevronDownIcon", ChevronDownSvg);
export const ChevronFirstIcon = createHugeIcon("ChevronFirstIcon", ChevronFirstSvg);
export const ChevronLastIcon = createHugeIcon("ChevronLastIcon", ChevronLastSvg);
export const ChevronRightIcon = createHugeIcon("ChevronRightIcon", ChevronRightSvg);
export const ChevronUpIcon = createHugeIcon("ChevronUpIcon", ChevronUpSvg);
export const CircleCheckIcon = createHugeIcon("CircleCheckIcon", CircleCheckSvg);
export const ClapperboardIcon = createHugeIcon("ClapperboardIcon", ClapperboardSvg);
export const CopyIcon = createHugeIcon("CopyIcon", CopySvg);
export const DownloadIcon = createHugeIcon("DownloadIcon", DownloadSvg);
export const EyeIcon = createHugeIcon("EyeIcon", EyeSvg);
export const EyeOffIcon = createHugeIcon("EyeOffIcon", EyeOffSvg);
export const FileVideoIcon = createHugeIcon("FileVideoIcon", FileVideoSvg);
export const FilmIcon = createHugeIcon("FilmIcon", FilmSvg);
export const FolderOpenIcon = createHugeIcon("FolderOpenIcon", FolderOpenSvg);
export const GripVerticalIcon = createHugeIcon("GripVerticalIcon", GripVerticalSvg);
export const ImageIcon = createHugeIcon("ImageIcon", ImageSvg);
export const InfoIcon = createHugeIcon("InfoIcon", InfoSvg);
export const KeyboardIcon = createHugeIcon("KeyboardIcon", KeyboardSvg);
export const LayersIcon = createHugeIcon("LayersIcon", LayersSvg);
export const LinkIcon = createHugeIcon("LinkIcon", LinkSvg);
export const Loader2Icon = createHugeIcon("Loader2Icon", Loader2Svg);
export const LockIcon = createHugeIcon("LockIcon", LockSvg);
export const LockOpenIcon = createHugeIcon("LockOpenIcon", LockOpenSvg);
export const MagnetIcon = createHugeIcon("MagnetIcon", MagnetSvg);
export const MaximizeIcon = createHugeIcon("MaximizeIcon", MaximizeSvg);
export const MoonIcon = createHugeIcon("MoonIcon", MoonSvg);
export const MusicIcon = createHugeIcon("MusicIcon", MusicSvg);
export const OctagonXIcon = createHugeIcon("OctagonXIcon", OctagonXSvg);
export const PackageIcon = createHugeIcon("PackageIcon", PackageSvg);
export const PauseIcon = createHugeIcon("PauseIcon", PauseSvg);
export const PipetteIcon = createHugeIcon("PipetteIcon", PipetteSvg);
export const PlayIcon = createHugeIcon("PlayIcon", PlaySvg);
export const PlusIcon = createHugeIcon("PlusIcon", PlusSvg);
export const RatioIcon = createHugeIcon("RatioIcon", RatioSvg);
export const Redo2Icon = createHugeIcon("Redo2Icon", Redo2Svg);
export const ScaleIcon = createHugeIcon("ScaleIcon", ScaleSvg);
export const ScissorsIcon = createHugeIcon("ScissorsIcon", ScissorsSvg);
export const SearchIcon = createHugeIcon("SearchIcon", SearchSvg);
export const SkipBackIcon = createHugeIcon("SkipBackIcon", SkipBackSvg);
export const SparklesIcon = createHugeIcon("SparklesIcon", SparklesSvg);
export const StepBackIcon = createHugeIcon("StepBackIcon", StepBackSvg);
export const SwatchIcon = createHugeIcon("SwatchIcon", SwatchSvg);
export const StepForwardIcon = createHugeIcon("StepForwardIcon", StepForwardSvg);
export const Trash2Icon = createHugeIcon("Trash2Icon", Trash2Svg);
export const TriangleAlertIcon = createHugeIcon("TriangleAlertIcon", TriangleAlertSvg);
export const TypeIcon = createHugeIcon("TypeIcon", TypeSvg);
export const SunIcon = createHugeIcon("SunIcon", SunSvg);
export const Undo2Icon = createHugeIcon("Undo2Icon", Undo2Svg);
export const UploadIcon = createHugeIcon("UploadIcon", UploadSvg);
export const Volume2Icon = createHugeIcon("Volume2Icon", Volume2Svg);
export const VolumeXIcon = createHugeIcon("VolumeXIcon", VolumeXSvg);
export const XIcon = createHugeIcon("XIcon", XSvg);
export const ZapIcon = createHugeIcon("ZapIcon", ZapSvg);
export const ZoomInIcon = createHugeIcon("ZoomInIcon", ZoomInSvg);
export const ZoomOutIcon = createHugeIcon("ZoomOutIcon", ZoomOutSvg);
