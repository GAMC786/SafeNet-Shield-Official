import { useState, useEffect } from "react";
import { useRequestPinRecovery, useResetPinRecovery, useVerifyPin } from "@/hooks/use-settings";
import { Lock, ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import logoImage from "@assets/SafeNet_Shield_Logo_1766348594367.png";
import { Link } from "wouter";

interface PinEntryProps {
  onSuccess: () => void;
}

export function PinEntry({ onSuccess }: PinEntryProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("Access denied");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryPin, setRecoveryPin] = useState("");
  const [recoverySent, setRecoverySent] = useState(false);
  const verifyPin = useVerifyPin();
  const requestRecovery = useRequestPinRecovery();
  const resetRecovery = useResetPinRecovery();

  const handleNumberClick = (num: string) => {
    if (!verifyPin.isPending && pin.length < 4) {
      setPin(prev => prev + num);
      setError(false);
    }
  };

  const handleDelete = () => {
    setPin(prev => prev.slice(0, -1));
  };

  const handleSubmit = async () => {
    if (verifyPin.isPending || pin.length !== 4) return;
    try {
      const result = await verifyPin.mutateAsync(pin);
      if (result.valid) {
        onSuccess();
      } else {
        setError(true);
        setErrorMessage("Access denied");
        setPin("");
      }
    } catch (caughtError) {
      setError(true);
      const typedError = caughtError as Error & { status?: number; retryAfter?: number };
      setErrorMessage(
        typedError.status === 429
          ? `Too many attempts. Try again in ${typedError.retryAfter || 900} seconds.`
          : typedError.message || "Access denied",
      );
      setPin("");
    }
  };

  useEffect(() => {
    if (pin.length === 4 && !verifyPin.isPending) {
      handleSubmit();
    }
  }, [pin, verifyPin.isPending]);

  const handleRequestRecovery = async () => {
    if (!recoveryEmail.trim()) return;
    try {
      await requestRecovery.mutateAsync(recoveryEmail.trim());
      setRecoverySent(true);
      setError(false);
    } catch (caughtError) {
      setError(true);
      setErrorMessage(caughtError instanceof Error ? caughtError.message : "Recovery email could not be sent");
    }
  };

  const handleResetRecovery = async () => {
    if (recoveryCode.length !== 6 || recoveryPin.length !== 4) return;
    try {
      await resetRecovery.mutateAsync({
        email: recoveryEmail.trim(),
        code: recoveryCode,
        pin: recoveryPin,
      });
      onSuccess();
    } catch (caughtError) {
      setError(true);
      setErrorMessage(caughtError instanceof Error ? caughtError.message : "Recovery code could not be verified");
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center p-4 overflow-y-auto">
      <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1920&q=80')] opacity-5 bg-cover bg-center pointer-events-none mix-blend-overlay" />
      
      {/* SafeNet Branding */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-12 flex flex-col items-center text-center"
      >
        <a href="https://safenetinc.ca" target="_blank" rel="noopener noreferrer">
          <img 
            src={logoImage} 
            alt="SafeNet DNS" 
            className="w-20 h-20 object-contain rounded-xl mb-4 hover:opacity-80 transition-opacity"
            style={{ imageRendering: 'crisp-edges' }}
          />
        </a>
        <h1 className="text-4xl font-display font-bold tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-white to-white/60 mb-2">
          SafeNet
        </h1>
        <p className="text-primary font-mono tracking-[0.2em] text-sm uppercase">Secure Access Required</p>
      </motion.div>

      <div className="w-full max-w-[300px] mb-8 space-y-3">
        <Button
          asChild
          type="button"
          className="w-full bg-white text-slate-950 hover:bg-slate-200"
        >
          <Link href="/sign-in">
            <svg aria-hidden="true" className="mr-2 h-4 w-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M21.35 12.23c0-.79-.07-1.55-.23-2.27H12v4.3h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.69 2.91-4.18 2.91-7.42Z" />
              <path fill="#34A853" d="M12 21.5c2.63 0 4.84-.87 6.45-2.35l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.54 0-4.69-1.72-5.46-4.03H3.3v2.53A9.74 9.74 0 0 0 12 21.5Z" />
              <path fill="#FBBC05" d="M6.54 13.59A5.85 5.85 0 0 1 6.23 12c0-.55.1-1.09.31-1.59V7.88H3.3A9.75 9.75 0 0 0 2.25 12c0 1.57.38 3.05 1.05 4.12l3.24-2.53Z" />
              <path fill="#EA4335" d="M12 6.38c1.43 0 2.71.49 3.72 1.45l2.79-2.79C16.84 3.47 14.63 2.5 12 2.5a9.74 9.74 0 0 0-8.7 5.38l3.24 2.53C7.31 8.1 9.46 6.38 12 6.38Z" />
            </svg>
            Sign in with Google
          </Link>
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Or use your local SafeNet PIN
        </p>
      </div>

      {/* PIN Dots */}
      <div className="flex gap-5 mb-12">
        {[0, 1, 2, 3].map((i) => (
          <motion.div
            key={i}
            initial={false}
            animate={{
              scale: pin.length > i ? 1.15 : 1,
              borderColor: error ? "#ef4444" : pin.length > i ? "#60a5fa" : "rgba(255,255,255,0.2)",
              backgroundColor: pin.length > i ? (error ? "#ef4444" : "#60a5fa") : "transparent",
              boxShadow: pin.length > i ? (error ? "0 0 14px #ef4444" : "0 0 14px #60a5fa") : "none"
            }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className={cn(
              "w-5 h-5 rounded-full border-2 transition-colors duration-150",
              error && "animate-shake"
            )}
          />
        ))}
      </div>

      {/* Numpad */}
      <div className="grid grid-cols-3 gap-6 w-full max-w-[300px]">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
          <motion.button
            key={num}
            whileHover={{ scale: 1.1, backgroundColor: "rgba(255,255,255,0.05)" }}
            whileTap={{ scale: 0.95 }}
            onClick={() => handleNumberClick(num.toString())}
            aria-label={`Enter ${num}`}
            disabled={verifyPin.isPending}
            className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-mono border border-white/5 bg-white/5 hover:border-primary/50 hover:shadow-[0_0_15px_rgba(59,130,246,0.2)] transition-all"
          >
            {num}
          </motion.button>
        ))}
        <div />
        <motion.button
          whileHover={{ scale: 1.1, backgroundColor: "rgba(255,255,255,0.05)" }}
          whileTap={{ scale: 0.95 }}
          onClick={() => handleNumberClick("0")}
          aria-label="Enter 0"
          disabled={verifyPin.isPending}
          className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-mono border border-white/5 bg-white/5 hover:border-primary/50 hover:shadow-[0_0_15px_rgba(59,130,246,0.2)] transition-all"
        >
          0
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.1, backgroundColor: "rgba(255,255,255,0.05)" }}
          whileTap={{ scale: 0.95 }}
          onClick={handleDelete}
          aria-label="Delete last digit"
          disabled={verifyPin.isPending}
          className="w-16 h-16 rounded-full flex items-center justify-center text-sm font-mono text-muted-foreground hover:text-white transition-colors"
        >
          DEL
        </motion.button>
      </div>
      
      {error && (
        <motion.p 
          initial={{ opacity: 0 }} 
          animate={{ opacity: 1 }}
          className="mt-8 text-destructive font-mono uppercase tracking-widest text-sm flex items-center gap-2"
        >
          <Lock className="w-4 h-4" /> {errorMessage}
        </motion.p>
      )}

      <Button
        variant="ghost"
        className="mt-5 text-muted-foreground hover:text-primary"
        onClick={() => {
          setRecoveryMode((current) => !current);
          setError(false);
        }}
      >
        <ArrowRight className="mr-2 h-4 w-4" />
        {recoveryMode ? "Back to PIN entry" : "Forgot PIN? Recover by email"}
      </Button>

      {recoveryMode && (
        <div className="mt-4 w-full max-w-[360px] space-y-3 rounded-lg border border-white/10 bg-white/5 p-4">
          <p className="text-sm text-muted-foreground">
            Use the recovery email configured in SafeNet Settings. Your code expires in 10 minutes.
          </p>
          <Input
            type="email"
            value={recoveryEmail}
            onChange={(event) => setRecoveryEmail(event.target.value)}
            placeholder="you@example.com"
            aria-label="Recovery email"
            className="bg-background"
          />
          <Button
            className="w-full"
            onClick={() => void handleRequestRecovery()}
            disabled={requestRecovery.isPending || !recoveryEmail.includes("@")}
          >
            {requestRecovery.isPending ? "Sending code…" : "Send recovery code"}
          </Button>
          {recoverySent && (
            <>
              <Input
                inputMode="numeric"
                maxLength={6}
                value={recoveryCode}
                onChange={(event) => setRecoveryCode(event.target.value.replace(/\D/g, ""))}
                placeholder="6-digit code"
                aria-label="Recovery code"
                className="bg-background font-mono tracking-widest"
              />
              <Input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={recoveryPin}
                onChange={(event) => setRecoveryPin(event.target.value.replace(/\D/g, ""))}
                placeholder="New 4-digit PIN"
                aria-label="New PIN"
                className="bg-background font-mono tracking-widest"
              />
              <Button
                className="w-full"
                onClick={() => void handleResetRecovery()}
                disabled={resetRecovery.isPending || recoveryCode.length !== 6 || recoveryPin.length !== 4}
              >
                {resetRecovery.isPending ? "Resetting PIN…" : "Reset PIN and unlock"}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
