import { Music2, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@/components/ui/button";

const REFERENCE_SOUNDTRACK_URL =
  "https://v3.2advanced.com/V3ExpansionsReboot/assets/mainsoundtrack-qNDg_tQY.wav";
const AUDIO_ELEMENT_ID = "safenet-soundtrack-audio";
const MUTED_STORAGE_KEY = "safenet-soundtrack-muted";
const POSITION_STORAGE_KEY = "safenet-soundtrack-position";
const STARTUP_COMPLETE_EVENT = "safenet:startup-complete";
const DRAG_EDGE_GUTTER = 12;
const DRAG_THRESHOLD = 5;

type DragPosition = {
  left: number;
  top: number;
};

type ActiveDrag = {
  pointerId: number;
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  moved: boolean;
};

function readSavedPosition(): DragPosition | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const saved = JSON.parse(
      window.localStorage.getItem(POSITION_STORAGE_KEY) ?? "null",
    ) as Partial<DragPosition> | null;
    if (
      saved &&
      typeof saved.left === "number" &&
      Number.isFinite(saved.left) &&
      typeof saved.top === "number" &&
      Number.isFinite(saved.top)
    ) {
      return { left: saved.left, top: saved.top };
    }
  } catch {
    // Ignore malformed position data and use the default centered placement.
  }

  return null;
}

function clampPosition(
  position: DragPosition,
  width: number,
  height: number,
): DragPosition {
  return {
    left: Math.min(
      Math.max(DRAG_EDGE_GUTTER, position.left),
      Math.max(DRAG_EDGE_GUTTER, window.innerWidth - width - DRAG_EDGE_GUTTER),
    ),
    top: Math.min(
      Math.max(DRAG_EDGE_GUTTER, position.top),
      Math.max(DRAG_EDGE_GUTTER, window.innerHeight - height - DRAG_EDGE_GUTTER),
    ),
  };
}

/**
  * Start the complete loop after the static startup loader has finished.
  * Android's WebView allows playback after that point; browsers may reject it,
  * so the control turns into an explicit tap-to-enable action instead.
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
  const [dragPosition, setDragPosition] = useState<DragPosition | null>(
    readSavedPosition,
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
  const controlRef = useRef<HTMLDivElement | null>(null);
  const activeDragRef = useRef<ActiveDrag | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (!dragPosition) {
      return;
    }
    window.localStorage.setItem(
      POSITION_STORAGE_KEY,
      JSON.stringify(dragPosition),
    );
  }, [dragPosition]);

  useEffect(() => {
    const handleResize = () => {
      const control = controlRef.current;
      if (!control) {
        return;
      }
      setDragPosition((current) =>
        current
          ? clampPosition(current, control.offsetWidth, control.offsetHeight)
          : current,
      );
    };

    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, []);

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
    const handleAudioEnded = () => {
      // Keep the loop reliable across WebView implementations that emit an
      // ended event even when the loop attribute is enabled.
      if (!audio.muted) {
        audio.currentTime = 0;
        void audio.play().catch(() => {
          setNeedsUserGesture(true);
          setIsPlaying(false);
        });
      }
    };
    const handleAudioVolumeChange = () => {
      setIsMuted(audio.muted);
      if (audio.muted) {
        setIsPlaying(false);
      }
    };
    const startAudio = () => {
      if (savedMuted) {
        return;
      }
      setHasAudioError(false);
      audio.preload = "auto";
      void audio.play().catch(() => {
        setNeedsUserGesture(true);
        setIsPlaying(false);
      });
    };
    const handleStartupComplete = () => startAudio();

    audio.addEventListener("error", handleAudioError);
    audio.addEventListener("play", handleAudioPlay);
    audio.addEventListener("pause", handleAudioPause);
    audio.addEventListener("ended", handleAudioEnded);
    audio.addEventListener("volumechange", handleAudioVolumeChange);
    window.addEventListener(STARTUP_COMPLETE_EVENT, handleStartupComplete);
    setIsPlaying(!audio.paused && !audio.muted);
    setNeedsUserGesture(audio.paused && !audio.muted);
    if (!savedMuted && !document.getElementById("startup-loader")) {
      startAudio();
    }

    return () => {
      if (!document.getElementById(AUDIO_ELEMENT_ID)) {
        audio.pause();
        audio.src = "";
      }
      audio.removeEventListener("error", handleAudioError);
      audio.removeEventListener("play", handleAudioPlay);
      audio.removeEventListener("pause", handleAudioPause);
      audio.removeEventListener("ended", handleAudioEnded);
      audio.removeEventListener("volumechange", handleAudioVolumeChange);
      window.removeEventListener(STARTUP_COMPLETE_EVENT, handleStartupComplete);
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
    audio.preload = "auto";
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

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    activeDragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const activeDrag = activeDragRef.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) {
      return;
    }

    if (
      !activeDrag.moved &&
      Math.hypot(
        event.clientX - activeDrag.startX,
        event.clientY - activeDrag.startY,
      ) < DRAG_THRESHOLD
    ) {
      return;
    }

    activeDrag.moved = true;
    const control = event.currentTarget;
    setDragPosition(
      clampPosition(
        {
          left: event.clientX - activeDrag.offsetX,
          top: event.clientY - activeDrag.offsetY,
        },
        control.offsetWidth,
        control.offsetHeight,
      ),
    );
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const activeDrag = activeDragRef.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) {
      return;
    }

    if (activeDrag.moved) {
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 250);
    }
    activeDragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const handleClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    void toggle();
  };

  const audioLabel = hasAudioError
    ? "Reference soundtrack unavailable"
    : isPlaying && !isMuted
      ? "Turn soundtrack off"
      : needsUserGesture
        ? "Tap to turn soundtrack on"
        : "Turn soundtrack on";

  const positionClass = dragPosition
    ? "fixed z-40 flex items-center gap-2"
    : "fixed right-3 top-1/2 z-40 flex -translate-y-1/2 items-center gap-2";

  return (
    <div
      ref={controlRef}
      className={`${positionClass} cursor-grab touch-none select-none active:cursor-grabbing`}
      style={
        dragPosition
          ? { left: `${dragPosition.left}px`, top: `${dragPosition.top}px` }
          : undefined
      }
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      aria-label="Drag to reposition the soundtrack control"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleClick}
        aria-label={audioLabel}
        aria-pressed={isPlaying}
        title={`${audioLabel}. Drag to reposition.`}
        className="whitespace-nowrap border-white/60 bg-black/60 text-slate-100 shadow-[0_0_18px_rgba(255,255,255,0.12)] backdrop-blur-md hover:border-white hover:bg-black/70"
      >
        {isPlaying && !isMuted ? (
          <Volume2 className="h-4 w-4" />
        ) : (
          <VolumeX className="h-4 w-4" />
        )}
        <Music2 className="h-3.5 w-3.5 opacity-70" />
         <span>
          {hasAudioError
            ? "Unavailable"
             : `Soundtrack: ${isPlaying && !isMuted ? "On" : "Off"}`}
        </span>
      </Button>
    </div>
  );
}