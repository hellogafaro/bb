import {
  Component,
  createContext,
  useContext,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { IconType } from "react-icons";
import {
  RiAlertLine,
  RiArchiveLine,
  RiArrowDownSLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiBugLine,
  RiChat3Line,
  RiListUnordered,
  RiChatNewLine,
  RiCheckLine,
  RiCheckboxBlankCircleLine,
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiCloseLine,
  RiCodeSSlashLine,
  RiCornerDownRightLine,
  RiDeleteBinLine,
  RiDownloadLine,
  RiEqualizerLine,
  RiErrorWarningLine,
  RiFileCopyLine,
  RiFilter3Line,
  RiFlashlightLine,
  RiFlowChart,
  RiFocus3Line,
  RiFolderAddLine,
  RiFolderLine,
  RiFolderOpenLine,
  RiFolderTransferLine,
  RiFolderUnknowLine,
  RiFolderUploadLine,
  RiForbidLine,
  RiGitRepositoryLine,
  RiHammerLine,
  RiInformationLine,
  RiLayoutLeft2Line,
  RiListCheck2,
  RiLoader4Line,
  RiLoader5Line,
  RiMoreLine,
  RiPencilLine,
  RiPlayListAddLine,
  RiPuzzleLine,
  RiQuestionAnswerLine,
  RiQuestionLine,
  RiRobot2Line,
  RiUserSmileLine,
  RiSearchLine,
  RiSettings3Line,
  RiTerminalBoxLine,
  RiToolsLine,
  RiUserAddLine,
} from "react-icons/ri";
import { useSyncExternalStore } from "react";
import { cn } from "../../lib/utils";
import {
  EXTENDED_ICON_NAMES,
  getAppIcon,
  getPluginAssetIcon,
  subscribeAppIcons,
  subscribePluginAssetIcons,
  type ExtendedIconName,
  getExtendedIcons,
  subscribeExtendedIcons,
} from "./icon-registry";

const CORE_ICON_MAP = {
  AlertCircle: RiErrorWarningLine,
  AlertTriangle: RiAlertLine,
  Archive: RiArchiveLine,
  Bot: RiRobot2Line,
  UserSmile: RiUserSmileLine,
  Bug: RiBugLine,
  Check: RiCheckLine,
  ChevronDown: RiArrowDownSLine,
  ChevronLeft: RiArrowLeftSLine,
  ChevronRight: RiArrowRightSLine,
  Circle: RiCheckboxBlankCircleLine,
  CircleCheck: RiCheckboxCircleLine,
  CircleQuestion: RiQuestionLine,
  CircleX: RiCloseCircleLine,
  ClosePluginPane: RiCloseLine,
  CloseThreadPane: RiCloseLine,
  Code: RiCodeSSlashLine,
  ComputerTerminal01: RiTerminalBoxLine,
  Copy: RiFileCopyLine,
  Download: RiDownloadLine,
  Edit: RiPencilLine,
  FilterHorizontal: RiFilter3Line,
  Folder: RiFolderLine,
  FolderExport: RiFolderUploadLine,
  FolderGit: RiGitRepositoryLine,
  FolderPlus: RiFolderAddLine,
  FolderSync: RiFolderTransferLine,
  FolderUnknown: RiFolderUnknowLine,
  Folder02: RiFolderOpenLine,
  Info: RiInformationLine,
  ListTodo: RiListCheck2,
  ListUnordered: RiListUnordered,
  Loading: RiLoader4Line,
  MessageQuestion: RiQuestionAnswerLine,
  MessageCirclePlus: RiChatNewLine,
  MessageSquarePlus: RiChatNewLine,
  MessageSquare: RiChat3Line,
  MoreHorizontal: RiMoreLine,
  PanelLeft: RiLayoutLeft2Line,
  Puzzle: RiPuzzleLine,
  Search: RiSearchLine,
  SectionAdd: RiPlayListAddLine,
  SectionMove: RiCornerDownRightLine,
  Settings: RiSettings3Line,
  SlidersHorizontal: RiEqualizerLine,
  Spinner: RiLoader5Line,
  Target: RiFocus3Line,
  Terminal: RiTerminalBoxLine,
  Toolbox: RiToolsLine,
  ToolCase: RiHammerLine,
  Trash2: RiDeleteBinLine,
  Unavailable: RiForbidLine,
  UserRoundPlus: RiUserAddLine,
  Workflow: RiFlowChart,
  X: RiCloseLine,
  Zap: RiFlashlightLine,
} as const satisfies Record<string, IconType>;

type CoreIconName = keyof typeof CORE_ICON_MAP;

export type BuiltinIconName = CoreIconName | ExtendedIconName;
export type IconName = string;

const CORE_ICON_NAMES = Object.keys(CORE_ICON_MAP) as readonly CoreIconName[];

export const ICON_NAMES: readonly BuiltinIconName[] = [
  ...CORE_ICON_NAMES,
  ...EXTENDED_ICON_NAMES,
];

const CORE_ICON_LOOKUP: Readonly<Record<string, IconType | undefined>> =
  CORE_ICON_MAP;

const ICON_DEFAULT_SIZE = 24;

let extendedIconsLoad: Promise<void> | null = null;

export function preloadExtendedIcons(): Promise<void> {
  if (getExtendedIcons() !== null) return Promise.resolve();
  extendedIconsLoad ??= import("./icon-extended").then(
    () => undefined,
    (error: unknown) => {
      extendedIconsLoad = null;
      throw error;
    },
  );
  return extendedIconsLoad;
}

export interface IconProps {
  name: IconName;
  fallback?: string;
  className?: string;
  style?: CSSProperties;
  "aria-hidden"?: boolean | "true" | "false";
  "aria-label"?: string;
}

const ICON_NAME_SET: ReadonlySet<string> = new Set(ICON_NAMES);
const IconAncestors = createContext<readonly string[]>([]);

export function isBuiltinIconName(name: string): name is BuiltinIconName {
  return ICON_NAME_SET.has(name);
}

class IconErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function Icon({ name, fallback = "Zap", ...props }: IconProps) {
  const ancestors = useContext(IconAncestors);
  const custom = useSyncExternalStore(
    subscribeAppIcons,
    () => getAppIcon(name),
    () => getAppIcon(name),
  );
  const fallbackCustom = useSyncExternalStore(
    subscribeAppIcons,
    () => getAppIcon(fallback),
    () => getAppIcon(fallback),
  );
  const asset = useSyncExternalStore(
    subscribePluginAssetIcons,
    () => getPluginAssetIcon(name),
    () => getPluginAssetIcon(name),
  );
  const fallbackAsset = useSyncExternalStore(
    subscribePluginAssetIcons,
    () => getPluginAssetIcon(fallback),
    () => getPluginAssetIcon(fallback),
  );
  const requestedExists =
    custom !== undefined || isBuiltinIconName(name) || asset !== undefined;
  const resolved = requestedExists ? name : fallback;
  const definition = requestedExists ? custom : fallbackCustom;
  const resolvedAsset = requestedExists ? asset : fallbackAsset;
  const CustomIcon = definition?.component;
  if (ancestors.includes(resolved)) {
    return (
      <BuiltinIcon
        name={isBuiltinIconName(resolved) ? resolved : "Zap"}
        {...props}
      />
    );
  }
  if (CustomIcon !== undefined && definition !== undefined) {
    return (
      <IconAncestors.Provider value={[...ancestors, resolved]}>
        <IconErrorBoundary
          key={definition.key}
          fallback={<BuiltinIcon name="Zap" {...props} />}
        >
          <span
            className={cn("inline-flex size-6 shrink-0", props.className)}
            style={props.style}
            aria-hidden={props["aria-hidden"]}
            aria-label={props["aria-label"]}
            role={props["aria-label"] ? "img" : undefined}
            data-icon={resolved}
            data-icon-root=""
          >
            <CustomIcon className="size-full" />
          </span>
        </IconErrorBoundary>
      </IconAncestors.Provider>
    );
  }
  if (CustomIcon === undefined && resolvedAsset !== undefined) {
    return (
      <PluginAssetIcon url={resolvedAsset} resolved={resolved} {...props} />
    );
  }
  return (
    <BuiltinIcon
      name={isBuiltinIconName(resolved) ? resolved : "Zap"}
      {...props}
    />
  );
}

function PluginAssetIcon({
  url,
  resolved,
  className,
  style,
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
}: Omit<IconProps, "name" | "fallback"> & {
  url: string;
  resolved: string;
}) {
  const image = `url("${url.replace(/["\\]/gu, "\\$&")}")`;
  return (
    <span
      className={cn("inline-block size-6 shrink-0", className)}
      style={{
        ...style,
        backgroundColor: "currentColor",
        maskImage: image,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
        WebkitMaskImage: image,
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
      }}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      data-icon={resolved}
      data-icon-root=""
      data-plugin-icon-asset={url}
    />
  );
}

function BuiltinIcon({
  name,
  className,
  style,
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
}: IconProps) {
  const CoreIcon = CORE_ICON_LOOKUP[name];
  if (CoreIcon !== undefined) {
    return (
      <CoreIcon
        size={ICON_DEFAULT_SIZE}
        className={cn(className)}
        style={style}
        aria-hidden={ariaHidden}
        aria-label={ariaLabel}
        data-icon={name}
        data-icon-root=""
      />
    );
  }
  return (
    <ExtendedIcon
      name={name}
      className={className}
      style={style}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
    />
  );
}

function ExtendedIcon({
  name,
  className,
  style,
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
}: IconProps) {
  const extendedIcons: Readonly<Record<string, IconType | undefined>> | null =
    useSyncExternalStore(
      subscribeExtendedIcons,
      getExtendedIcons,
      getExtendedIcons,
    );
  const ExtendedGlyph = extendedIcons?.[name];
  if (ExtendedGlyph === undefined) {
    void preloadExtendedIcons().catch(() => undefined);
    return (
      <svg
        viewBox="0 0 24 24"
        width={ICON_DEFAULT_SIZE}
        height={ICON_DEFAULT_SIZE}
        className={cn(className)}
        style={style}
        aria-hidden={ariaHidden}
        aria-label={ariaLabel}
        data-icon={name}
        data-icon-root=""
        data-icon-pending=""
      />
    );
  }
  return (
    <ExtendedGlyph
      size={ICON_DEFAULT_SIZE}
      className={cn(className)}
      style={style}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      data-icon={name}
      data-icon-root=""
    />
  );
}
