'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Send,
  Loader2,
  Users,
  MapPin,
  Package,
  Clapperboard,
  BookOpen,
  CheckCircle2,
  Settings,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface PlanCharacter {
  name: string;
  role?: string;
  description?: string;
  personality?: string;
  relationships?: string;
  appearance?: string;
}

interface PlanLocation {
  name: string;
  description?: string;
  atmosphere?: string;
}

interface PlanProp {
  name: string;
  description?: string;
}

interface PlanEpisode {
  number: number;
  title?: string;
  synopsis?: string;
  featured_characters?: string[];
}

interface SeriesPlan {
  bible?: string;
  characters?: PlanCharacter[];
  locations?: PlanLocation[];
  props?: PlanProp[];
  episodes?: PlanEpisode[];
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  seriesId: string;
  seriesName: string;
  seriesGenre?: string | null;
  seriesTone?: string | null;
  initialMessages: ChatMessage[];
  initialPlan: SeriesPlan | null;
}

// ── Bible section ──────────────────────────────────────────────────────────────

function BibleSection({ bible }: { bible: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <BookOpen className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">Series Bible</span>
        </div>
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        )}
      </button>
      {expanded && (
        <div className="p-3">
          <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {bible}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Character card ─────────────────────────────────────────────────────────────

function CharacterCard({ char }: { char: PlanCharacter }) {
  const roleColor: Record<string, string> = {
    main: 'bg-primary/10 text-primary border-primary/20',
    supporting: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    extra: 'bg-muted text-muted-foreground border-border',
  };
  const colorClass = roleColor[char.role ?? ''] ?? roleColor.extra;
  return (
    <div className="border border-border/50 rounded-lg p-3 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold">{char.name}</p>
        {char.role && (
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0 ${colorClass}`}
          >
            {char.role}
          </span>
        )}
      </div>
      {char.description && (
        <p className="text-[11px] text-muted-foreground line-clamp-2">
          {char.description}
        </p>
      )}
      {char.appearance && (
        <p className="text-[11px] text-muted-foreground/70 italic line-clamp-1">
          {char.appearance}
        </p>
      )}
    </div>
  );
}

// ── Location card ──────────────────────────────────────────────────────────────

function LocationCard({ loc }: { loc: PlanLocation }) {
  return (
    <div className="border border-border/50 rounded-lg p-3 space-y-1">
      <p className="text-xs font-semibold">{loc.name}</p>
      {loc.description && (
        <p className="text-[11px] text-muted-foreground line-clamp-2">
          {loc.description}
        </p>
      )}
      {loc.atmosphere && (
        <p className="text-[11px] text-muted-foreground/60 italic">
          {loc.atmosphere}
        </p>
      )}
    </div>
  );
}

// ── Episode row ────────────────────────────────────────────────────────────────

function EpisodeRow({ ep }: { ep: PlanEpisode }) {
  return (
    <div className="border border-border/50 rounded-lg px-3 py-2.5 space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-muted-foreground w-6">
          {ep.number}
        </span>
        <p className="text-xs font-semibold">
          {ep.title ?? `Episode ${ep.number}`}
        </p>
      </div>
      {ep.synopsis && (
        <p className="text-[11px] text-muted-foreground line-clamp-3 pl-8">
          {ep.synopsis}
        </p>
      )}
    </div>
  );
}

// ── Live Plan Preview ──────────────────────────────────────────────────────────

function LivePlanPreview({ plan }: { plan: SeriesPlan | null }) {
  const characters = plan?.characters ?? [];
  const locations = plan?.locations ?? [];
  const props = plan?.props ?? [];
  const episodes = plan?.episodes ?? [];
  const hasPlan =
    characters.length > 0 || locations.length > 0 || episodes.length > 0;

  if (!hasPlan) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-12 px-6">
        <Clapperboard className="w-10 h-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm font-medium text-muted-foreground">
          Plan Preview
        </p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          Your series plan will appear here as you chat
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 overflow-y-auto h-full">
      {/* Bible */}
      {plan?.bible && <BibleSection bible={plan.bible} />}

      {/* Characters */}
      {characters.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <Users className="w-3.5 h-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Characters ({characters.length})
            </h3>
          </div>
          <div className="grid grid-cols-1 gap-2">
            {characters.map((char, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: plan items don't have stable IDs
              <CharacterCard key={i} char={char} />
            ))}
          </div>
        </section>
      )}

      {/* Locations */}
      {locations.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Locations ({locations.length})
            </h3>
          </div>
          <div className="grid grid-cols-1 gap-2">
            {locations.map((loc, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: plan items don't have stable IDs
              <LocationCard key={i} loc={loc} />
            ))}
          </div>
        </section>
      )}

      {/* Props */}
      {props.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <Package className="w-3.5 h-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Props ({props.length})
            </h3>
          </div>
          <div className="space-y-1.5">
            {props.map((prop, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: plan items don't have stable IDs
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="font-medium shrink-0">{prop.name}</span>
                {prop.description && (
                  <span className="text-muted-foreground line-clamp-1">
                    {prop.description}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Episodes */}
      {episodes.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <Clapperboard className="w-3.5 h-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Episodes ({episodes.length})
            </h3>
          </div>
          <div className="space-y-2">
            {episodes.map((ep, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: plan items don't have stable IDs
              <EpisodeRow key={i} ep={ep} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Chat message ───────────────────────────────────────────────────────────────

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';

  // Parse content: if assistant, try to extract just the "message" field
  let displayContent = msg.content;
  if (!isUser) {
    try {
      const parsed = JSON.parse(msg.content);
      if (parsed.message) displayContent = parsed.message;
    } catch {
      // raw text
    }
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : 'bg-muted text-foreground rounded-bl-sm'
        }`}
      >
        {displayContent}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function SeriesPlanningView({
  seriesId,
  seriesName,
  seriesGenre,
  seriesTone,
  initialMessages,
  initialPlan,
}: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [plan, setPlan] = useState<SeriesPlan | null>(initialPlan);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Edit series meta state ─────────────────────────────────────────────────
  const [currentName, setCurrentName] = useState(seriesName);
  const [currentGenre, setCurrentGenre] = useState(seriesGenre ?? '');
  const [currentTone, setCurrentTone] = useState(seriesTone ?? '');
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editName, setEditName] = useState(seriesName);
  const [editGenre, setEditGenre] = useState(seriesGenre ?? '');
  const [editTone, setEditTone] = useState(seriesTone ?? '');
  const [savingMeta, setSavingMeta] = useState(false);

  const openEditDialog = () => {
    setEditName(currentName);
    setEditGenre(currentGenre);
    setEditTone(currentTone);
    setShowEditDialog(true);
  };

  const saveMeta = async () => {
    if (!editName.trim()) return;
    setSavingMeta(true);
    try {
      await fetch(`/api/series/${seriesId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          genre: editGenre.trim() || null,
          tone: editTone.trim() || null,
        }),
      });
      setCurrentName(editName.trim());
      setCurrentGenre(editGenre.trim());
      setCurrentTone(editTone.trim());
      setShowEditDialog(false);
    } finally {
      setSavingMeta(false);
    }
  };

  const canFinalize =
    (plan?.characters?.length ?? 0) >= 1 && (plan?.episodes?.length ?? 0) >= 1;

  // Auto-scroll chat to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Auto-start chat if no messages yet
  useEffect(() => {
    if (messages.length === 0) {
      sendMessage('Hello! I want to create a new series.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isSending) return;

      const userMsg: ChatMessage = { role: 'user', content: text.trim() };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setIsSending(true);
      setIsTyping(true);

      try {
        const res = await fetch(`/api/series/${seriesId}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text.trim() }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error ?? 'Failed to send message');
        }

        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: data.message,
        };
        setMessages((prev) => [...prev, assistantMsg]);
        if (data.plan) setPlan(data.plan);
      } catch (err) {
        console.error('Chat error:', err);
        const errorMsg: ChatMessage = {
          role: 'assistant',
          content: 'Sorry, something went wrong. Please try again.',
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsSending(false);
        setIsTyping(false);
      }
    },
    [seriesId, isSending]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleFinalize = async () => {
    if (!canFinalize) return;
    setIsFinalizing(true);
    setFinalizeError(null);

    try {
      const res = await fetch(`/api/series/${seriesId}/finalize`, {
        method: 'POST',
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? 'Failed to finalize series');
      }

      // Redirect to series list (which will now show the finalized series detail)
      router.push('/series');
    } catch (err) {
      setFinalizeError(
        err instanceof Error ? err.message : 'Finalization failed'
      );
      setIsFinalizing(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Top bar: back + series title */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border/50 shrink-0">
        <Link href="/series">
          <Button variant="ghost" size="sm" className="gap-1.5">
            <ArrowLeft className="w-4 h-4" />
            Back to Series
          </Button>
        </Link>
        <div className="flex items-center gap-2 ml-2">
          <span className="text-sm font-semibold">{currentName}</span>
          {currentGenre && (
            <Badge variant="secondary" className="text-xs">
              {currentGenre}
            </Badge>
          )}
          {currentTone && (
            <Badge variant="outline" className="text-xs">
              {currentTone}
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
            onClick={openEditDialog}
            title="Edit series settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Split view */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Chat */}
        <div className="w-1/2 flex flex-col border-r border-border/50">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && !isTyping && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {messages.map((msg, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: chat messages indexed by position
              <ChatBubble key={i} msg={msg} />
            ))}
            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <form
            onSubmit={handleSubmit}
            className="p-4 border-t border-border/50"
          >
            <div className="flex gap-2 items-end">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Tell me about your series..."
                rows={2}
                className="resize-none flex-1"
                disabled={isSending}
              />
              <Button
                type="submit"
                size="sm"
                disabled={!input.trim() || isSending}
                className="h-10 w-10 p-0 shrink-0"
              >
                {isSending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground/50 mt-1">
              Press Enter to send · Shift+Enter for new line
            </p>
          </form>
        </div>

        {/* Right: Live Plan */}
        <div className="w-1/2 overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between shrink-0">
            <h2 className="text-sm font-semibold">{currentName} — Live Plan</h2>
            {plan && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {(plan.characters?.length ?? 0) > 0 && (
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {plan.characters?.length}
                  </span>
                )}
                {(plan.episodes?.length ?? 0) > 0 && (
                  <span className="flex items-center gap-1">
                    <Clapperboard className="w-3 h-3" />
                    {plan.episodes?.length} ep
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex-1 overflow-hidden">
            <LivePlanPreview plan={plan} />
          </div>
        </div>
      </div>

      {/* Edit Series Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Series</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Series name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              autoFocus
            />
            <Input
              placeholder="Genre (e.g. Drama)"
              value={editGenre}
              onChange={(e) => setEditGenre(e.target.value)}
            />
            <Input
              placeholder="Tone (e.g. Dark comedy)"
              value={editTone}
              onChange={(e) => setEditTone(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={saveMeta}
              disabled={savingMeta || !editName.trim()}
            >
              {savingMeta ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bottom bar: Finalize */}
      <div className="px-6 py-3 border-t border-border/50 bg-background/80 backdrop-blur-sm flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          {canFinalize ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span className="text-xs text-muted-foreground">
                Plan ready — {plan?.characters?.length} characters,{' '}
                {plan?.episodes?.length} episodes
              </span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">
              Keep chatting to build your plan (need at least 1 character + 1
              episode)
            </span>
          )}
          {finalizeError && (
            <span className="text-xs text-destructive ml-2">
              {finalizeError}
            </span>
          )}
        </div>
        <Button
          onClick={handleFinalize}
          disabled={!canFinalize || isFinalizing}
          className="gap-2"
        >
          {isFinalizing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Finalizing...
            </>
          ) : (
            <>
              <Clapperboard className="w-4 h-4" />
              Finalize Series
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
