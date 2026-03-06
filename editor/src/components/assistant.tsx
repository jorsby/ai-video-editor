'use client';

import { AssistantRuntimeProvider } from '@assistant-ui/react';
import {
  useChatRuntime,
  AssistantChatTransport,
} from '@assistant-ui/react-ai-sdk';
import { Thread } from '@/components/assistant-ui/thread';

/**
 * Client-side tools that should automatically continue the conversation
 * after receiving a user result.
 *
 * Add tool names here when:
 * - The tool gathers user input/preferences before an action
 * - The tool requires user confirmation before proceeding
 * - The tool is a "discovery" step that leads to another tool call
 *
 * Do NOT add tools that:
 * - Have an execute() function (they run server-side automatically)
 * - Are display-only (no follow-up action needed)
 * - Complete the workflow on their own
 */
const CONTINUE_AFTER_RESULT_TOOLS = new Set([
  'askQuestion', // Gathers preferences, then continues to the actual action (e.g., webSearch)
  // Future examples:
  // 'confirmAction',   // User confirms before destructive action
  // 'selectOption',    // User picks from choices
  // 'configureExport', // User sets export settings before exporting
]);

/**
 * Extracts the tool name from a part type.
 * e.g., "tool-askQuestion" → "askQuestion"
 */
function getToolNameFromPartType(partType: string): string | null {
  if (partType.startsWith('tool-')) {
    return partType.slice(5);
  }
  return null;
}

export const Assistant = () => {
  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({
      api: '/api/chat',
    }),
    // Automatically continue the conversation when a client-side tool has received a result
    // and the model hasn't yet continued processing (no subsequent tool calls or text)
    sendAutomaticallyWhen: ({ messages }) => {
      const lastMessage = messages[messages.length - 1];
      if (!lastMessage || lastMessage.role !== 'assistant') return false;
      if (!lastMessage.parts || lastMessage.parts.length === 0) return false;

      // Find the index of any "continue" tool that has received a result
      const continueToolIndex = lastMessage.parts.findIndex((part) => {
        const toolName = getToolNameFromPartType(part.type);
        if (toolName === null || !CONTINUE_AFTER_RESULT_TOOLS.has(toolName)) {
          return false;
        }
        // Check if this tool part has a result (state exists on tool parts)
        return 'state' in part && part.state === 'output-available';
      });

      if (continueToolIndex === -1) return false;

      // Check if there are any parts AFTER the tool that indicate the model has continued
      // (text content, other tool calls, etc.)
      const hasSubsequentContent = lastMessage.parts
        .slice(continueToolIndex + 1)
        .some(
          (part) =>
            part.type === 'text' ||
            part.type.startsWith('tool-') ||
            part.type === 'dynamic-tool'
        );

      // Only continue if the tool has a result but the model hasn't processed it yet
      return !hasSubsequentContent;
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex-1 overflow-hidden bg-panel h-[calc(100vh-3.2rem)]">
        <Thread />
      </div>
    </AssistantRuntimeProvider>
  );
};
