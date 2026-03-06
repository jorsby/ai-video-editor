'use client';

import { useState } from 'react';
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  ExternalLinkIcon,
  GlobeIcon,
  LoaderIcon,
  SearchIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface TavilyResult {
  title: string;
  url: string;
  content?: string;
  excerpts?: string[];
  score?: number;
  raw_content?: string;
  publish_date?: string | null;
}

interface TavilySearchResult {
  query?: string;
  results?: TavilyResult[];
  answer?: {
    results?: TavilyResult[];
  };
}

interface WebSearchToolArgs {
  query?: string;
  search_depth?: string;
  max_results?: number;
}

function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch {
    return url;
  }
}

function getFaviconUrl(url: string): string {
  const domain = extractDomain(url);
  // Use Google's favicon service - reliable and free
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

function SiteFavicon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const domain = extractDomain(url);

  if (failed) {
    return <GlobeIcon className="size-5 text-muted-foreground" />;
  }

  return (
    <img
      src={getFaviconUrl(url)}
      alt={`${domain} icon`}
      className="size-5 rounded-sm"
      onError={() => setFailed(true)}
    />
  );
}

function getSnippet(result: TavilyResult): string {
  if (result.content) return result.content;
  if (result.excerpts && result.excerpts.length > 0) {
    return result.excerpts[0];
  }
  return '';
}

function SearchResultCard({
  result,
  isExpanded,
  onToggleExpand,
}: {
  result: TavilyResult;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const snippet = getSnippet(result);
  const domain = extractDomain(result.url);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="group rounded-lg border bg-card/30 transition-colors hover:bg-card/60">
      <div className="flex gap-3 p-3">
        {/* Site Favicon */}
        <div className="hidden sm:flex size-10 shrink-0 items-center justify-center rounded-md bg-muted/50">
          <SiteFavicon url={result.url} />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          {/* Domain with favicon (mobile) + Title */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="sm:hidden">
              <SiteFavicon url={result.url} />
            </span>
            <span>{domain}</span>
          </div>

          {/* Title with link */}
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group/link mt-0.5 inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="line-clamp-1">{result.title}</span>
            <ExternalLinkIcon className="size-3 shrink-0 opacity-0 transition-opacity group-hover/link:opacity-100" />
          </a>

          {/* Snippet */}
          <p
            className={cn(
              'mt-1.5 text-xs text-muted-foreground/80 leading-relaxed',
              isExpanded ? '' : 'line-clamp-2'
            )}
          >
            {snippet}
          </p>

          {/* Expand / Actions row */}
          <div className="mt-2 flex items-center gap-1">
            {snippet.length > 150 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand();
                }}
              >
                {isExpanded ? 'Show less' : 'Show more'}
              </Button>
            )}

            <div className="ml-auto opacity-0 transition-opacity group-hover:opacity-100">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={handleCopy}
              >
                {copied ? (
                  <>
                    <CheckIcon className="size-3" />
                    Copied
                  </>
                ) : (
                  <>
                    <CopyIcon className="size-3" />
                    Copy
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const WebSearchTool: ToolCallMessagePartComponent<WebSearchToolArgs> = ({
  args,
  result,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set());

  // Check if still loading (no result yet)
  const isLoading = result === undefined;

  // Parse the result - handle both direct results and nested answer.results
  let searchResults: TavilyResult[] = [];
  let searchQuery = args?.query || '';

  if (result) {
    const parsed =
      typeof result === 'string'
        ? (JSON.parse(result) as TavilySearchResult)
        : (result as TavilySearchResult);

    searchResults = parsed.results || parsed.answer?.results || [];
    searchQuery = parsed.query || searchQuery;
  }

  const toggleCardExpand = (index: number) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const resultCount = searchResults.length;

  return (
    <div className="aui-tool-container mb-4 flex w-full flex-col gap-3 rounded-xl border bg-card/50">
      {/* Header */}
      <button
        type="button"
        className="flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
        onClick={() => setIsCollapsed(!isCollapsed)}
        disabled={isLoading}
      >
        <div className="flex size-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
          {isLoading ? (
            <LoaderIcon className="size-4 animate-spin" />
          ) : (
            <SearchIcon className="size-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Web Search</p>
          <p className="truncate text-xs text-muted-foreground">
            {isLoading ? (
              <span className="flex items-center gap-1.5">
                Searching for "{searchQuery}"...
              </span>
            ) : (
              <>
                {searchQuery ? `"${searchQuery}"` : 'Search'}{' '}
                {resultCount > 0 &&
                  `• ${resultCount} result${resultCount !== 1 ? 's' : ''}`}
              </>
            )}
          </p>
        </div>
        {!isLoading && (
          <div className="flex size-8 items-center justify-center text-muted-foreground">
            {isCollapsed ? (
              <ChevronDownIcon className="size-4" />
            ) : (
              <ChevronUpIcon className="size-4" />
            )}
          </div>
        )}
      </button>

      {/* Loading bar */}
      {isLoading && <div className="h-1 w-full animate-pulse bg-blue-500/30" />}

      {/* Results */}
      {!isCollapsed && !isLoading && (
        <div className="flex flex-col gap-2 border-t px-3 pb-3 pt-2">
          {searchResults.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No results found
            </p>
          ) : (
            searchResults.map((searchResult, index) => (
              <SearchResultCard
                key={`${searchResult.url}-${index}`}
                result={searchResult}
                isExpanded={expandedCards.has(index)}
                onToggleExpand={() => toggleCardExpand(index)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};
