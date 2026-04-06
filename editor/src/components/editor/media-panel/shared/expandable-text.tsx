'use client';

import { useEffect, useRef, useState } from 'react';
import { CopyButton } from './copy-button';

export function ExpandableText({
  text,
  label,
  italic = false,
  clampLines = 2,
}: {
  text: string;
  label: string;
  italic?: boolean;
  clampLines?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  const [isClamped, setIsClamped] = useState(false);

  useEffect(() => {
    const el = textRef.current;
    if (el) {
      setIsClamped(el.scrollHeight > el.clientHeight + 1);
    }
  }, [text]);

  return (
    <div className="group/expandable relative">
      <p
        ref={textRef}
        onClick={() => isClamped && setExpanded(!expanded)}
        className={`text-[11px] text-muted-foreground leading-relaxed ${
          italic ? 'italic' : ''
        } ${isClamped ? 'cursor-pointer' : ''}`}
        style={
          !expanded
            ? {
                display: '-webkit-box',
                WebkitLineClamp: clampLines,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }
            : undefined
        }
      >
        {italic ? <>&ldquo;{text}&rdquo;</> : text}
      </p>
      <div className="flex items-center gap-1 mt-0.5">
        {isClamped && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-[9px] text-primary/70 hover:text-primary transition-colors"
          >
            {expanded ? 'Show less' : 'Show more...'}
          </button>
        )}
        <CopyButton text={text} />
      </div>
    </div>
  );
}
