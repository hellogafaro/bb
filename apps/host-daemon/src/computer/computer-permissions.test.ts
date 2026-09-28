import { describe, expect, it } from "vitest";
import { parseComputerPermissionStatus } from "./computer-permissions.js";

describe("parseComputerPermissionStatus", () => {
  it("reads boolean and string grants under any key spelling", () => {
    expect(
      parseComputerPermissionStatus('{"accessibility":true,"screen_recording":"denied"}'),
    ).toEqual({ accessibility: "granted", screenRecording: "denied" });
    expect(
      parseComputerPermissionStatus('{"permissions":{"Accessibility":{"status":"granted"},"screenRecording":{"granted":false}}}'),
    ).toEqual({ accessibility: "granted", screenRecording: "denied" });
  });

  it("reports unknown for unparsable or absent data", () => {
    expect(parseComputerPermissionStatus("not json")).toEqual({
      accessibility: "unknown",
      screenRecording: "unknown",
    });
    expect(parseComputerPermissionStatus('{"accessibility":"unknown"}')).toEqual({
      accessibility: "unknown",
      screenRecording: "unknown",
    });
  });
});
