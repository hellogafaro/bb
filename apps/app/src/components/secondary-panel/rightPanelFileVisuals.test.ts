import { describe, expect, it } from "vitest";
import { resolveRightPanelFileIconName } from "./rightPanelFileVisuals";

describe("resolveRightPanelFileIconName", () => {
  it("maps document, archive, media, and table files to matching icons", () => {
    expect(resolveRightPanelFileIconName("docs/Q3 report.PDF")).toBe(
      "FileText",
    );
    expect(resolveRightPanelFileIconName("docs/plan.docx")).toBe("FileText");
    expect(resolveRightPanelFileIconName("dist/bundle.zip")).toBe("Archive");
    expect(resolveRightPanelFileIconName("dist/bundle.tar.gz")).toBe("Archive");
    expect(resolveRightPanelFileIconName("img/logo.png")).toBe("Image");
    expect(resolveRightPanelFileIconName("reports/q3.xlsx")).toBe("GridView");
    expect(resolveRightPanelFileIconName("data/users.csv")).toBe("GridView");
    expect(resolveRightPanelFileIconName("media/demo.mp4")).toBe("Play");
    expect(resolveRightPanelFileIconName("media/voice.mp3")).toBe("Mic");
    expect(resolveRightPanelFileIconName("decks/roadmap.pptx")).toBe("File");
  });

  it("keeps the markdown, html, and reports rules and falls back to code", () => {
    expect(resolveRightPanelFileIconName("reports/summary.md")).toBe(
      "ChartColumn",
    );
    expect(resolveRightPanelFileIconName("reports/summary.html")).toBe(
      "ChartColumn",
    );
    expect(resolveRightPanelFileIconName("README.md")).toBe("File");
    expect(resolveRightPanelFileIconName("site/index.html")).toBe("AppWindow");
    expect(resolveRightPanelFileIconName("src/index.ts")).toBe("Code");
    expect(resolveRightPanelFileIconName("Makefile")).toBe("Code");
  });
});
