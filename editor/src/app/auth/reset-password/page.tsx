'use client';

import { useState, useEffect, useId, Suspense } from 'react';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen w-full flex items-center justify-center bg-background">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}

function ResetPasswordContent() {
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [expired, setExpired] = useState(false);
  const newPasswordId = useId();
  const confirmPasswordId = useId();
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const errorParam = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  useEffect(() => {
    if (errorParam) return;

    // PKCE flow: user arrives with a valid session after /auth/confirm exchanged the code.
    // Check if already authenticated.
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setIsReady(true);
      }
    });

    // Hash-based flow fallback: listen for PASSWORD_RECOVERY event.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsReady(true);
      }
    });

    // Timeout: if neither flow resolves, show expired message.
    const timeout = setTimeout(() => {
      setExpired(true);
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [supabase, errorParam]);

  const handleSubmit = async (formData: FormData) => {
    const password = formData.get('password') as string;
    const confirmPassword = formData.get('confirmPassword') as string;

    if (password !== confirmPassword) {
      toast.error('Passwords do not match.');
      return;
    }

    if (password.length < 6) {
      toast.error('Password must be at least 6 characters.');
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        toast.error(error.message || 'Could not update password.');
        return;
      }

      toast.success('Password updated successfully.');
      router.push('/dashboard');
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const renderContent = () => {
    if (errorParam) {
      return (
        <div className="text-center py-8 space-y-4">
          <p className="text-sm text-destructive">
            {errorDescription?.replace(/\+/g, ' ') ||
              'This reset link is invalid or has expired.'}
          </p>
          <Link
            href="/login"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Back to <span className="text-foreground font-medium">Sign in</span>
          </Link>
        </div>
      );
    }

    if (!isReady && expired) {
      return (
        <div className="text-center py-8 space-y-4">
          <p className="text-sm text-destructive">
            This reset link has expired. Please request a new one.
          </p>
          <Link
            href="/login"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Back to <span className="text-foreground font-medium">Sign in</span>
          </Link>
        </div>
      );
    }

    if (!isReady) {
      return (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">
            Verifying reset link...
          </span>
        </div>
      );
    }

    return (
      <form action={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label
            htmlFor={newPasswordId}
            className="text-sm font-medium text-foreground"
          >
            New password
          </label>
          <Input
            id={newPasswordId}
            name="password"
            type="password"
            placeholder="••••••••"
            required
            minLength={6}
            disabled={isLoading}
            className="h-10 bg-background/50"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor={confirmPasswordId}
            className="text-sm font-medium text-foreground"
          >
            Confirm password
          </label>
          <Input
            id={confirmPasswordId}
            name="confirmPassword"
            type="password"
            placeholder="••••••••"
            required
            minLength={6}
            disabled={isLoading}
            className="h-10 bg-background/50"
          />
        </div>

        <Button type="submit" className="w-full h-10 mt-2" disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            'Update password'
          )}
        </Button>
      </form>
    );
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-muted/20" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-3xl" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="relative z-10 w-full max-w-sm mx-4"
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="text-center mb-8"
        >
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Combo
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            AI-powered video editor
          </p>
        </motion.div>

        <div className="bg-card/50 backdrop-blur-sm border border-border/50 rounded-xl p-6 shadow-2xl shadow-black/20">
          <h2 className="text-lg font-medium text-foreground mb-1">
            Set new password
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            Enter your new password below
          </p>

          {renderContent()}
        </div>
      </motion.div>
    </div>
  );
}
