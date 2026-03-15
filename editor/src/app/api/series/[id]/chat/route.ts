import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type RouteContext = { params: Promise<{ id: string }> };

const SERIES_SHOWRUNNER_SYSTEM_PROMPT = `You are a Series Showrunner — a creative AI collaborator helping develop a fictional series.

Your role:
- Be a creative partner, not a form filler
- Ask targeted, smart questions: genre, protagonist, central conflict, setting, tone
- Build the plan incrementally through conversation (don't dump everything at once)
- After 3-4 exchanges, proactively suggest: "I think we have enough to create a solid plan. Want me to finalize it?"
- Always include the FULL updated plan in every response (not just deltas)
- Keep episode synopses to 2-3 sentences each
- Aim for 4-8 characters, 3-6 locations, and however many episodes the creator wants

CRITICAL: You must ALWAYS respond with valid JSON in this exact format:
{
  "message": "Your conversational response here",
  "plan": {
    "bible": "Series overview, world rules, themes, tone (string, empty if not enough info yet)",
    "characters": [
      {
        "name": "Character name",
        "role": "main|supporting|extra",
        "description": "Who they are",
        "personality": "How they think and behave",
        "relationships": "Their relationships to other characters",
        "appearance": "Physical description for image generation"
      }
    ],
    "locations": [
      {
        "name": "Location name",
        "description": "What it is",
        "atmosphere": "Mood, lighting, feel"
      }
    ],
    "props": [
      {
        "name": "Prop name",
        "description": "What it is and its significance"
      }
    ],
    "episodes": [
      {
        "number": 1,
        "title": "Episode title",
        "synopsis": "2-3 sentence synopsis",
        "featured_characters": ["Character name"]
      }
    ]
  }
}

Start by warmly greeting the creator and asking what kind of series they want to make. Be enthusiastic and creative. If the creator gives you minimal info, fill in creative suggestions and ask if they like the direction.`;

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Load series (verify ownership)
    const { data: series, error: seriesError } = await supabase
      .from('series')
      .select(
        'id, name, genre, tone, bible, onboarding_messages, plan_draft, plan_status'
      )
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (seriesError || !series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    if (series.plan_status === 'finalized') {
      return NextResponse.json(
        { error: 'Series is already finalized' },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { message } = body;

    if (
      !message ||
      typeof message !== 'string' ||
      message.trim().length === 0
    ) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Load existing conversation history
    const history: Array<{ role: 'user' | 'assistant'; content: string }> =
      Array.isArray(series.onboarding_messages)
        ? series.onboarding_messages
        : [];

    // Build messages for OpenRouter
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...history,
      { role: 'user', content: message.trim() },
    ];

    // Include series context in first user message if this is the first message
    let contextualSystemPrompt = SERIES_SHOWRUNNER_SYSTEM_PROMPT;
    if (series.name || series.genre || series.tone) {
      contextualSystemPrompt += `\n\nSeries context already provided:\n- Name: ${series.name}`;
      if (series.genre) contextualSystemPrompt += `\n- Genre: ${series.genre}`;
      if (series.tone) contextualSystemPrompt += `\n- Tone: ${series.tone}`;
      if (series.bible) contextualSystemPrompt += `\n- Bible: ${series.bible}`;
    }

    // Call OpenRouter (non-streaming, JSON response)
    const openrouterRes = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer':
            process.env.NEXT_PUBLIC_APP_URL ?? 'https://octupost.com',
          'X-Title': 'Octupost Series Showrunner',
        },
        body: JSON.stringify({
          model: 'openai/gpt-5.4',
          messages: [
            { role: 'system', content: contextualSystemPrompt },
            ...messages,
          ],
          response_format: { type: 'json_object' },
          temperature: 0.8,
        }),
      }
    );

    if (!openrouterRes.ok) {
      const errText = await openrouterRes.text();
      console.error('OpenRouter error:', errText);
      return NextResponse.json({ error: 'AI service error' }, { status: 500 });
    }

    const openrouterData = await openrouterRes.json();
    const rawContent = openrouterData.choices?.[0]?.message?.content ?? '{}';

    // Parse JSON response
    let parsed: { message: string; plan: Record<string, unknown> };
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      console.error('Failed to parse AI response as JSON:', rawContent);
      return NextResponse.json(
        { error: 'AI returned invalid response' },
        { status: 500 }
      );
    }

    const aiMessage = parsed.message ?? '';
    const plan = parsed.plan ?? {};

    // Update conversation history
    const updatedHistory = [
      ...messages,
      { role: 'assistant' as const, content: rawContent },
    ];

    // Save to DB
    const { error: updateError } = await supabase
      .from('series')
      .update({
        onboarding_messages: updatedHistory,
        plan_draft: plan,
      })
      .eq('id', id)
      .eq('user_id', user.id);

    if (updateError) {
      console.error('Failed to save chat state:', updateError);
      return NextResponse.json(
        { error: 'Failed to save progress' },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: aiMessage, plan });
  } catch (error) {
    console.error('Series chat error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
