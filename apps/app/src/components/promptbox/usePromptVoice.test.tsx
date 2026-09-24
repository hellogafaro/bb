// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { transcribeVoiceInput } from "@/lib/api";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import type { PromptBoxHandle } from "./PromptBoxInternal";
import { usePromptVoice } from "./usePromptVoice";

vi.mock("@/lib/api", () => ({
  transcribeVoiceInput: vi.fn(),
}));

vi.mock("@/hooks/useVoiceInput", () => ({
  useVoiceInput: vi.fn(),
}));

const voiceInput = {
  state: "transcribing" as const,
  isSupported: true,
  unsupportedReason: null,
  stream: null,
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
};

function createPromptBoxRef(playVoiceCompletionTransition: () => Promise<void>) {
  return {
    current: {
      captureHeightForLayoutChange: vi.fn(),
      focusEnd: vi.fn(),
      insertTextAtCursor: vi.fn(),
      playVoiceCompletionTransition: vi.fn(playVoiceCompletionTransition),
    } satisfies PromptBoxHandle,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("usePromptVoice", () => {
  it("resolves the transcript without waiting for the completion transition", async () => {
    vi.mocked(useVoiceInput).mockReturnValue({
      ...voiceInput,
      isRecording: false,
      isProcessing: true,
      isListening: false,
    });
    vi.mocked(transcribeVoiceInput).mockResolvedValue({ text: "Transcript" });
    const promptBoxRef = createPromptBoxRef(() => new Promise(() => {}));

    renderHook(() => usePromptVoice(promptBoxRef));
    const options = vi.mocked(useVoiceInput).mock.calls[0]?.[0];
    const transcription = options?.onTranscribe({
      file: new File([], "recording.webm", { type: "audio/webm" }),
    });

    await act(async () => {
      await expect(transcription).resolves.toBe("Transcript");
    });
    expect(
      promptBoxRef.current.playVoiceCompletionTransition,
    ).toHaveBeenCalledOnce();
  });

  it("reports an abort instead of animating when the request was cancelled", async () => {
    vi.mocked(useVoiceInput).mockReturnValue({
      ...voiceInput,
      isRecording: false,
      isProcessing: true,
      isListening: false,
    });
    vi.mocked(transcribeVoiceInput).mockResolvedValue({ text: "Transcript" });
    const promptBoxRef = createPromptBoxRef(() => Promise.resolve());
    const abortController = new AbortController();
    abortController.abort();

    renderHook(() => usePromptVoice(promptBoxRef));
    const options = vi.mocked(useVoiceInput).mock.calls[0]?.[0];
    const transcription = options?.onTranscribe({
      file: new File([], "recording.webm", { type: "audio/webm" }),
      signal: abortController.signal,
    });

    await expect(transcription).rejects.toMatchObject({ name: "AbortError" });
    expect(
      promptBoxRef.current.playVoiceCompletionTransition,
    ).not.toHaveBeenCalled();
  });
});
