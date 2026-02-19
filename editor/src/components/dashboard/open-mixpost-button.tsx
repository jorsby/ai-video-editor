'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ExternalLink, Loader2 } from 'lucide-react';

export function OpenMixpostButton() {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch('/api/mixpost/auto-login', { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        console.error('Auto-login failed:', data.error);
        return;
      }

      window.open(data.url, '_blank');
    } catch (error) {
      console.error('Auto-login error:', error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleClick} disabled={loading}>
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <ExternalLink className="w-4 h-4" />
      )}
      <span className="ml-1.5">Mixpost</span>
    </Button>
  );
}
