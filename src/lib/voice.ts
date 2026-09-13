import { platform, PlatformUnavailableError } from "@/platform";
import type { VoiceModelDownloadProgress, VoiceModelStatus } from "@/platform/types";

export type { VoiceModelDownloadProgress, VoiceModelStatus };

export const VOICE_MODEL_SIZE_MB = 465;

// Every entry point checks the flag rather than the object, so a call from a
// place that forgot to hide its button fails with a clear message instead
// of a null access.
function voice() {
  if (!platform.voice) {
    throw new PlatformUnavailableError();
  }

  return platform.voice;
}

export function getVoiceModelStatus(): Promise<VoiceModelStatus> {
  return voice().getModelStatus();
}

export function downloadVoiceModel(): Promise<void> {
  return voice().downloadModel();
}

export function startVoiceRecording(): Promise<void> {
  return voice().startRecording();
}

export function stopVoiceRecording(language: string | null): Promise<string> {
  return voice().stopRecording(language);
}

export function cancelVoiceRecording(): Promise<void> {
  return voice().cancelRecording();
}

export function listenToVoiceModelDownloadProgress(
  handler: (progress: VoiceModelDownloadProgress) => void
): Promise<() => void> {
  return voice().onModelDownloadProgress(handler);
}

// Fires ~every 80 ms while a recording runs; payload is the RMS loudness of
// the latest microphone chunk (0 = silence, speech typically 0.02–0.2).
export function listenToVoiceLevel(handler: (rms: number) => void): Promise<() => void> {
  return voice().onLevel(handler);
}

// Whisper takes ISO-639-1 codes; the app locales are already exactly that
// ("de", "ja", …), so the UI language doubles as the dictation-language hint.
export function whisperLanguageFromLocale(locale: string | undefined): string | null {
  const language = locale?.split("-")[0]?.toLowerCase() ?? "";
  return /^[a-z]{2}$/.test(language) ? language : null;
}
