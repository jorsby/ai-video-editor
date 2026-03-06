export type AEffectType =
  | 'glitch'
  | 'pixelate'
  | 'spring'
  | 'slitScan'
  | 'perspectiveSingle'
  | 'scaleMoveBlur'
  | 'retro70s'
  | 'fastZoom';

export type AMediaType =
  | 'Avatar'
  | 'Video'
  | 'Audio'
  | 'Image'
  | 'Text'
  | 'Effect';

export type ALayoutType = 'Stack' | 'Row' | 'Column';

export interface AMediaEffect {
  type: AEffectType;
  triggerWordIndex?: number; // 0 would start right away
  endWordIndex?: number; // -1 for to the end of the AScene
}

export interface ADimensions {
  width?: number;
  height?: number;
}

export interface AMedia {
  type: AMediaType;
  prompt: string;
  triggerWordIndex: number; // 0 would start right away
  endWordIndex: number; //-1 for to the end of the AScene
  zIndex: number;
  AMediaEffect?: AMediaEffect;
  enterEffect?: AMediaEffect;
  exitEffect?: AMediaEffect;
  ADimensions?: ADimensions;
}

export interface ALayout {
  type: ALayoutType;
  ADimensions?: ADimensions;
  background?: AMedia;
  ALayout?: ALayout[];
  AMedia?: AMedia[];
}

export interface AScene {
  id: string;
  order: number;
  text: string;
  ALayout: ALayout[];
}

