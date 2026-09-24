import type { ComponentType } from "react";
import type { SvgProps } from "react-native-svg";
import RiAddLine from "react-native-remix-icon/src/icons/AddLine";
import RiAlertLine from "react-native-remix-icon/src/icons/AlertLine";
import RiArrowRightLine from "react-native-remix-icon/src/icons/ArrowRightLine";
import RiArrowRightSLine from "react-native-remix-icon/src/icons/ArrowRightSLine";
import RiCheckLine from "react-native-remix-icon/src/icons/CheckLine";
import RiCheckboxCircleLine from "react-native-remix-icon/src/icons/CheckboxCircleLine";
import RiCloseCircleLine from "react-native-remix-icon/src/icons/CloseCircleLine";
import RiCloudLine from "react-native-remix-icon/src/icons/CloudLine";
import RiDeleteBinLine from "react-native-remix-icon/src/icons/DeleteBinLine";
import RiEyeLine from "react-native-remix-icon/src/icons/EyeLine";
import RiFlashlightLine from "react-native-remix-icon/src/icons/FlashlightLine";
import RiGlobalLine from "react-native-remix-icon/src/icons/GlobalLine";
import RiInformationLine from "react-native-remix-icon/src/icons/InformationLine";
import RiLayoutGridLine from "react-native-remix-icon/src/icons/LayoutGridLine";
import RiLoader4Line from "react-native-remix-icon/src/icons/Loader4Line";
import RiLockLine from "react-native-remix-icon/src/icons/LockLine";
import RiLoopRightLine from "react-native-remix-icon/src/icons/LoopRightLine";
import RiMacbookLine from "react-native-remix-icon/src/icons/MacbookLine";
import RiPaletteLine from "react-native-remix-icon/src/icons/PaletteLine";
import RiResetLeftLine from "react-native-remix-icon/src/icons/ResetLeftLine";
import RiSettings3Line from "react-native-remix-icon/src/icons/Settings3Line";
import RiSmartphoneLine from "react-native-remix-icon/src/icons/SmartphoneLine";
import type { IconName } from "./icon-names";

export const ICON_MAP = {
  AlertTriangle: RiAlertLine,
  ArrowRight: RiArrowRightLine,
  ArrowReloadHorizontal: RiLoopRightLine,
  Check: RiCheckLine,
  ChevronRight: RiArrowRightSLine,
  CircleCheck: RiCheckboxCircleLine,
  CircleX: RiCloseCircleLine,
  Cloud: RiCloudLine,
  Eye: RiEyeLine,
  Globe: RiGlobalLine,
  GridView: RiLayoutGridLine,
  Info: RiInformationLine,
  Laptop: RiMacbookLine,
  Loading: RiLoader4Line,
  Lock: RiLockLine,
  Palette: RiPaletteLine,
  Plus: RiAddLine,
  RotateCcw: RiResetLeftLine,
  Settings: RiSettings3Line,
  Smartphone: RiSmartphoneLine,
  Trash2: RiDeleteBinLine,
  Zap: RiFlashlightLine,
} as const satisfies Record<IconName, ComponentType<SvgProps>>;
