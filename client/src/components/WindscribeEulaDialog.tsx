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
import { ExternalLink, ShieldCheck } from "lucide-react";

type WindscribeEulaDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccept: () => void;
  onCancel: () => void;
};

const WINDSCRIBE_EULA_URL = "https://windscribe.com/terms/eula";

export function WindscribeEulaDialog({
  open,
  onOpenChange,
  onAccept,
  onCancel,
}: WindscribeEulaDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-xl" data-testid="dialog-windscribe-eula">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Windscribe VPN EULA
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-2 text-left text-sm leading-6">
              <p>
                Review Windscribe&apos;s official End User License Agreement before connecting to a
                Windscribe VPN profile from SafeNet.
              </p>
              <a
                href={WINDSCRIBE_EULA_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-primary underline underline-offset-2"
                data-testid="link-windscribe-eula-dialog"
              >
                Read Windscribe&apos;s official EULA
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <p className="font-medium text-foreground">
                By selecting “Agree &amp; Connect,” you confirm that you have reviewed and accept
                Windscribe&apos;s EULA. Windscribe maintains that agreement; SafeNet does not modify it.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} data-testid="button-windscribe-eula-cancel">
            Not now
          </AlertDialogCancel>
          <AlertDialogAction onClick={onAccept} data-testid="button-windscribe-eula-accept">
            Agree &amp; Connect
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}