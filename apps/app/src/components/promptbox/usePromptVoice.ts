import { useCallback, useMemo, type RefObject } from "react";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { transcribeVoiceInput, warmVoiceTranscription } from "@/lib/api";
import type { PromptBoxHandle, PromptVoiceConfig } from "./PromptBoxInternal";

async function requestVoiceTranscription({
  file,
  signal,
}: {
  file: File;
  signal?: AbortSignal;
}): Promise<string> {
  const transcription = await transcribeVoiceInput(file, signal);
  return transcription.text;
}

function keepTranscriptionWarm(): void {
  void warmVoiceTranscription().catch(() => {});
}

function createVoiceAbortError(): DOMException {
  return new DOMException("Voice transcription was cancelled", "AbortError");
}

export function usePromptVoice(
  promptBoxRef: RefObject<PromptBoxHandle | null>,
): PromptVoiceConfig {
  const onTranscript = useCallback(
    (text: string) => {
      promptBoxRef.current?.insertTextAtCursor(text);
    },
    [promptBoxRef],
  );

  const transcribeThenPlayCompletionTransition = useCallback(
    async (args: Parameters<typeof requestVoiceTranscription>[0]) => {
      const text = await requestVoiceTranscription(args);
      if (args.signal?.aborted) {
        throw createVoiceAbortError();
      }
      void promptBoxRef.current?.playVoiceCompletionTransition();
      return text;
    },
    [promptBoxRef],
  );

  const voiceInput = useVoiceInput({
    onTranscript,
    onTranscribe: transcribeThenPlayCompletionTransition,
    onRecordingKeepWarm: keepTranscriptionWarm,
  });

  return useMemo<PromptVoiceConfig>(
    () => ({
      state: voiceInput.state,
      isSupported: voiceInput.isSupported,
      stream: voiceInput.stream,
      start: voiceInput.start,
      stop: voiceInput.stop,
      cancel: voiceInput.cancel,
    }),
    [
      voiceInput.state,
      voiceInput.isSupported,
      voiceInput.stream,
      voiceInput.start,
      voiceInput.stop,
      voiceInput.cancel,
    ],
  );
}
