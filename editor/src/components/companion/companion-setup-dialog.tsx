'use client';

import { useState } from 'react';
import { Loader2, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { pingCompanion } from '@/lib/companion/client';

interface CompanionSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompanionReady: () => void;
}

export function CompanionSetupDialog({
  open,
  onOpenChange,
  onCompanionReady,
}: CompanionSetupDialogProps) {
  const [checking, setChecking] = useState(false);
  const [retryError, setRetryError] = useState(false);

  const handleTryAgain = async () => {
    setChecking(true);
    setRetryError(false);
    const alive = await pingCompanion();
    setChecking(false);
    if (alive) {
      onOpenChange(false);
      onCompanionReady();
    } else {
      setRetryError(true);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Companion Service Not Running</DialogTitle>
          <DialogDescription>
            Opening Instagram and TikTok in browser requires the Jorsby
            Companion service to be running locally.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-md bg-muted p-4 space-y-2">
            <p className="text-sm font-medium flex items-center gap-2">
              <Terminal className="h-4 w-4" />
              Start the companion service
            </p>
            <p className="text-xs text-muted-foreground">
              Open a terminal in the Jorsby project directory and run:
            </p>
            <code className="block text-xs bg-background rounded px-3 py-2 font-mono">
              cd companion-service && node index.js
            </code>
          </div>

          <p className="text-xs text-muted-foreground">
            The service runs on{' '}
            <code className="font-mono">127.0.0.1:12345</code> (loopback only)
            and opens Chrome with isolated per-account profiles so each social
            account stays logged in independently.
          </p>

          {retryError && (
            <p className="text-sm text-destructive">
              Still not reachable — make sure the service started without
              errors.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleTryAgain} disabled={checking}>
            {checking && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Try Again
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
