import { Music2, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type AudioNodeSet = {
  context: AudioContext;
  oscillators: OscillatorNode[];
  master: GainNode;
};

/**
 * A tiny, dependency-free ambient bed. It avoids a remote audio request and
 * only starts after an explicit user gesture, which keeps it compatible with
 * browser and Android WebView autoplay policies.
 */
export function SoundtrackControl() {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<AudioNodeSet | null>(null);

  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (!audio) {
        return;
      }
      audio.oscillators.forEach((oscillator) => oscillator.stop());
      void audio.context.close();
      audioRef.current = null;
    };
  }, []);

  const stop = () => {
    const audio = audioRef.current;
    if (!audio) {
      setIsPlaying(false);
      return;
    }
    audio.oscillators.forEach((oscillator) => oscillator.stop());
    void audio.context.close();
    audioRef.current = null;
    setIsPlaying(false);
  };

  const toggle = async () => {
    if (audioRef.current) {
      stop();
      return;
    }

    const AudioContextConstructor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextConstructor) {
      return;
    }

    const context = new AudioContextConstructor();
    const master = context.createGain();
    master.gain.value = 0.045;
    master.connect(context.destination);

    const oscillators = [110, 164.81, 220].map((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = index === 2 ? "sine" : "triangle";
      oscillator.frequency.value = frequency;
      gain.gain.value = index === 0 ? 0.55 : index === 1 ? 0.22 : 0.12;
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start();
      return oscillator;
    });

    audioRef.current = { context, oscillators, master };
    await context.resume();
    setIsPlaying(true);
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void toggle()}
      aria-label={isPlaying ? "Pause ambient soundtrack" : "Play ambient soundtrack"}
      aria-pressed={isPlaying}
      className="fixed right-3 top-3 z-40 border-white/20 bg-black/40 text-slate-200 backdrop-blur-md hover:bg-black/60"
    >
      {isPlaying ? (
        <Volume2 className="h-4 w-4" />
      ) : (
        <VolumeX className="h-4 w-4" />
      )}
      <Music2 className="h-3.5 w-3.5 opacity-70" />
      <span className="hidden sm:inline">Soundtrack</span>
    </Button>
  );
}