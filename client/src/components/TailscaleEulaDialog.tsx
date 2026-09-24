import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ShieldCheck } from "lucide-react";

type TailscaleEulaDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccept: () => void;
  onCancel: () => void;
};

export function TailscaleEulaDialog({
  open,
  onOpenChange,
  onAccept,
  onCancel,
}: TailscaleEulaDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-xl" data-testid="dialog-tailscale-eula">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Tailscale Mesh VPN EULA
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-2 text-left text-sm leading-6">
              <p>
                SafeNet displays the status and device count for the Tailscale
                tailnet configured by your administrator and can open the
                Tailscale admin console.
              </p>
              <p>
                SafeNet does not create Tailscale accounts, enroll your device,
                establish a Tailscale VPN connection, or route your traffic
                through Tailscale.
              </p>
              <p>
                Tailscale is a third-party service, and its own terms govern its
                use. Continue only if you are authorized to access this tailnet.
              </p>
              <p className="font-medium text-foreground">
                By selecting “Agree &amp; Continue,” you acknowledge this notice
                and open the Tailscale admin console in a new tab.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} data-testid="button-tailscale-eula-cancel">
            Not now
          </AlertDialogCancel>
          <AlertDialogAction onClick={onAccept} data-testid="button-tailscale-eula-accept">
            Agree &amp; Continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}