import type {
  BbDesktopApi,
  BbDesktopBrowserApi,
  BbDesktopWindowState,
} from "@bb/desktop-contract";

export const MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS = "left-[88px]";
export const MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS = "pl-[108px]";

export const BROWSER_SIDEBAR_TRIGGER_INSET_CLASS = "pl-[10px]";
export const BROWSER_COLLAPSED_HEADER_RESERVE_CLASS =
  "pl-[30px] max-md:pointer-coarse:pl-[38px]";
export const MACOS_WINDOW_DRAG_CLASS =
  "select-none [app-region:drag] [-webkit-app-region:drag]";
export const MACOS_APP_REGION_NO_DRAG_CLASS =
  "[app-region:no-drag] [-webkit-app-region:no-drag]";
export const MACOS_WINDOW_NO_DRAG_CLASS = `relative z-50 ${MACOS_APP_REGION_NO_DRAG_CLASS}`;

export const CHROME_ROW_HEIGHT_CLASS = "h-(--bb-app-chrome-row-height)";
export const CHROME_ROW_CLASS = `flex ${CHROME_ROW_HEIGHT_CLASS} items-center`;

type BbDesktopInfoResult = BbDesktopApi | null;
export const DEFAULT_DESKTOP_WINDOW_STATE: BbDesktopWindowState = {
  isFullScreen: false,
};

export function getBbDesktopInfo(): BbDesktopInfoResult {
  if (typeof window === "undefined") {
    return null;
  }
  return window.bbDesktop ?? null;
}

export function shouldUseMacosDesktopChrome(
  desktopInfo: BbDesktopInfoResult,
): boolean {
  return desktopInfo?.platform === "macos";
}

export function shouldReserveMacosTrafficLights({
  desktopInfo,
  windowState,
}: {
  desktopInfo: BbDesktopInfoResult;
  windowState: BbDesktopWindowState;
}): boolean {
  return shouldUseMacosDesktopChrome(desktopInfo) && !windowState.isFullScreen;
}

export function getDesktopBrowserApi(): BbDesktopBrowserApi | null {
  return getBbDesktopInfo()?.browser ?? null;
}

export function isDesktopBrowserAvailable(): boolean {
  return getDesktopBrowserApi() !== null;
}
