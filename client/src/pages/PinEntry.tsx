import { useState, useEffect } from "react";
import { useVerifyPin } from "@/hooks/use-settings";
import { Lock, ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import logoImage from "@assets/SafeNet_Shield_Logo_1766348594367.png";

interface PinEntryProps {
  onSuccess: () => void;
}

export function PinEntry({ onSuccess }: PinEntryProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const verifyPin = useVerifyPin();

  const handleNumberClick = (num: string) => {
    if (pin.length < 4) {
      setPin(prev => prev + num);
      setError(false);
    }
  };

  const handleDelete = () => {
    setPin(prev => prev.slice(0, -1));
  };

  const handleSubmit = async () => {
    try {
      const result = await verifyPin.mutateAsync(pin);
      if (result.valid) {
        onSuccess();
      } else {
        setError(true);
        setPin("");
      }
    } catch (e) {
      setError(true);
      setPin("");
    }
  };

  useEffect(() => {
    if (pin.length === 4) {
      handleSubmit();
    }
  }, [pin]);

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center p-4">
      <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1920&q=80')] opacity-5 bg-cover bg-center pointer-events-none mix-blend-overlay" />
      
      {/* SafeNet Branding */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-12 flex flex-col items-center text-center"
      >
        <img 
          src={logoImage} 
          alt="SafeNet DNS" 
          className="w-20 h-20 object-contain rounded-xl mb-4"
          style={{ imageRendering: 'crisp-edges' }}
        />
        <h1 className="text-4xl font-display font-bold tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-white to-white/60 mb-2">
          SafeNet
        </h1>
        <p className="text-primary font-mono tracking-[0.2em] text-sm uppercase">Secure Access Required</p>
      </motion.div>

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
          className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-mono border border-white/5 bg-white/5 hover:border-primary/50 hover:shadow-[0_0_15px_rgba(59,130,246,0.2)] transition-all"
        >
          0
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.1, backgroundColor: "rgba(255,255,255,0.05)" }}
          whileTap={{ scale: 0.95 }}
          onClick={handleDelete}
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
          <Lock className="w-4 h-4" /> Access Denied
        </motion.p>
      )}
    </div>
  );
}
