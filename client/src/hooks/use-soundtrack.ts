import { useCallback, useEffect, useState } from "react";

const MUTED_KEY = "safenet-soundtrack-muted";
const CHANGE_EVENT = "safenet-soundtrack-change";

function getAudio(): HTMLAudioElement | null {
  if (typeof document === "undefined") return null;
  const audio = document.getElementById("safenet-soundtrack-audio");
  return audio instanceof HTMLAudioElement ? audio : null;
}

export function useSoundtrack() {
  const [enabled, setEnabled] = useState(() =>
    typeof window === "undefined" ? true : window.localStorage.getItem(MUTED_KEY) !== "true",
  );

  useEffect(() => {
    const sync = () => setEnabled(window.localStorage.getItem(MUTED_KEY) !== "true");
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, []);

  const setSoundtrackEnabled = useCallback((nextEnabled: boolean) => {
    const audio = getAudio();
    window.localStorage.setItem(MUTED_KEY, String(!nextEnabled));
    if (audio) {
      audio.muted = !nextEnabled;
      if (nextEnabled) {
        void audio.play().catch(() => undefined);
      }
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return {
    enabled,
    toggle: () => setSoundtrackEnabled(!enabled),
    setEnabled: setSoundtrackEnabled,
  };
}