'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
  useRef,
} from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface DeleteConfirmationOptions {
  title?: string;
  description?: string;
  confirmLabel?: string;
}

interface DeleteConfirmationContextType {
  confirm: (options?: DeleteConfirmationOptions) => Promise<boolean>;
}

const DeleteConfirmationContext =
  createContext<DeleteConfirmationContextType | null>(null);

export function DeleteConfirmationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState('Delete Item');
  const [description, setDescription] = useState(
    'Are you sure you want to delete this item? This action cannot be undone.'
  );
  const [confirmLabel, setConfirmLabel] = useState<string | undefined>();

  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback(
    (options?: DeleteConfirmationOptions): Promise<boolean> => {
      setTitle(options?.title || 'Delete Item');
      setDescription(
        options?.description ||
          'Are you sure you want to delete this item? This action cannot be undone.'
      );
      setConfirmLabel(options?.confirmLabel);
      setIsOpen(true);

      return new Promise((resolve) => {
        resolveRef.current = resolve;
      });
    },
    []
  );

  const handleConfirm = useCallback(() => {
    setIsOpen(false);
    resolveRef.current?.(true);
    resolveRef.current = null;
  }, []);

  const handleCancel = useCallback(() => {
    setIsOpen(false);
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  return (
    <DeleteConfirmationContext.Provider value={{ confirm }}>
      {children}
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleCancel()}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirm}>
              {confirmLabel || 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DeleteConfirmationContext.Provider>
  );
}

export function useDeleteConfirmation() {
  const context = useContext(DeleteConfirmationContext);
  if (!context) {
    throw new Error(
      'useDeleteConfirmation must be used within a DeleteConfirmationProvider'
    );
  }
  return context;
}
