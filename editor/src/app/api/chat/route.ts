import {
  streamText,
  convertToModelMessages,
  type UIMessage,
  stepCountIs,
  hasToolCall,
  tool,
} from 'ai';
import { z } from 'zod';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { tavily } from '@tavily/core';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY });

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    stopWhen: [stepCountIs(10), hasToolCall('duplicate_selected')],
    model: openrouter.chat('x-ai/grok-4.1-fast', {
      reasoning: { effort: 'high' },
    }),
    system: `You are a helpful AI assistant for a video editor application.

When answering questions that require current or external information:
1. First call askQuestion to get user preferences (how many results they want, any specific website)
2. After receiving their answers, call webSearch with the query and their preferences
3. Review the search results and synthesize the information into a comprehensive answer
4. Do NOT call webSearch multiple times - one search is sufficient

When the user asks to write a voiceover or script:
1. First call askQuestion to get preferences (duration in seconds, tone like professional/casual/dramatic)
2. After receiving their answers, call writeVoiceover with the topic and their preferences
3. Generate the voiceover text and present it to the user
4. After presenting the voiceover, call askQuestion to get feedback with context "voiceover feedback":
   - Question: "Do you like this voiceover?"
   - Options: [{ label: "Yes, it's perfect", value: "approved" }]
   - allowCustom: true (so user can type feedback like "make it shorter", "add a CTA", etc.)
5. If user selects "approved" → confirm the script is finalized
6. If user provides custom feedback → call editVoiceover with the current script and their feedback, then repeat from step 4

For video editing tasks, use the appropriate timeline tools to help users edit their videos.`,
    messages: await convertToModelMessages(messages),
    tools: {
      askQuestion: tool({
        description:
          'Ask the user questions before proceeding with an action. Use this to get user preferences.',
        inputSchema: z.object({
          context: z
            .string()
            .describe('What this is for, e.g. "web search", "export settings"'),
          questions: z.array(
            z.object({
              id: z.string().describe('Unique identifier for this question'),
              text: z.string().describe('The question to ask the user'),
              options: z
                .array(
                  z.object({
                    label: z.string().describe('Display label for the option'),
                    value: z
                      .union([z.string(), z.number()])
                      .describe('Value to use when selected'),
                  })
                )
                .optional()
                .describe('Predefined options for the user to choose from'),
              allowCustom: z
                .boolean()
                .optional()
                .describe('Whether to show a custom input field'),
              allowSkip: z
                .boolean()
                .optional()
                .describe('Whether the user can skip this question'),
            })
          ),
        }),
        // No execute - frontend handles via addResult
      }),
      webSearch: tool({
        description:
          'Search the web for information. Call askQuestion first to get user preferences.',
        inputSchema: z.object({
          query: z.string().describe('The search query'),
          maxResults: z
            .number()
            .optional()
            .default(5)
            .describe('Maximum number of results to return'),
          domain: z
            .string()
            .optional()
            .describe('Specific domain to search within'),
        }),
        execute: async ({ query, maxResults, domain }) => {
          const response = await tavilyClient.search(query, {
            maxResults: maxResults ?? 5,
            includeDomains: domain ? [domain] : undefined,
          });
          return response;
        },
      }),
      writeVoiceover: tool({
        description:
          'Generate voiceover text for a video. Call askQuestion first to get duration and tone preferences.',
        inputSchema: z.object({
          topic: z.string().describe('The topic or subject of the voiceover'),
          duration: z
            .number()
            .optional()
            .describe('Target duration in seconds (helps determine length)'),
          tone: z
            .string()
            .optional()
            .describe(
              'The tone of the voiceover (e.g. professional, casual, dramatic, upbeat)'
            ),
        }),
        execute: async ({ topic, duration, tone }) => {
          // Return the parameters - the AI will generate the actual voiceover text
          // based on these in its response after the tool call
          return {
            topic,
            duration: duration ?? 30,
            tone: tone ?? 'professional',
            instruction: `Generate a voiceover script about "${topic}" that is approximately ${duration ?? 30} seconds when read aloud (roughly ${Math.round((duration ?? 30) * 2.5)} words) in a ${tone ?? 'professional'} tone.`,
          };
        },
      }),
      editVoiceover: tool({
        description:
          'Edit an existing voiceover based on user feedback. Use this after the user provides feedback on a voiceover.',
        inputSchema: z.object({
          originalScript: z
            .string()
            .describe('The current voiceover script to edit'),
          feedback: z
            .string()
            .describe(
              'What the user wants changed (e.g. "make it shorter", "add a CTA", "more dramatic")'
            ),
        }),
        execute: async ({ originalScript, feedback }) => {
          return {
            originalScript,
            feedback,
            instruction: `Edit the following voiceover based on user feedback: "${feedback}"\n\nOriginal script:\n${originalScript}`,
          };
        },
      }),
      add_text: tool({
        description: 'Add a text element to the video timeline',
        inputSchema: z.object({
          text: z.string().describe('The text content to display'),
        }),
        execute: async ({ text }) => {
          return `Text added: ${text}`;
        },
      }),
      delete_selected: tool({
        description: 'Delete the currently selected objects from the timeline',
        inputSchema: z.object({}),
        execute: async () => {
          return 'Delete action triggered for selected objects';
        },
      }),
      duplicate_selected: tool({
        description: 'Duplicate the currently selected objects in the timeline',
        inputSchema: z.object({}),
        execute: async () => {
          return 'Duplicate action triggered for selected objects';
        },
      }),
      split_selected: tool({
        description:
          'Split the selected object at the current time or provided time',
        inputSchema: z.object({
          time: z
            .number()
            .optional()
            .describe('The time in seconds to split at'),
        }),
        execute: async ({ time }) => {
          return `Split action triggered for selected object${time ? ` at ${time} seconds` : ''}`;
        },
      }),
      trim_selected: tool({
        description:
          'Trim the selected clip from a specified time (removes the beginning of the clip)',
        inputSchema: z.object({
          trimFrom: z
            .number()
            .describe(
              'The number of seconds to trim from the start of the clip'
            ),
        }),
        execute: async ({ trimFrom }) => {
          return `Trim action triggered for selected clip: trimming ${trimFrom} seconds from the start`;
        },
      }),
      set_color: tool({
        description: 'Set the color of the currently selected objects',
        inputSchema: z.object({
          color: z
            .string()
            .describe('The color to set (e.g. "red", "#ff0000")'),
        }),
        execute: async ({ color }) => {
          return `Color set action triggered for selected objects: ${color}`;
        },
      }),
      set_timings: tool({
        description:
          'Set the display timings (start and end) for the currently selected objects',
        inputSchema: z.object({
          from: z.number().optional().describe('The start time in seconds'),
          to: z.number().optional().describe('The end time in seconds'),
        }),
        execute: async ({ from, to }) => {
          return `Timings set action triggered for selected objects: from ${from ?? 'unchanged'} to ${to ?? 'unchanged'}`;
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse({
    sendReasoning: true,
  });
}
