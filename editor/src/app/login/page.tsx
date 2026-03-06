'use client';

import { useState, useId } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { login, signup, resetPassword } from './actions';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [isLoading, setIsLoading] = useState(false);
  const emailId = useId();
  const passwordId = useId();

  const handleSubmit = async (formData: FormData) => {
    setIsLoading(true);
    try {
      if (mode === 'forgot') {
        const email = formData.get('email') as string;
        const redirectTo = `${window.location.origin}/auth/confirm`;
        const result = await resetPassword(email, redirectTo);
        if (result?.error) {
          toast.error(result.message);
        } else {
          toast.success('Check your email for a password reset link.');
          setMode('login');
        }
        return;
      }

      const result =
        mode === 'login' ? await login(formData) : await signup(formData);

      if (result?.error) {
        toast.error(result.message);
      }
    } catch (error) {
      console.error('Auth error:', error);
      toast.error('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background relative overflow-hidden">
      {/* Subtle gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-muted/20" />

      {/* Ambient glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-3xl" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="relative z-10 w-full max-w-sm mx-4"
      >
        {/* Logo/Brand */}
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

        {/* Auth Card */}
        <div className="bg-card/50 backdrop-blur-sm border border-border/50 rounded-xl p-6 shadow-2xl shadow-black/20">
          <AnimatePresence mode="wait">
            <motion.div
              key={mode}
              initial={{ opacity: 0, x: mode === 'login' ? -10 : 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: mode === 'login' ? 10 : -10 }}
              transition={{ duration: 0.2 }}
            >
              <h2 className="text-lg font-medium text-foreground mb-1">
                {mode === 'login'
                  ? 'Welcome back'
                  : mode === 'signup'
                    ? 'Create your account'
                    : 'Reset your password'}
              </h2>
              <p className="text-sm text-muted-foreground mb-6">
                {mode === 'login'
                  ? 'Sign in to continue to your projects'
                  : mode === 'signup'
                    ? 'Start creating amazing videos'
                    : 'Enter your email to receive a reset link'}
              </p>
            </motion.div>
          </AnimatePresence>

          <form action={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor={emailId}
                className="text-sm font-medium text-foreground"
              >
                Email
              </label>
              <Input
                id={emailId}
                name="email"
                type="email"
                placeholder="you@example.com"
                required
                disabled={isLoading}
                className="h-10 bg-background/50"
              />
            </div>

            {mode !== 'forgot' && (
              <div className="space-y-2">
                <label
                  htmlFor={passwordId}
                  className="text-sm font-medium text-foreground"
                >
                  Password
                </label>
                <Input
                  id={passwordId}
                  name="password"
                  type="password"
                  placeholder="••••••••"
                  required
                  minLength={6}
                  disabled={isLoading}
                  className="h-10 bg-background/50"
                />
              </div>
            )}

            {mode === 'login' && (
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => setMode('forgot')}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Forgot password?
                </button>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-10 mt-2"
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : mode === 'login' ? (
                'Sign in'
              ) : mode === 'signup' ? (
                'Create account'
              ) : (
                'Send reset link'
              )}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() =>
                setMode(mode === 'login' ? 'signup' : 'login')
              }
              disabled={isLoading}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {mode === 'forgot' ? (
                <>
                  Back to{' '}
                  <span className="text-foreground font-medium">Sign in</span>
                </>
              ) : mode === 'login' ? (
                <>
                  Don&apos;t have an account?{' '}
                  <span className="text-foreground font-medium">Sign up</span>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <span className="text-foreground font-medium">Sign in</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Footer */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-xs text-muted-foreground/60 text-center mt-6"
        >
          By continuing, you agree to our terms of service
        </motion.p>
      </motion.div>
    </div>
  );
}
