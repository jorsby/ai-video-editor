'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  IconChevronDown,
  IconChevronUp,
  IconLoader2,
  IconRefresh,
  IconX,
} from '@tabler/icons-react';
import type {
  StoryboardPlan,
  RefPlan,
  StoryboardMode,
  VideoModel,
  KlingO3RefPlan,
} from '@/lib/supabase/workflow-service';

interface DraftPlanEditorProps {
  plan: StoryboardPlan | RefPlan;
  mode?: StoryboardMode;
  videoModel?: VideoModel | null;
  onPlanChange?: (plan: StoryboardPlan | RefPlan) => void;
  onApprove?: () => void;
  onRegenerate?: () => void;
  onCancel?: () => void;
  isApproving?: boolean;
  error?: string | null;
  readOnly?: boolean;
}

function isRefPlan(plan: StoryboardPlan | RefPlan): plan is RefPlan {
  return 'scene_prompts' in plan;
}

function isKlingPlan(plan: RefPlan): plan is KlingO3RefPlan {
  return 'objects' in plan;
}

export function DraftPlanEditor({
  plan,
  mode = 'image_to_video',
  videoModel,
  onPlanChange,
  onApprove,
  onRegenerate,
  onCancel,
  isApproving,
  error,
  readOnly,
}: DraftPlanEditorProps) {
  const [expandedScenes, setExpandedScenes] = useState<Set<number>>(new Set());
  const [isGridPromptOpen, setIsGridPromptOpen] = useState(false);
  const [isBgGridPromptOpen, setIsBgGridPromptOpen] = useState(false);
  const [isObjectsOpen, setIsObjectsOpen] = useState(false);
  const [isBgNamesOpen, setIsBgNamesOpen] = useState(false);

  const LANGUAGES = { en: 'English', tr: 'Turkish', ar: 'Arabic' } as const;

  const ref = isRefPlan(plan);
  const sceneCount = ref
    ? plan.scene_prompts.length
    : (plan.voiceover_list?.en?.length ?? 0);

  const toggleSceneExpanded = (index: number) => {
    const newExpanded = new Set(expandedScenes);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedScenes(newExpanded);
  };

  // --- I2V handlers ---
  const handleVoiceoverChange = (
    index: number,
    language: keyof typeof LANGUAGES,
    value: string
  ) => {
    const newList = {
      ...plan.voiceover_list,
      [language]: [...plan.voiceover_list[language]],
    };
    newList[language][index] = value;
    onPlanChange?.({ ...plan, voiceover_list: newList } as typeof plan);
  };

  const handleVisualFlowChange = (index: number, value: string) => {
    if (ref) return;
    const i2vPlan = plan as StoryboardPlan;
    const newList = [...i2vPlan.visual_flow];
    newList[index] = value;
    onPlanChange?.({ ...i2vPlan, visual_flow: newList });
  };

  const handleGridPromptChange = (value: string) => {
    if (ref) {
      onPlanChange?.({ ...plan, objects_grid_prompt: value } as RefPlan);
    } else {
      onPlanChange?.({
        ...(plan as StoryboardPlan),
        grid_image_prompt: value,
      });
    }
  };

  // --- Ref-specific handlers ---
  const handleBgGridPromptChange = (value: string) => {
    if (!ref) return;
    onPlanChange?.({ ...plan, backgrounds_grid_prompt: value } as RefPlan);
  };

  const handleScenePromptChange = (index: number, value: string) => {
    if (!ref) return;
    const newPrompts = [...(plan as RefPlan).scene_prompts];
    newPrompts[index] = value;
    onPlanChange?.({ ...plan, scene_prompts: newPrompts } as RefPlan);
  };

  // --- Ref plan header info ---
  const refPlan = ref ? (plan as RefPlan) : null;
  const objectNames = refPlan
    ? isKlingPlan(refPlan)
      ? refPlan.objects.map((o) => o.name)
      : refPlan.object_names
    : [];

  // --- Render ---
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-none p-3 border-b border-border/50">
        {ref ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {refPlan!.objects_rows}x{refPlan!.objects_cols} objects ·{' '}
              {refPlan!.bg_rows}x{refPlan!.bg_cols} backgrounds · {sceneCount}{' '}
              scenes
            </span>
            {videoModel && (
              <span className="text-xs px-1.5 py-0.5 bg-blue-500/10 text-blue-500 rounded">
                {videoModel === 'klingo3'
                  ? 'Kling O3'
                  : videoModel === 'klingo3pro'
                    ? 'Kling O3 Pro'
                    : 'WAN 2.6'}
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            {(plan as StoryboardPlan).rows}x{(plan as StoryboardPlan).cols} grid
            · {sceneCount} scenes
          </span>
        )}
      </div>

      {/* Scrollable content */}
      <ScrollArea className="flex-1">
        <div className="p-3 flex flex-col gap-3">
          {/* Error display */}
          {error && !readOnly && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Objects Grid Prompt (ref) / Grid Image Prompt (i2v) */}
          <Collapsible
            open={isGridPromptOpen}
            onOpenChange={setIsGridPromptOpen}
          >
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-between h-8 text-xs text-muted-foreground hover:text-foreground"
              >
                {ref ? 'Objects Grid Prompt' : 'Grid Image Prompt'}
                {isGridPromptOpen ? (
                  <IconChevronUp className="size-3" />
                ) : (
                  <IconChevronDown className="size-3" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Textarea
                value={
                  ref
                    ? (plan as RefPlan).objects_grid_prompt
                    : (plan as StoryboardPlan).grid_image_prompt
                }
                onChange={(e) => handleGridPromptChange(e.target.value)}
                readOnly={readOnly}
                className="text-xs min-h-[100px] mt-1"
                placeholder={
                  ref
                    ? 'Objects grid image prompt...'
                    : 'Grid image generation prompt...'
                }
              />
            </CollapsibleContent>
          </Collapsible>

          {/* Backgrounds Grid Prompt (ref only) */}
          {ref && (
            <Collapsible
              open={isBgGridPromptOpen}
              onOpenChange={setIsBgGridPromptOpen}
            >
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-between h-8 text-xs text-muted-foreground hover:text-foreground"
                >
                  Backgrounds Grid Prompt
                  {isBgGridPromptOpen ? (
                    <IconChevronUp className="size-3" />
                  ) : (
                    <IconChevronDown className="size-3" />
                  )}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <Textarea
                  value={refPlan!.backgrounds_grid_prompt}
                  onChange={(e) => handleBgGridPromptChange(e.target.value)}
                  readOnly={readOnly}
                  className="text-xs min-h-[100px] mt-1"
                  placeholder="Backgrounds grid image prompt..."
                />
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Objects List (ref only) */}
          {ref && (
            <Collapsible open={isObjectsOpen} onOpenChange={setIsObjectsOpen}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-between h-8 text-xs text-muted-foreground hover:text-foreground"
                >
                  Objects ({objectNames.length})
                  {isObjectsOpen ? (
                    <IconChevronUp className="size-3" />
                  ) : (
                    <IconChevronDown className="size-3" />
                  )}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-1 flex flex-col gap-1">
                  {objectNames.map((name, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 px-2 py-1 bg-secondary/30 rounded text-xs"
                    >
                      <span className="text-muted-foreground w-4">{i}</span>
                      <span className="font-medium">{name}</span>
                      {isKlingPlan(refPlan!) && (
                        <span className="text-muted-foreground truncate">
                          — {(refPlan as KlingO3RefPlan).objects[i].description}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Backgrounds List (ref only) */}
          {ref && (
            <Collapsible open={isBgNamesOpen} onOpenChange={setIsBgNamesOpen}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-between h-8 text-xs text-muted-foreground hover:text-foreground"
                >
                  Backgrounds ({refPlan!.background_names.length})
                  {isBgNamesOpen ? (
                    <IconChevronUp className="size-3" />
                  ) : (
                    <IconChevronDown className="size-3" />
                  )}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-1 flex flex-col gap-1">
                  {refPlan!.background_names.map((name, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 px-2 py-1 bg-secondary/30 rounded text-xs"
                    >
                      <span className="text-muted-foreground w-4">{i}</span>
                      <span>{name}</span>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Scene List */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Scenes
            </span>
            {Array.from({ length: sceneCount }).map((_, index) => {
              const isExpanded = expandedScenes.has(index);
              const enText = plan.voiceover_list.en[index] || '';

              // Ref scene info
              const sceneObjIndices = ref
                ? refPlan!.scene_object_indices[index]
                : [];
              const sceneBgIdx = ref ? refPlan!.scene_bg_indices[index] : 0;

              return (
                <div
                  key={index}
                  className="border border-border/50 rounded-md overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => toggleSceneExpanded(index)}
                    className="w-full flex items-center justify-between p-2 hover:bg-secondary/30 transition-colors"
                  >
                    <span className="text-xs font-medium">
                      Scene {index + 1}
                    </span>
                    <div className="flex items-center gap-2">
                      {ref && (
                        <span className="text-[10px] text-muted-foreground">
                          {sceneObjIndices
                            .map((i) => objectNames[i])
                            .join(', ')}
                          {' + '}
                          {refPlan!.background_names[sceneBgIdx]}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                        {enText.slice(0, 25)}
                        {enText.length > 25 ? '...' : ''}
                      </span>
                      {isExpanded ? (
                        <IconChevronUp className="size-3" />
                      ) : (
                        <IconChevronDown className="size-3" />
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="p-2 pt-0 flex flex-col gap-2 border-t border-border/30">
                      {/* Scene prompt (ref only) */}
                      {ref && (
                        <div>
                          <label className="text-xs text-muted-foreground block mb-1">
                            Scene Prompt
                          </label>
                          <Textarea
                            value={refPlan!.scene_prompts[index] || ''}
                            onChange={(e) =>
                              handleScenePromptChange(index, e.target.value)
                            }
                            readOnly={readOnly}
                            className="text-xs min-h-[60px]"
                            placeholder="Scene prompt with {object_N} and {bg} placeholders..."
                          />
                          <div className="mt-1 flex flex-wrap gap-1">
                            {sceneObjIndices.map((objIdx) => (
                              <span
                                key={objIdx}
                                className="text-[10px] px-1.5 py-0.5 bg-blue-500/10 text-blue-500 rounded"
                              >
                                {'{object_'}
                                {sceneObjIndices.indexOf(objIdx) + 1}
                                {'}'} = {objectNames[objIdx]}
                              </span>
                            ))}
                            <span className="text-[10px] px-1.5 py-0.5 bg-green-500/10 text-green-500 rounded">
                              {'{bg}'} = {refPlan!.background_names[sceneBgIdx]}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Voiceovers */}
                      {(
                        Object.keys(LANGUAGES) as (keyof typeof LANGUAGES)[]
                      ).map((lang) => (
                        <div key={lang}>
                          <label className="text-xs text-muted-foreground block mb-1">
                            {LANGUAGES[lang]}
                          </label>
                          <Textarea
                            value={plan.voiceover_list[lang][index] || ''}
                            onChange={(e) =>
                              handleVoiceoverChange(index, lang, e.target.value)
                            }
                            readOnly={readOnly}
                            className="text-xs min-h-[60px]"
                            placeholder={`${LANGUAGES[lang]} voiceover...`}
                          />
                        </div>
                      ))}

                      {/* Visual Prompt (i2v only) */}
                      {!ref && (
                        <div>
                          <label className="text-xs text-muted-foreground block mb-1">
                            Visual Prompt
                          </label>
                          <Textarea
                            value={
                              (plan as StoryboardPlan).visual_flow[index] || ''
                            }
                            onChange={(e) =>
                              handleVisualFlowChange(index, e.target.value)
                            }
                            readOnly={readOnly}
                            className="text-xs min-h-[60px]"
                            placeholder="Visual/motion prompt for video generation..."
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </ScrollArea>

      {/* Action buttons (hidden in read-only mode) */}
      {!readOnly && (
        <div className="flex-none p-3 border-t border-border/50">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={isApproving}
              className="h-8"
            >
              <IconX className="size-3 mr-1" />
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onRegenerate}
              disabled={isApproving}
              className="h-8"
            >
              <IconRefresh className="size-3 mr-1" />
              Regenerate
            </Button>
            <Button
              size="sm"
              onClick={onApprove}
              disabled={isApproving}
              className="h-8 flex-1"
            >
              {isApproving ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : ref ? (
                'Generate Grids'
              ) : (
                'Generate Scenes'
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
