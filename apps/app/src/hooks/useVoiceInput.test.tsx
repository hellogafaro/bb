// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { appToast } from "@/components/ui/app-toast";
import { useVoiceInput } from "./useVoiceInput";

vi.mock("@/components/ui/app-toast", () => ({ appToast: { error: vi.fn() } }));
vi.mock("@/lib/audio-input-device-preference", () => ({
  useAudioInputDevicePreferenceValue: () => null,
  buildAudioInputConstraints: () => ({ audio: true }),
}));

class Recorder {
  static isTypeSupported = () => true;
  static lastOptions: MediaRecorderOptions | undefined;
  mimeType = "audio/webm";
  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    Recorder.lastOptions = options;
  }
  state = "inactive";
  onstart = () => {};
  ondataavailable = (_event: { data: Blob }) => {};
  onstop = async () => {};
  start() {
    this.state = "recording";
    this.onstart();
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable({ data: new Blob(["recorded audio"]) });
    return this.onstop();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi
        .fn()
        .mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("keeps the transcription connection warm while recording", async () => {
  const keepWarm = vi.fn();
  const { result } = renderHook(() =>
    useVoiceInput({
      onTranscribe: vi.fn().mockResolvedValue("hello"),
      onTranscript: vi.fn(),
      onRecordingKeepWarm: keepWarm,
    }),
  );
  await act(() => result.current.start());
  expect(keepWarm).toHaveBeenCalledTimes(1);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000);
  });
  expect(keepWarm).toHaveBeenCalledTimes(2);

  await act(async () => {
    result.current.stop();
    await vi.advanceTimersByTimeAsync(40_000);
  });
  expect(keepWarm).toHaveBeenCalledTimes(2);
});

it("records speech-grade audio at 32 kbps in the browser's preferred container", async () => {
  const { result } = renderHook(() =>
    useVoiceInput({
      onTranscribe: vi.fn().mockResolvedValue("ok"),
      onTranscript: vi.fn(),
    }),
  );
  await act(() => result.current.start());

  expect(Recorder.lastOptions).toEqual({
    audioBitsPerSecond: 32_000,
    mimeType: "audio/webm",
  });
});

it.each([
  new Error("Upload failed"),
  new Error("Audio file exceeds 25MB limit"),
])("keeps failed audio downloadable after unmount: %s", async (error) => {
  const transcribe = vi.fn().mockRejectedValue(error);
  const transcript = vi.fn();
  const { result, unmount } = renderHook(() =>
    useVoiceInput({
      onTranscribe: transcribe,
      onTranscript: transcript,
    }),
  );
  await act(() => result.current.start());
  vi.advanceTimersByTime(1500);
  await act(async () => result.current.stop());
  expect(result.current.state).toBe("error");
  expect(transcript).not.toHaveBeenCalled();
  const options = vi.mocked(appToast.error).mock.calls[0]?.[1];
  expect(options?.duration).toBe(Infinity);
  expect(options?.action?.label).toBe("Download recording");
  unmount();
  const createObjectURL = vi.fn(() => "blob:recording");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  let downloadedName = "";
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function (this: HTMLAnchorElement) {
      downloadedName = this.download;
      expect(this.href).toBe("blob:recording");
      expect(this.isConnected).toBe(true);
    },
  );
  if (!options?.action) throw new Error("Missing download action");
  const button = render(
    <button onClick={options.action.onClick}>Download recording</button>,
  );
  fireEvent.click(button.getByRole("button"));
  expect(createObjectURL).toHaveBeenCalledWith(
    transcribe.mock.calls[0]?.[0].file,
  );
  expect(downloadedName).toBe("recording.webm");
  expect(revokeObjectURL).not.toHaveBeenCalled();
  vi.advanceTimersByTime(60_000);
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:recording");
});

it("does not offer a download after explicit cancellation", async () => {
  const { result } = renderHook(() =>
    useVoiceInput({
      onTranscribe: vi
        .fn()
        .mockRejectedValue(new DOMException("Cancelled", "AbortError")),
      onTranscript: vi.fn(),
    }),
  );
  await act(() => result.current.start());
  vi.advanceTimersByTime(1500);
  await act(async () => result.current.stop());
  expect(result.current.state).toBe("idle");
  expect(appToast.error).not.toHaveBeenCalled();
});
