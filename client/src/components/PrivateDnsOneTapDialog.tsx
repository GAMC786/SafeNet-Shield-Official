import { useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";

type PrivateDnsOneTapDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hostname: string | null;
};

const adbCommand = "adb shell pm grant com.safenet.dns android.permission.WRITE_SECURE_SETTINGS";

export function PrivateDnsOneTapDialog({
  open,
  onOpenChange,
  hostname,
}: PrivateDnsOneTapDialogProps) {
  const [copied, setCopied] = useState(false);

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(adbCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-xl" data-testid="dialog-private-dns-one-tap">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Set up optional one-tap control
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4 text-left text-sm leading-6">
              <p>
                Android protects Private DNS from ordinary apps. SafeNet keeps
                the normal Android Settings flow available and only enables
                direct switching after you explicitly grant this protected
                permission.
              </p>
              <ol className="list-decimal space-y-2 pl-5">
                <li>Connect this Android device to a trusted computer with ADB enabled.</li>
                <li>Run the command below, or grant the same permission through Shizuku.</li>
                <li>Return to SafeNet. The one-tap action will appear when Android reports access.</li>
              </ol>
              <div className="rounded-md border border-white/10 bg-black/30 p-3 font-mono text-xs text-muted-foreground">
                {adbCommand}
              </div>
              <p>
                SafeNet will only apply the selected hostname
                {hostname ? ` (${hostname})` : ""} and will verify Android&apos;s
                reported value afterward. This setup is optional.
              </p>
              <Button type="button" variant="outline" onClick={() => void copyCommand()}>
                {copied ? "Command copied" : "Copy ADB command"}
              </Button>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep using Android settings</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}