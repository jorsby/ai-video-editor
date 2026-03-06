'use client';

import { useState } from 'react';
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckIcon } from 'lucide-react';

interface QuestionOption {
  label: string;
  value: string | number;
}

interface Question {
  id: string;
  text: string;
  options?: QuestionOption[];
  allowCustom?: boolean;
  allowSkip?: boolean;
}

interface AskQuestionArgs {
  context: string;
  questions: Question[];
}

export const QuestionFlow: ToolCallMessagePartComponent<
  AskQuestionArgs,
  Record<string, string | number | null>
> = ({ args, result, addResult }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<
    Record<string, string | number | null>
  >({});
  const [customValue, setCustomValue] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  const questions = args?.questions ?? [];
  const context = args?.context ?? 'preferences';

  // If we already have a result, show completed state
  if (result) {
    return (
      <div className="mb-4 flex w-full flex-col gap-3 rounded-xl border bg-card/50 p-4">
        <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
          <CheckIcon className="size-4" />
          <span>Preferences saved for {context}</span>
        </div>
      </div>
    );
  }

  // If no questions, nothing to render
  if (questions.length === 0) {
    return null;
  }

  const currentQuestion = questions[currentStep];
  const isLastQuestion = currentStep === questions.length - 1;

  const handleOptionClick = (value: string | number) => {
    const newAnswers = { ...answers, [currentQuestion.id]: value };
    setAnswers(newAnswers);
    setShowCustomInput(false);
    setCustomValue('');

    if (isLastQuestion) {
      addResult(newAnswers);
    } else {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleCustomSubmit = () => {
    if (!customValue.trim()) return;

    const value = /^\d+$/.test(customValue) ? Number(customValue) : customValue;
    handleOptionClick(value);
  };

  const handleSkip = () => {
    const newAnswers = { ...answers, [currentQuestion.id]: null };
    setAnswers(newAnswers);

    if (isLastQuestion) {
      addResult(newAnswers);
    } else {
      setCurrentStep(currentStep + 1);
    }
  };

  return (
    <div className="mb-4 flex w-full flex-col gap-4 rounded-xl border bg-card/50 p-4">
      {/* Header */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="capitalize">{context}</span>
        <span>
          Question {currentStep + 1} of {questions.length}
        </span>
      </div>

      {/* Question */}
      <p className="text-sm font-medium">{currentQuestion.text}</p>

      {/* Options */}
      <div className="flex flex-wrap gap-2">
        {currentQuestion.options?.map((option) => (
          <Button
            key={String(option.value)}
            variant="outline"
            size="sm"
            className="min-w-[3rem]"
            onClick={() => handleOptionClick(option.value)}
          >
            {option.label}
          </Button>
        ))}

        {currentQuestion.allowCustom && !showCustomInput && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCustomInput(true)}
          >
            Custom...
          </Button>
        )}

        {currentQuestion.allowSkip && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={handleSkip}
          >
            Skip
          </Button>
        )}
      </div>

      {/* Custom Input */}
      {showCustomInput && (
        <div className="flex gap-2">
          <Input
            placeholder="Enter value..."
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleCustomSubmit();
              }
            }}
            className="flex-1"
            autoFocus
          />
          <Button size="sm" onClick={handleCustomSubmit}>
            OK
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setShowCustomInput(false);
              setCustomValue('');
            }}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
};
