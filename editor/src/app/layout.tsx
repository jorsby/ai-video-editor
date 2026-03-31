import { Toaster } from '@/components/ui/sonner';
import { BackgroundPostCheck } from '@/components/background-post-check';
import type { Metadata } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import './globals.css';

const fontVariables = {
  '--font-geist-sans':
    'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
  '--font-geist-mono':
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace',
} as CSSProperties;

export const metadata: Metadata = {
  title: 'Combo',
  description: 'AI-powered video editor',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="dark antialiased" style={fontVariables}>
        {children}
        <Toaster />
        <BackgroundPostCheck />
      </body>
    </html>
  );
}
