import { getBbDesktopInfo } from "@/lib/bb-desktop";
import { isInsideNativeShell } from "@/lib/native-shell";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";

export interface McpAuthWindow {
  open: (url: string) => void;
  close: () => void;
}

function reserveBrowserWindow(): Window | null {
  if (typeof window === "undefined") return null;
  if (getBbDesktopInfo() !== null || isInsideNativeShell()) return null;
  return window.open("about:blank", "_blank") ?? null;
}

export function reserveMcpAuthWindow(): McpAuthWindow {
  const reserved = reserveBrowserWindow();
  return {
    open: (url) => {
      if (reserved !== null && !reserved.closed) {
        reserved.location.href = url;
        return;
      }
      openUrlInExternalBrowser(url);
    },
    close: () => reserved?.close(),
  };
}
