import { Music2, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const REFERENCE_SOUNDTRACK_URL =
  "https://v3.2advanced.com/V3ExpansionsReboot/assets/mainsoundtrack-qNDg_tQY.wav";
const AUDIO_ELEMENT_ID = "safenet-startup-audio";
const MUTED_STORAGE_KEY = "safenet-soundtrack-muted";
/**
 * Start the complete loop when the authenticated app shell mounts after the
 * startup loader. Android's WebView allows that playback; browsers may reject
 * it, so the control turns into an explicit tap-to-enable action instead.
 *
 * The soundtrack remains referenced from its public source URL rather than
 * copied into this project. The Rive companion uses Rive's CORS-enabled
 * public sample asset so the interaction remains reliable in a third-party
 * app; the reference site's large mainstage file does not expose CORS headers.
 */
export function SoundtrackControl() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(
    () => window.localStorage.getItem(MUTED_STORAGE_KEY) === "true",
  );
  const [hasAudioError, setHasAudioError] = useState(false);
  const [needsUserGesture, setNeedsUserGesture] = useState(() => {
    const existingAudio = document.getElementById(AUDIO_ELEMENT_ID);
    return (
      existingAudio instanceof HTMLAudioElement &&
      existingAudio.paused &&
      !existingAudio.muted
    );
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const audio =
      document.getElementById(AUDIO_ELEMENT_ID) instanceof HTMLAudioElement
        ? (document.getElementById(AUDIO_ELEMENT_ID) as HTMLAudioElement)
        : new Audio(REFERENCE_SOUNDTRACK_URL);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = 0.55;
    const savedMuted =
      window.localStorage.getItem(MUTED_STORAGE_KEY) === "true";
    audio.muted = savedMuted;
    setIsMuted(savedMuted);
    audioRef.current = audio;

    const handleAudioError = () => {
      setHasAudioError(true);
      setIsPlaying(false);
    };
    const handleAudioPlay = () => {
      setIsPlaying(!audio.muted);
      setIsMuted(audio.muted);
      setNeedsUserGesture(false);
    };
    const handleAudioPause = () => setIsPlaying(false);
    const handleAudioVolumeChange = () => {
      setIsMuted(audio.muted);
      if (audio.muted) {
        setIsPlaying(false);
      }
    };

    audio.addEventListener("error", handleAudioError);
    audio.addEventListener("play", handleAudioPlay);
    audio.addEventListener("pause", handleAudioPause);
    audio.addEventListener("volumechange", handleAudioVolumeChange);
    if (!savedMuted) {
      void audio.play().catch(() => setNeedsUserGesture(true));
    }

    return () => {
      if (!document.getElementById(AUDIO_ELEMENT_ID)) {
        audio.pause();
        audio.src = "";
      }
      audio.removeEventListener("error", handleAudioError);
      audio.removeEventListener("play", handleAudioPlay);
      audio.removeEventListener("pause", handleAudioPause);
      audio.removeEventListener("volumechange", handleAudioVolumeChange);
      audioRef.current = null;
    };
  }, []);

  const mute = () => {
    const audio = audioRef.current;
    if (!audio) {
      setIsPlaying(false);
      setIsMuted(true);
      return;
    }
    audio.muted = true;
    audio.pause();
    window.localStorage.setItem(MUTED_STORAGE_KEY, "true");
    audio.currentTime = 0;
    setIsPlaying(false);
    setIsMuted(true);
  };

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (!audio.paused && !audio.muted) {
      mute();
      return;
    }

    setHasAudioError(false);
    audio.muted = false;
    try {
      await audio.play();
      window.localStorage.setItem(MUTED_STORAGE_KEY, "false");
      setIsMuted(false);
      setNeedsUserGesture(false);
    } catch {
      audio.muted = true;
      setNeedsUserGesture(true);
      setIsPlaying(false);
      setIsMuted(true);
    }
  };

  const audioLabel = hasAudioError
    ? "Reference soundtrack unavailable"
    : needsUserGesture
      ? "Tap to enable soundtrack"
    : isPlaying && !isMuted
      ? "Pause background soundtrack"
      : "Play background soundtrack";

  return (
    <div className="fixed right-3 top-3 z-40 flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void toggle()}
        aria-label={audioLabel}
        aria-pressed={isPlaying}
        title={audioLabel}
        className="border-white/20 bg-black/40 text-slate-200 backdrop-blur-md hover:bg-black/60"
      >
        {isPlaying && !isMuted ? (
          <Volume2 className="h-4 w-4" />
        ) : (
          <VolumeX className="h-4 w-4" />
        )}
        <Music2 className="h-3.5 w-3.5 opacity-70" />
        <span className="hidden sm:inline">
          {hasAudioError
            ? "Unavailable"
            : needsUserGesture
              ? "Enable sound"
              : isPlaying && !isMuted
                ? "Mute"
                : "Soundtrack"}
        </span>
      </Button>
    </div>
  );
}