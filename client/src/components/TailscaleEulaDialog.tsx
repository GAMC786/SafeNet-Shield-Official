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
            Tailscale VPN Use Notice
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-2 text-left text-sm leading-6">
              <p>
                SafeNet includes the upstream Tailscale Android networking
                engine. When you connect, SafeNet uses Android’s VPN service
                to route this device’s traffic through your Tailscale network.
                Tailscale handles device authentication, peer connections, and
                encrypted tunnel traffic.
              </p>
              <p>
                Tailscale sign-in opens in your browser. You must be authorized
                to join the selected tailnet. Tailscale’s terms and privacy
                practices apply to its service.
                {" "}
                <a
                  href="https://tailscale.com/licenses/android"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline underline-offset-2"
                >
                  Tailscale Android notices
                </a>
                .
              </p>
              <p>
                Android allows one active VPN service at a time, so connecting
                may replace another VPN. Exit-node, subnet-route, and Tailscale
                DNS options affect which traffic and DNS requests use the
                tailnet. SafeNet’s Android Private DNS setting is separate and
                remains managed by Android.
              </p>
              <p className="font-medium text-foreground">
                By selecting “Agree &amp; Continue,” you acknowledge this
                notice. Android will show its VPN permission prompt the first
                time you connect.
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