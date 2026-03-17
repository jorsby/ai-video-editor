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
  Wan26FlashRefPlan,
  SceneDialogueLine,
} from '@/lib/supabase/workflow-service';
import { getLanguageName } from '@/lib/constants/languages';

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
  hideAssetSections?: boolean;
}

function isRefPlan(plan: StoryboardPlan | RefPlan): plan is RefPlan {
  return 'scene_prompts' in plan;
}

function isKlingPlan(plan: RefPlan): plan is KlingO3RefPlan {
  return 'objects' in plan;
}

function isWanPlan(plan: RefPlan): plan is Wan26FlashRefPlan {
  return 'scene_multi_shots' in plan || 'object_names' in plan;
}

function serializeSceneDialogue(
  lines: SceneDialogueLine[] | undefined
): string {
  if (!Array.isArray(lines) || lines.length === 0) return '';
  return lines.map((entry) => `${entry.speaker}: ${entry.line}`).join('\n');
}

function parseSceneDialogue(value: string): SceneDialogueLine[] {
  return value
    .split('\n')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((line) => {
      const colon = line.indexOf(':');
      if (colon <= 0) {
        return { speaker: 'Narrator', line };
      }

      const speaker = line.slice(0, colon).trim();
      const text = line.slice(colon + 1).trim();
      if (!speaker || !text) return null;
      return { speaker, line: text };
    })
    .filter((line): line is SceneDialogueLine => line !== null);
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
  hideAssetSections = false,
}: DraftPlanEditorProps) {
  const [expandedScenes, setExpandedScenes] = useState<Set<number>>(new Set());
  const [isGridPromptOpen, setIsGridPromptOpen] = useState(false);
  const [isBgGridPromptOpen, setIsBgGridPromptOpen] = useState(false);
  const [isObjectsOpen, setIsObjectsOpen] = useState(false);
  const [isBgNamesOpen, setIsBgNamesOpen] = useState(false);

  const ref = isRefPlan(plan);
  const sceneCount = ref
    ? plan.scene_prompts.length
    : (Object.values(plan.voiceover_list ?? {})[0]?.length ?? 0);

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
    language: string,
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

  const handleMultiShotsToggle = (index: number) => {
    if (!ref || !isWanPlan(plan as RefPlan)) return;
    const wanPlan = plan as Wan26FlashRefPlan;
    const current = wanPlan.scene_multi_shots ?? Array(sceneCount).fill(false);
    const newMultiShots = [...current];
    newMultiShots[index] = !newMultiShots[index];
    onPlanChange?.({ ...wanPlan, scene_multi_shots: newMultiShots });
  };

  const handleScenePromptChange = (
    index: number,
    value: string,
    shotIndex?: number
  ) => {
    if (!ref) return;
    const newPrompts = [...(plan as RefPlan).scene_prompts];
    if (shotIndex !== undefined && Array.isArray(newPrompts[index])) {
      const newShots = [...(newPrompts[index] as string[])];
      newShots[shotIndex] = value;
      newPrompts[index] = newShots;
    } else {
      newPrompts[index] = value;
    }
    onPlanChange?.({ ...plan, scene_prompts: newPrompts } as RefPlan);
  };

  // --- Ref plan header info ---
  const refPlan = ref ? (plan as RefPlan) : null;
  const objectNames: string[] = refPlan
    ? (refPlan.objects?.map((o) => o.name) ??
      ('object_names' in refPlan
        ? ((refPlan as Wan26FlashRefPlan).object_names ?? [])
        : []))
    : [];

  const refVideoMode =
    refPlan && 'video_mode' in refPlan
      ? (refPlan.video_mode ?? 'narrative')
      : 'narrative';
  const isDialogueMode =
    ref && isWanPlan(refPlan as RefPlan) && refVideoMode === 'dialogue_scene';

  const handleSceneDialogueChange = (index: number, value: string) => {
    if (!ref || !isWanPlan(plan as RefPlan)) return;

    const wanPlan = plan as Wan26FlashRefPlan;
    const newSceneDialogue = Array.from(
      { length: sceneCount },
      (_, i) => wanPlan.scene_dialogue?.[i] ?? []
    );

    const parsedLines = parseSceneDialogue(value).slice(0, 3);
    newSceneDialogue[index] = parsedLines;

    const sourceLanguage = Object.keys(wanPlan.voiceover_list)[0] ?? 'en';
    const nextVoiceovers = {
      ...wanPlan.voiceover_list,
      [sourceLanguage]: [...(wanPlan.voiceover_list[sourceLanguage] ?? [])],
    };

    nextVoiceovers[sourceLanguage][index] = parsedLines
      .map((line) => `${line.speaker}: ${line.line}`)
      .join(' ');

    onPlanChange?.({
      ...wanPlan,
      scene_dialogue: newSceneDialogue,
      voiceover_list: nextVoiceovers,
    });
  };

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
                {videoModel === 'skyreels'
                  ? 'SkyReels'
                  : videoModel === 'klingo3' || videoModel === 'klingo3pro'
                    ? 'Kling O3'
                    : 'WAN 2.6'}
              </span>
            )}
            {ref && isWanPlan(refPlan as RefPlan) && (
              <span className="text-xs px-1.5 py-0.5 bg-amber-500/10 text-amber-500 rounded">
                {isDialogueMode ? 'Dialogue Scene' : 'Narrative'}
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
          {(!ref || !hideAssetSections) && (
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
          )}

          {/* Backgrounds Grid Prompt (ref only) */}
          {ref && !hideAssetSections && (
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
          {ref && !hideAssetSections && (
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
                      {refPlan!.objects?.[i]?.description && (
                        <span className="text-muted-foreground truncate">
                          — {refPlan!.objects[i].description}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Backgrounds List (ref only) — moved to Assets tab */}
          {ref && !hideAssetSections && (
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
              const firstLang = Object.keys(plan.voiceover_list)[0] ?? 'en';
              const enText = plan.voiceover_list[firstLang]?.[index] || '';

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
                      {ref &&
                        isWanPlan(refPlan!) &&
                        (refPlan as Wan26FlashRefPlan).scene_multi_shots?.[
                          index
                        ] && (
                          <span className="text-[10px] px-1 py-0.5 bg-purple-500/10 text-purple-500 rounded font-medium">
                            MS
                          </span>
                        )}
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
                            {Array.isArray(refPlan!.scene_prompts[index]) && (
                              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 bg-cyan-500/10 text-cyan-500 rounded">
                                {
                                  (refPlan!.scene_prompts[index] as string[])
                                    .length
                                }
                                -shot
                              </span>
                            )}
                          </label>
                          {Array.isArray(refPlan!.scene_prompts[index]) ? (
                            <div className="flex flex-col gap-1.5">
                              {(refPlan!.scene_prompts[index] as string[]).map(
                                (shot, shotIdx) => (
                                  <div key={shotIdx}>
                                    <label className="text-[10px] text-muted-foreground block mb-0.5">
                                      Shot {shotIdx + 1}
                                    </label>
                                    <Textarea
                                      value={shot}
                                      onChange={(e) =>
                                        handleScenePromptChange(
                                          index,
                                          e.target.value,
                                          shotIdx
                                        )
                                      }
                                      readOnly={readOnly}
                                      className="text-xs min-h-[50px]"
                                      placeholder={`Shot ${shotIdx + 1} prompt...`}
                                    />
                                  </div>
                                )
                              )}
                            </div>
                          ) : (
                            <Textarea
                              value={
                                (refPlan!.scene_prompts[index] as string) || ''
                              }
                              onChange={(e) =>
                                handleScenePromptChange(index, e.target.value)
                              }
                              readOnly={readOnly}
                              className="text-xs min-h-[60px]"
                              placeholder={
                                videoModel === 'skyreels'
                                  ? 'Scene prompt using character names (no @Element syntax)...'
                                  : refPlan && isKlingPlan(refPlan)
                                    ? 'Scene prompt with @ElementN and @Image1 references...'
                                    : 'Scene prompt with @Element1 (bg) and @Element2+ (characters)...'
                              }
                            />
                          )}
                          <div className="mt-1 flex flex-wrap gap-1">
                            {videoModel === 'skyreels' ? (
                              <>
                                <span className="text-[10px] px-1.5 py-0.5 bg-green-500/10 text-green-500 rounded">
                                  BG: {refPlan!.background_names[sceneBgIdx]}
                                </span>
                                {sceneObjIndices.map((objIdx) => (
                                  <span
                                    key={objIdx}
                                    className="text-[10px] px-1.5 py-0.5 bg-blue-500/10 text-blue-500 rounded"
                                  >
                                    {objectNames[objIdx]}
                                  </span>
                                ))}
                              </>
                            ) : (
                              <>
                                <span className="text-[10px] px-1.5 py-0.5 bg-green-500/10 text-green-500 rounded">
                                  {isKlingPlan(refPlan!)
                                    ? '@Image1'
                                    : '@Element1'}{' '}
                                  = {refPlan!.background_names[sceneBgIdx]}
                                </span>
                                {sceneObjIndices.map((objIdx) => {
                                  const pos =
                                    sceneObjIndices.indexOf(objIdx) + 1;
                                  const isKling = isKlingPlan(refPlan!);
                                  return (
                                    <span
                                      key={objIdx}
                                      className="text-[10px] px-1.5 py-0.5 bg-blue-500/10 text-blue-500 rounded"
                                    >
                                      {isKling
                                        ? `@Element${pos}`
                                        : `@Element${pos + 1}`}{' '}
                                      = {objectNames[objIdx]}
                                    </span>
                                  );
                                })}
                              </>
                            )}
                          </div>
                          {isWanPlan(refPlan!) && (
                            <label className="mt-1.5 flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={
                                  (refPlan as Wan26FlashRefPlan)
                                    .scene_multi_shots?.[index] ?? false
                                }
                                onChange={() => handleMultiShotsToggle(index)}
                                disabled={readOnly}
                                className="size-3.5 rounded border-border accent-purple-500"
                              />
                              <span className="text-[10px] text-muted-foreground">
                                Multi-shot
                              </span>
                            </label>
                          )}
                        </div>
                      )}

                      {isDialogueMode && (
                        <div>
                          <label className="text-xs text-muted-foreground block mb-1">
                            Dialogue (Speaker: line)
                          </label>
                          <Textarea
                            value={serializeSceneDialogue(
                              (refPlan as Wan26FlashRefPlan).scene_dialogue?.[
                                index
                              ]
                            )}
                            onChange={(e) =>
                              handleSceneDialogueChange(index, e.target.value)
                            }
                            readOnly={readOnly}
                            className="text-xs min-h-[72px]"
                            placeholder={
                              'Mother: We only take what we need.\nBoy: Okay, mom.'
                            }
                          />
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            V1 uses visual dialogue + separate TTS track (no
                            lip-sync).
                          </p>
                        </div>
                      )}

                      {/* Voiceovers */}
                      {Object.keys(plan.voiceover_list).map((lang) => (
                        <div key={lang}>
                          <label className="text-xs text-muted-foreground block mb-1">
                            {getLanguageName(lang)}
                          </label>
                          <Textarea
                            value={plan.voiceover_list[lang]?.[index] || ''}
                            onChange={(e) =>
                              handleVoiceoverChange(index, lang, e.target.value)
                            }
                            readOnly={readOnly}
                            className="text-xs min-h-[60px]"
                            placeholder={`${getLanguageName(lang)} voiceover...`}
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
