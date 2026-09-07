import { Alignment, Fit, Layout, useRive } from "@rive-app/react-canvas";
import { Music2, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const REFERENCE_SOUNDTRACK_URL =
  "https://v3.2advanced.com/V3ExpansionsReboot/assets/mainsoundtrack-qNDg_tQY.wav";
const RIVE_COMPANION_URL = "https://cdn.rive.app/animations/vehicles.riv";

/**
 * The reference experience starts its full soundtrack after an explicit
 * start interaction. Keep the same browser-safe behavior here: the complete
 * loop is loaded as an audio element, but playback never starts by itself.
 *
 * The soundtrack remains referenced from its public source URL rather than
 * copied into this project. The Rive companion uses Rive's CORS-enabled
 * public sample asset so the interaction remains reliable in a third-party
 * app; the reference site's large mainstage file does not expose CORS headers.
 */
export function SoundtrackControl() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasAudioError, setHasAudioError] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const riveLayout = useMemo(
    () => new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
    [],
  );
  const { RiveComponent, rive } = useRive({
    src: RIVE_COMPANION_URL,
    autoplay: false,
    layout: riveLayout,
  });

  useEffect(() => {
    const audio = new Audio(REFERENCE_SOUNDTRACK_URL);
    audio.loop = true;
    audio.preload = "auto";
    audioRef.current = audio;

    const handleAudioError = () => {
      setHasAudioError(true);
      setIsPlaying(false);
    };
    const handleAudioPlay = () => setIsPlaying(true);
    const handleAudioPause = () => setIsPlaying(false);

    audio.addEventListener("error", handleAudioError);
    audio.addEventListener("play", handleAudioPlay);
    audio.addEventListener("pause", handleAudioPause);

    return () => {
      audio.pause();
      audio.removeEventListener("error", handleAudioError);
      audio.removeEventListener("play", handleAudioPlay);
      audio.removeEventListener("pause", handleAudioPause);
      audio.src = "";
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!rive) {
      return;
    }

    if (isPlaying) {
      rive.play();
    } else {
      rive.pause();
    }
  }, [isPlaying, rive]);

  const stop = () => {
    const audio = audioRef.current;
    if (!audio) {
      setIsPlaying(false);
      return;
    }
    audio.pause();
    audio.currentTime = 0;
    setIsPlaying(false);
  };

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (isPlaying) {
      stop();
      return;
    }

    setHasAudioError(false);
    try {
      await audio.play();
    } catch {
      setHasAudioError(true);
      setIsPlaying(false);
    }
  };

  const audioLabel = hasAudioError
    ? "Reference soundtrack unavailable"
    : isPlaying
      ? "Pause background soundtrack"
      : "Play background soundtrack";

  return (
    <div className="fixed right-3 top-3 z-40 flex items-center gap-2">
      <div
        className="hidden h-9 w-14 overflow-hidden rounded-md border border-white/15 bg-slate-950/60 shadow-lg shadow-cyan-950/20 backdrop-blur-md sm:block"
        aria-hidden="true"
      >
        <RiveComponent className="h-full w-full opacity-80" />
      </div>
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
        {isPlaying ? (
          <Volume2 className="h-4 w-4" />
        ) : (
          <VolumeX className="h-4 w-4" />
        )}
        <Music2 className="h-3.5 w-3.5 opacity-70" />
        <span className="hidden sm:inline">
          {hasAudioError ? "Unavailable" : "Soundtrack"}
        </span>
      </Button>
    </div>
  );
}