import type { Icon } from "phosphor-react-native";
import type { IconName } from "./icon-names";
import { ArrowCounterClockwiseIcon } from "phosphor-react-native/src/icons/ArrowCounterClockwise";
import { ArrowRightIcon } from "phosphor-react-native/src/icons/ArrowRight";
import { ArrowsClockwiseIcon } from "phosphor-react-native/src/icons/ArrowsClockwise";
import { CaretRightIcon } from "phosphor-react-native/src/icons/CaretRight";
import { CheckIcon } from "phosphor-react-native/src/icons/Check";
import { CheckCircleIcon } from "phosphor-react-native/src/icons/CheckCircle";
import { CircleNotchIcon } from "phosphor-react-native/src/icons/CircleNotch";
import { CloudIcon } from "phosphor-react-native/src/icons/Cloud";
import { DeviceMobileIcon } from "phosphor-react-native/src/icons/DeviceMobile";
import { EyeIcon } from "phosphor-react-native/src/icons/Eye";
import { GearSixIcon } from "phosphor-react-native/src/icons/GearSix";
import { GlobeIcon } from "phosphor-react-native/src/icons/Globe";
import { InfoIcon } from "phosphor-react-native/src/icons/Info";
import { LaptopIcon } from "phosphor-react-native/src/icons/Laptop";
import { LightningIcon } from "phosphor-react-native/src/icons/Lightning";
import { LockIcon } from "phosphor-react-native/src/icons/Lock";
import { PaletteIcon } from "phosphor-react-native/src/icons/Palette";
import { PlusIcon } from "phosphor-react-native/src/icons/Plus";
import { SquaresFourIcon } from "phosphor-react-native/src/icons/SquaresFour";
import { TrashIcon } from "phosphor-react-native/src/icons/Trash";
import { WarningIcon } from "phosphor-react-native/src/icons/Warning";
import { XCircleIcon } from "phosphor-react-native/src/icons/XCircle";

export const ICON_MAP = {
  AlertTriangle: WarningIcon,
  ArrowRight: ArrowRightIcon,
  ArrowReloadHorizontal: ArrowsClockwiseIcon,
  Check: CheckIcon,
  ChevronRight: CaretRightIcon,
  CircleCheck: CheckCircleIcon,
  CircleX: XCircleIcon,
  Cloud: CloudIcon,
  Eye: EyeIcon,
  Globe: GlobeIcon,
  GridView: SquaresFourIcon,
  Info: InfoIcon,
  Laptop: LaptopIcon,
  Loading: CircleNotchIcon,
  Lock: LockIcon,
  Palette: PaletteIcon,
  Plus: PlusIcon,
  RotateCcw: ArrowCounterClockwiseIcon,
  Settings: GearSixIcon,
  Smartphone: DeviceMobileIcon,
  Trash2: TrashIcon,
  Zap: LightningIcon,
} as const satisfies Record<IconName, Icon>;
