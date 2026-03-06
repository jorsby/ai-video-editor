'use client';

import { cn } from '@/lib/utils';
import { TEMPLATE_LIST, type TemplateConfig } from '@/lib/templates';

const STYLE_COLORS: Record<string, string> = {
  documentary: 'bg-blue-500/20 border-blue-500/40',
  'bold-impact': 'bg-red-500/20 border-red-500/40',
  minimal: 'bg-gray-500/20 border-gray-500/40',
};

interface TemplatePickerProps {
  selectedTemplateId: string | null;
  onSelect: (template: TemplateConfig) => void;
  className?: string;
}

export function TemplatePicker({
  selectedTemplateId,
  onSelect,
  className,
}: TemplatePickerProps) {
  return (
    <div className={cn('grid grid-cols-3 gap-2', className)}>
      {TEMPLATE_LIST.map((template) => {
        const isSelected = selectedTemplateId === template.id;
        return (
          <button
            key={template.id}
            type="button"
            className={cn(
              'flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-colors text-center',
              'hover:bg-secondary/40',
              isSelected
                ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
                : 'border-border/50 bg-secondary/20'
            )}
            onClick={() => onSelect(template)}
          >
            <div
              className={cn(
                'w-10 h-10 rounded-md border',
                STYLE_COLORS[template.id] || 'bg-secondary/30 border-border/50'
              )}
            />
            <span className="text-[11px] font-medium leading-tight">
              {template.name}
            </span>
            <span className="text-[9px] text-muted-foreground leading-tight line-clamp-2">
              {template.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
