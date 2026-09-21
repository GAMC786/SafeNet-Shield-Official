import { useCallback, useRef, useState, type ReactNode, type TouchEvent } from "react";
import { ArrowDown, Loader2, RefreshCw } from "lucide-react";

const PULL_THRESHOLD = 64;
const MAX_PULL_DISTANCE = 96;

interface PullToRefreshProps {
  children: ReactNode;
  className?: string;
  onRefresh: () => Promise<void>;
}

export function PullToRefresh({ children, className, onRefresh }: PullToRefreshProps) {
  const containerRef = useRef<HTMLElement | null>(null);
  const startYRef = useRef<number | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const resetGesture = useCallback(() => {
    startYRef.current = null;
    setPullDistance(0);
  }, []);

  const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
    if (isRefreshing || event.touches.length !== 1) {
      return;
    }
    const container = containerRef.current;
    if (!container || container.scrollTop > 0) {
      return;
    }
    startYRef.current = event.touches[0].clientY;
  };

  const handleTouchMove = (event: TouchEvent<HTMLElement>) => {
    const startY = startYRef.current;
    const container = containerRef.current;
    if (startY == null || !container || container.scrollTop > 0 || event.touches.length !== 1) {
      return;
    }

    const distance = event.touches[0].clientY - startY;
    if (distance <= 0) {
      setPullDistance(0);
      return;
    }

    event.preventDefault();
    setPullDistance(Math.min(MAX_PULL_DISTANCE, distance * 0.5));
  };

  const handleTouchEnd = async () => {
    const shouldRefresh = pullDistance >= PULL_THRESHOLD;
    resetGesture();
    if (!shouldRefresh || isRefreshing) {
      return;
    }

    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  const indicatorMessage = isRefreshing
    ? "Refreshing"
    : pullDistance >= PULL_THRESHOLD
      ? "Release to refresh"
      : "Pull to refresh";

  return (
    <main
      ref={containerRef}
      className={className}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={() => void handleTouchEnd()}
      onTouchCancel={resetGesture}
      aria-busy={isRefreshing}
      style={{ overscrollBehaviorY: "contain" }}
    >
      <div
        className="pointer-events-none flex items-center justify-center overflow-hidden text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
        style={{
          height: isRefreshing ? 48 : pullDistance,
          transition: pullDistance === 0 && !isRefreshing ? "height 160ms ease-out" : undefined,
        }}
        aria-live="polite"
      >
        <span className="flex items-center gap-2">
          {isRefreshing ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
          ) : pullDistance >= PULL_THRESHOLD ? (
            <RefreshCw className="h-4 w-4 text-primary" aria-hidden="true" />
          ) : (
            <ArrowDown className="h-4 w-4 text-primary" aria-hidden="true" />
          )}
          {indicatorMessage}
        </span>
      </div>
      {children}
    </main>
  );
}