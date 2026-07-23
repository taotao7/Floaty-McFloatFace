import { useCallback, useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { EVT } from "../lib/events";
import type { RecordingCmdPayload, RecordingUiPayload } from "../lib/events";
import { getRecordingRegion } from "../lib/tauri";
import type { RecordingRegion } from "../types/app";
import type { RecordingStatus } from "./useRecordingPipeline";

export interface RemoteApi {
  status: RecordingStatus;
  elapsed: number;
  countdown: number;
  info: string;
  region: RecordingRegion | null;
  toggle: () => void;
  togglePause: () => void;
  clearInfo: () => void;
}

/**
 * Remote-control side of the recording pipeline, used by the floating
 * control bar. The pipeline itself (getDisplayMedia, crop loop,
 * MediaRecorder) runs in the MAIN camera window — WebKit only allows one
 * active capture per page, so camera + screen capture must share a document
 * or they mute each other. This hook mirrors the pipeline's UI state from
 * `app://recording-ui` broadcasts and sends actions via
 * `app://recording-cmd`.
 */
export function useRecordingRemote(): RemoteApi {
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [info, setInfo] = useState("");
  const [region, setRegion] = useState<RecordingRegion | null>(null);

  // Mirror pipeline UI state; ask for a sync on mount in case a recording is
  // already running when the bar opens.
  useEffect(() => {
    const unlisten = listen<RecordingUiPayload>(EVT.RECORDING_UI, (e) => {
      setStatus(e.payload.status);
      setElapsed(e.payload.elapsed);
      setCountdown(e.payload.countdown);
      setInfo(e.payload.info);
    });
    void emit(EVT.RECORDING_CMD, { action: "sync" } satisfies RecordingCmdPayload);
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Region display (label in the bar). Selection UX already flows through
  // Rust commands + REGION_SELECTED broadcasts; the bar only mirrors it.
  useEffect(() => {
    void getRecordingRegion().then(setRegion);
    const unlisten = listen<RecordingRegion | null>(EVT.REGION_SELECTED, (e) => {
      setRegion(e.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const send = useCallback((action: RecordingCmdPayload["action"]) => {
    void emit(EVT.RECORDING_CMD, { action } satisfies RecordingCmdPayload);
  }, []);

  return {
    status,
    elapsed,
    countdown,
    info,
    region,
    toggle: useCallback(() => send("toggle"), [send]),
    togglePause: useCallback(() => send("toggle-pause"), [send]),
    clearInfo: useCallback(() => send("clear-info"), [send]),
  };
}