export interface AContent {
  id: string;
  text: string;
  ADimensions: ADimensions;
  scenes?: AScene[];
}
// If the with and height is ndefined for a ALayout or a AMedia it will be inherited from the parents
const _john_duran = {
  id: 'a7c3e291-4f8b-4d2a-9e6c-8b1f3a5d7e9f',
  text: "John Duran has played in MLS, the Saudi Pro League, and is now destined for Turkey, all before turning 22. This man's career has already been bizarre. Age 15, Duran made his pro debut and by 17 was poached by MLS club Chicago Fire. After just one season in America, Duran was on his way to the Premier League. His potential was clear, and despite being Villa's second choice striker, the Colombian kept scoring important goals off the bench. In the 24-25 season, he was averaging a goal every 88 minutes. And these weren't just tap-ins either. Villa wanted to keep him, but when that Saudi money came in, both Villa and Duran couldn't say no. Yet, just 6 months following his Al-Nassr move, Duran already wants out and has found an interesting new destination in Mourinho's Fenerbahçe on loan. This deal is wild. Fenerbahçe is set to pay a sizable loan fee plus his full 20 mil annual salary, which is crazy considering this loan fee will be more expensive than their previous club record transfer of star striker Yusuf En-Nesyri for 19 mil. Duran's latest chapter is emblematic of his entire career.",
  dimensions: {
    width: 1080,
    height: 1920,
  },
  scenes: [
    {
      id: 'b2d4f6a8-1c3e-5b7d-9f0a-2e4c6d8b0a1c',
      order: 0,
      text: "John Duran has played in MLS, the Saudi Pro League, and is now destined for Turkey, all before turning 22. This man's career has already been bizarre.",
      layout: [
        {
          type: 'Column',
          dimensions: { width: 1080, height: 1920 },
          layout: [
            {
              type: 'Stack',
              dimensions: { width: 1080, height: 960 },
              background: {
                type: 'Image',
                prompt:
                  'A low-angle, cinematic view of a professional soccer stadium at night, focusing on the detailed green grass. Blurred crowd and bright stadium lights in the background.',
                triggerWordIndex: 0,
                endWordIndex: -1,
                zIndex: 0,
              },
              layout: [
                {
                  type: 'Row',
                  media: [
                    {
                      type: 'Image',
                      prompt:
                        'John Duran wearing MLS Chicago Fire Jersey. Portrait shot, transparent background.',
                      dimensions: { width: 540, height: 660 },
                      triggerWordIndex: 0,
                      endWordIndex: 7,
                      zIndex: 1,
                      enterEffect: {
                        type: 'spring',
                        triggerWordIndex: 0,
                        endWordIndex: 2,
                      },
                      exitEffect: {
                        type: 'scaleMoveBlur',
                        triggerWordIndex: 6,
                        endWordIndex: 7,
                      },
                    },
                    {
                      type: 'Image',
                      prompt:
                        'John Duran wearing Saudi Pro League Al-Nassr Jersey. Portrait shot, transparent background.',
                      dimensions: { width: 540, height: 660 },
                      triggerWordIndex: 8,
                      endWordIndex: 14,
                      zIndex: 2,
                      enterEffect: {
                        type: 'spring',
                        triggerWordIndex: 8,
                        endWordIndex: 10,
                      },
                      exitEffect: {
                        type: 'scaleMoveBlur',
                        triggerWordIndex: 13,
                        endWordIndex: 14,
                      },
                    },
                  ],
                },
              ],
              media: [
                {
                  type: 'Image',
                  prompt:
                    'John Duran wearing Fenerbahçe Jersey. Portrait shot, transparent background.',
                  dimensions: { width: 700, height: 700 },
                  triggerWordIndex: 15,
                  endWordIndex: 21,
                  zIndex: 3,
                  enterEffect: {
                    type: 'fastZoom',
                    triggerWordIndex: 15,
                    endWordIndex: 17,
                  },
                  exitEffect: {
                    type: 'glitch',
                    triggerWordIndex: 20,
                    endWordIndex: 21,
                  },
                },
                {
                  type: 'Image',
                  prompt:
                    'John Duran in Fenerbahçe Jersey, full body hero pose, dramatic lighting.',
                  dimensions: { width: 1080, height: 960 },
                  triggerWordIndex: 22,
                  endWordIndex: -1,
                  zIndex: 4,
                  enterEffect: {
                    type: 'perspectiveSingle',
                    triggerWordIndex: 22,
                    endWordIndex: 24,
                  },
                  mediaEffect: {
                    type: 'glitch',
                    triggerWordIndex: 26,
                    endWordIndex: -1,
                  },
                },
              ],
            },
            {
              type: 'Stack',
              dimensions: { width: 1080, height: 960 },
              media: [
                {
                  type: 'Avatar',
                  prompt: 'Sports commentator presenting news',
                  dimensions: { width: 1080, height: 960 },
                  triggerWordIndex: 0,
                  endWordIndex: -1,
                  zIndex: 0,
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'c3e5a7b9-2d4f-6c8e-0a1b-3f5d7e9c1b2d',
      order: 1,
      text: 'Age 15, Duran made his pro debut and by 17 was poached by MLS club Chicago Fire.',
      layout: [
        {
          type: 'Column',
          dimensions: { width: 1080, height: 1920 },
          layout: [
            {
              type: 'Stack',
              dimensions: { width: 1080, height: 960 },
              background: {
                type: 'Image',
                prompt:
                  'Colombian youth soccer academy field, sunny day, vibrant green grass.',
                triggerWordIndex: 0,
                endWordIndex: -1,
                zIndex: 0,
              },
              media: [
                {
                  type: 'Image',
                  prompt:
                    'Young John Duran as a teenager in Colombian club Envigado jersey, action pose.',
                  dimensions: { width: 600, height: 800 },
                  triggerWordIndex: 0,
                  endWordIndex: 7,
                  zIndex: 1,
                  enterEffect: {
                    type: 'spring',
                    triggerWordIndex: 0,
                    endWordIndex: 2,
                  },
                  exitEffect: {
                    type: 'pixelate',
                    triggerWordIndex: 6,
                    endWordIndex: 7,
                  },
                },
                {
                  type: 'Image',
                  prompt:
                    'John Duran in Chicago Fire MLS jersey, celebrating, transparent background.',
                  dimensions: { width: 700, height: 850 },
                  triggerWordIndex: 8,
                  endWordIndex: -1,
                  zIndex: 2,
                  enterEffect: {
                    type: 'fastZoom',
                    triggerWordIndex: 8,
                    endWordIndex: 10,
                  },
                },
              ],
            },
            {
              type: 'Stack',
              dimensions: { width: 1080, height: 960 },
              media: [
                {
                  type: 'Avatar',
                  prompt: 'Sports commentator presenting news',
                  dimensions: { width: 1080, height: 960 },
                  triggerWordIndex: 0,
                  endWordIndex: -1,
                  zIndex: 0,
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'd4f6b8c0-3e5a-7d9f-1b2c-4a6e8c0d2f3e',
      order: 2,
      text: "After just one season in America, Duran was on his way to the Premier League. His potential was clear, and despite being Villa's second choice striker, the Colombian kept scoring important goals off the bench.",
      layout: [
        {
          type: 'Column',
          dimensions: { width: 1080, height: 1920 },
          layout: [
            {
              type: 'Stack',
              dimensions: { width: 1080, height: 960 },
              background: {
                type: 'Image',
                prompt:
                  'Villa Park stadium, Aston Villa home ground, packed crowd, Premier League atmosphere.',
                triggerWordIndex: 0,
                endWordIndex: -1,
                zIndex: 0,
              },
              media: [
                {
                  type: 'Image',
                  prompt:
                    'John Duran in Aston Villa claret and blue jersey, celebrating a goal, passionate expression.',
                  dimensions: { width: 800, height: 900 },
                  triggerWordIndex: 0,
                  endWordIndex: 14,
                  zIndex: 1,
                  enterEffect: {
                    type: 'perspectiveSingle',
                    triggerWordIndex: 0,
                    endWordIndex: 3,
                  },
                  exitEffect: {
                    type: 'scaleMoveBlur',
                    triggerWordIndex: 13,
                    endWordIndex: 14,
                  },
                },
                {
                  type: 'Image',
                  prompt:
                    'John Duran coming off the bench, Aston Villa jersey, determined look, substitution board visible.',
                  dimensions: { width: 850, height: 900 },
                  triggerWordIndex: 15,
                  endWordIndex: -1,
                  zIndex: 2,
                  enterEffect: {
                    type: 'spring',
                    triggerWordIndex: 15,
                    endWordIndex: 18,
                  },
                },
              ],
            },
            {
              type: 'Stack',
              dimensions: { width: 1080, height: 960 },
              media: [
                {
                  type: 'Avatar',
                  prompt: 'Sports commentator presenting news',
                  dimensions: { width: 1080, height: 960 },
                  triggerWordIndex: 0,
                  endWordIndex: -1,
                  zIndex: 0,
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'e5a7c9d1-4f6b-8e0a-2c3d-5b7f9a1e3c4d',
      order: 3,
      text: "In the 24-25 season, he was averaging a goal every 88 minutes. And these weren't just tap-ins either.",
      layout: [
        {
          type: 'Column',
          dimensions: { width: 1080, height: 1920 },
          layout: [
            {
              type: 'Stack',
              dimensions: { width: 1080, height: 960 },
              background: {
                type: 'Video',
                prompt:
                  'Compilation of spectacular goals, bicycle kicks, long-range shots, Premier League highlights.',
                triggerWordIndex: 0,
                endWordIndex: -1,
                zIndex: 0,
              },
              media: [
                {
                  type: 'Text',
                  prompt: '1 GOAL / 88 MINS',
                  dimensions: { width: 600, height: 200 },
                  triggerWordIndex: 0,
                  endWordIndex: 10,
                  zIndex: 1,
                  enterEffect: {
                    type: 'glitch',
                    triggerWordIndex: 0,
                    endWordIndex: 3,
                  },
                  mediaEffect: {
                    type: 'retro70s',
                    triggerWordIndex: 4,
                    endWordIndex: 10,
                  },
                },
                {
                  type: 'Image',
                  prompt:
                    'John Duran scoring a spectacular overhead kick in Aston Villa jersey, dynamic action shot.',
                  dimensions: { width: 900, height: 800 },
                  triggerWordIndex: 11,
                  endWordIndex: -1,
                  zIndex: 2,
                  enterEffect: {
                    type: 'fastZoom',
                    triggerWordIndex: 11,
                    endWordIndex: 13,
                  },
                  mediaEffect: {
                    type: 'slitScan',
                    triggerWordIndex: 14,
                    endWordIndex: -1,
                  },
                },
              ],
            },
            {
              type: 'Stack',
              dimensions: { width: 1080, height: 960 },
              media: [
                {
                  type: 'Avatar',
                  prompt: 'Sports commentator presenting news',
                  dimensions: { width: 1080, height: 960 },
                  triggerWordIndex: 0,
                  endWordIndex: -1,
                  zIndex: 0,
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'f6b8d0e2-5a7c-9f1b-3d4e-6c8a0b2d4f5e',
      order: 4,
      text: "Villa wanted to keep him, but when that Saudi money came in, both Villa and Duran couldn't say no.",
      layout: [
        {
          type: 'Column',
          dimensions: { width: 1080, height: 1920 },
          layout: [
            {
              type: 'Stack',
              dimensions: { width: 1080, height: 960 },
              background: {
                type: 'Image',
                prompt:
                  'Split image of Aston Villa stadium and Saudi Arabia golden skyline with money symbols.',
                triggerWordIndex: 0,
                endWordIndex: -1,
                zIndex: 0,
              },
              media: [
                {
                  type: 'Image',
                  prompt:
                    'John Duran in Aston Villa jersey looking thoughtful, contract papers floating around.',
                  dimensions: { width: 600, height: 750 },
                  triggerWordIndex: 0,
                  endWordIndex: 8,
                  zIndex: 1,
                  enterEffect: {
                    type: 'spring',
                    triggerWordIndex: 0,
                    endWordIndex: 2,
                  },
                  exitEffect: {
                    type: 'pixelate',
                    triggerWordIndex: 7,
                    endWordIndex: 8,
                  },
                },
                {
                  type: 'Image',
                  prompt:
                    'John Duran holding Al-Nassr jersey, Saudi Pro League, money raining down, golden aesthetic.',
                  dimensions: { width: 800, height: 850 },
                  triggerWordIndex: 9,
                  endWordIndex: -1,
                  zIndex: 2,
                  enterEffect: {
                    type: 'scaleMoveBlur',
                    triggerWordIndex: 9,
                    endWordIndex: 12,
                  },
                  mediaEffect: {
                    type: 'retro70s',
                    triggerWordIndex: 13,
                    endWordIndex: -1,
                  },
                },
              ],
            },
            {
              type: 'Stack',
              dimensions: { width: 1080, height: 960 },
              media: [
                {
                  type: 'Avatar',
                  prompt: 'Sports commentator presenting news',
                  dimensions: { width: 1080, height: 960 },
                  triggerWordIndex: 0,
                  endWordIndex: -1,
                  zIndex: 0,
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'a7c9e1f3-6b8d-0a2c-4e5f-7d9b1c3e5a6f',
      order: 5,
      text: "Yet, just 6 months following his Al-Nassr move, Duran already wants out and has found an interesting new destination in Mourinho's Fenerbahçe on loan.",
      layout: [
        {
          type: 'Column',
          dimensions: { width: 1080, height: 1920 },
          layout: [
            {
              type: 'Stack',
              dimensions: { width: 1080, height: 960 },
              background: {
                type: 'Image',
                prompt:
                  'Fenerbahçe Şükrü Saracoğlu Stadium at night, yellow and navy blue colors, Turkish flags.',
                triggerWordIndex: 0,
                endWordIndex: -1,
                zIndex: 0,
              },
              media: [
                {
                  type: 'Image',
                  prompt:
                    'John Duran in Al-Nassr jersey looking unhappy, arms crossed.',
                  dimensions: { width: 550, height: 700 },
                  triggerWordIndex: 0,
                  endWordIndex: 10,
                  zIndex: 1,
                  enterEffect: {
                    type: 'spring',
                    triggerWordIndex: 0,
                    endWordIndex: 2,
                  },
                  mediaEffect: {
                    type: 'glitch',
                    triggerWordIndex: 8,
                    endWordIndex: 10,
                  },
                },
                {
                  type: 'Image',
                  prompt:
                    'José Mourinho in Fenerbahçe coaching gear, pointing, tactical pose.',
                  dimensions: { width: 500, height: 700 },
                  triggerWordIndex: 11,
                  endWordIndex: 18,
                  zIndex: 2,
                  enterEffect: {
                    type: 'perspectiveSingle',
                    triggerWordIndex: 11,
                    endWordIndex: 13,
                  },
                  exitEffect: {
                    type: 'scaleMoveBlur',
                    triggerWordIndex: 17,
                    endWordIndex: 18,
                  },
                },
                {
                  type: 'Image',
                  prompt:
                    'John Duran wearing Fenerbahçe yellow and navy jersey, confident smile, arms open.',
                  dimensions: { width: 850, height: 900 },
                  triggerWordIndex: 19,
                  endWordIndex: -1,
                  zIndex: 3,
                  enterEffect: {
                    type: 'fastZoom',
                    triggerWordIndex: 19,
                    endWordIndex: 21,
                  },
                },
              ],
            },
            {
              type: 'Stack',
              dimensions: { width: 1080, height: 960 },
              media: [
                {
                  type: 'Avatar',
                  prompt: 'Sports commentator presenting news',
                  dimensions: { width: 1080, height: 960 },
                  triggerWordIndex: 0,
                  endWordIndex: -1,
                  zIndex: 0,
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'b8d0f2a4-7c9e-1b3d-5f6a-8e0c2d4b6a7c',
      order: 6,
      text: 'This deal is wild. Fenerbahçe is set to pay a sizable loan fee plus his full 20 mil annual salary, which is crazy considering this loan fee will be more expensive than their previous club record transfer of star striker Yusuf En-Nesyri for 19 mil.',
      layout: [
        {
          type: 'Column',
          dimensions: { width: 1080, height: 1920 },
          layout: [
            {
              type: 'Stack',
              dimensions: { width: 1080, height: 960 },
              background: {
                type: 'Image',
                prompt:
                  'Financial graphics, money stacks, contract papers, transfer news aesthetic, dramatic lighting.',
                triggerWordIndex: 0,
                endWordIndex: -1,
                zIndex: 0,
              },
              media: [
                {
                  type: 'Text',
                  prompt: '€20M SALARY',
                  dimensions: { width: 500, height: 150 },
                  triggerWordIndex: 0,
                  endWordIndex: 12,
                  zIndex: 1,
                  enterEffect: {
                    type: 'glitch',
                    triggerWordIndex: 0,
                    endWordIndex: 3,
                  },
                  mediaEffect: {
                    type: 'retro70s',
                    triggerWordIndex: 4,
                    endWordIndex: 12,
                  },
                },
                {
                  type: 'Image',
                  prompt:
                    'Yusuf En-Nesyri in Fenerbahçe jersey, comparison shot style.',
                  dimensions: { width: 500, height: 650 },
                  triggerWordIndex: 13,
                  endWordIndex: 35,
                  zIndex: 2,
                  enterEffect: {
                    type: 'spring',
                    triggerWordIndex: 13,
                    endWordIndex: 16,
                  },
                  exitEffect: {
                    type: 'pixelate',
                    triggerWordIndex: 34,
                    endWordIndex: 35,
                  },
                },
                {
                  type: 'Text',
                  prompt: '€19M TRANSFER RECORD',
                  dimensions: { width: 500, height: 150 },
                  triggerWordIndex: 36,
                  endWordIndex: -1,
                  zIndex: 3,
                  enterEffect: {
                    type: 'glitch',
                    triggerWordIndex: 36,
                    endWordIndex: 38,
                  },
                },
              ],
            },
            {
              type: 'Stack',
              dimensions: { width: 1080, height: 960 },
              media: [
                {
                  type: 'Avatar',
                  prompt: 'Sports commentator presenting news',
                  dimensions: { width: 1080, height: 960 },
                  triggerWordIndex: 0,
                  endWordIndex: -1,
                  zIndex: 0,
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'c9e1a3b5-8d0f-2c4e-6a7b-9f1d3e5c7b8d',
      order: 7,
      text: "Duran's latest chapter is emblematic of his entire career.",
      layout: [
        {
          type: 'Column',
          dimensions: { width: 1080, height: 1920 },
          layout: [
            {
              type: 'Stack',
              dimensions: { width: 1080, height: 960 },
              background: {
                type: 'Image',
                prompt:
                  'Dramatic montage background with multiple faded jerseys: Chicago Fire, Aston Villa, Al-Nassr, Fenerbahçe.',
                triggerWordIndex: 0,
                endWordIndex: -1,
                zIndex: 0,
                mediaEffect: {
                  type: 'slitScan',
                  triggerWordIndex: 0,
                  endWordIndex: -1,
                },
              },
              media: [
                {
                  type: 'Image',
                  prompt:
                    'John Duran in Fenerbahçe jersey, hero pose, looking toward the future, cinematic lighting, confident stance.',
                  dimensions: { width: 900, height: 900 },
                  triggerWordIndex: 0,
                  endWordIndex: -1,
                  zIndex: 1,
                  enterEffect: {
                    type: 'perspectiveSingle',
                    triggerWordIndex: 0,
                    endWordIndex: 3,
                  },
                  mediaEffect: {
                    type: 'retro70s',
                    triggerWordIndex: 4,
                    endWordIndex: -1,
                  },
                },
              ],
            },
            {
              type: 'Stack',
              dimensions: { width: 1080, height: 960 },
              media: [
                {
                  type: 'Avatar',
                  prompt: 'Sports commentator presenting news',
                  dimensions: { width: 1080, height: 960 },
                  triggerWordIndex: 0,
                  endWordIndex: -1,
                  zIndex: 0,
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
