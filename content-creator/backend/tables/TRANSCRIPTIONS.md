# transcriptions

> Schema: `studio` · Table: `transcriptions`
> Related: [[PROJECTS]] → [[VIDEOS]] → [[TRANSCRIPTIONS]]
> Used by: [[SCENES]] (scene transcription caches here)

## Contents
- [Table Structure](#table-structure)
- [API Endpoints](#api-endpoints)
  - [Transcribe Scene](#transcribe-scene)
  - [Raw Transcribe](#raw-transcribe)

---

## Table Structure

| Column | Type | Nullable | Default | Constraint | Notes |
|--------|------|----------|---------|------------|-------|
| id | uuid | NO | gen_random_uuid() | PK | Auto-generated unique identifier |
| project_id | uuid | NO | — | FK → projects.id | Parent project |
| video_id | uuid | NO | — | FK → videos.id | Parent video |
| source_url | text | NO | — | | URL of the audio/video file |
| model | text | NO | 'nova-3' | | Deepgram model used |
| language | text | YES | — | | Detected language code |
| duration | float4 | YES | — | | Audio duration in seconds |
| data | jsonb | NO | — | | Full Deepgram response (see below) |
| created_at | timestamptz | NO | now() | | |
| updated_at | timestamptz | NO | now() | | |

### data JSONB

Full Deepgram nova-3 response. The `TranscriptionSummary` extracted from it:

```json
{
  "results": {
    "main": {
      "text": "Full transcript text here",
      "words": [
        { "word": "Full", "start": 0.0, "end": 0.24, "confidence": 0.99 },
        { "word": "transcript", "start": 0.24, "end": 0.72, "confidence": 0.98 }
      ],
      "language": { "language": "tr" }
    }
  },
  "duration": 12.5
}
```

---

## API Endpoints

### Transcribe Scene

`POST` /api/v2/scenes/{id}/transcribe — cached

| Field | Type | Req | Default | Notes |
|-------|------|:---:|---------|-------|
| source | string | | "video" | `"video"`, `"voiceover"`, or `"both"` |

→ `200` `{ scene_id, video_transcription, voiceover_transcription, has_speech }`

> Checks transcriptions cache first. On miss, calls Deepgram nova-3, caches result, stores summary on scene record.

---

### Raw Transcribe

`POST` /api/transcribe — no cache

| Field | Type | Req | Default | Notes |
|-------|------|:---:|---------|-------|
| url | string | ✓ | — | Audio/video URL to transcribe |
| language | string | | — | Language hint |
| targetLanguage | string | | — | Translation target language |
| model | string | | "nova-3" | Deepgram model |

→ `200` `{ results: { main: { text, words[], language } }, duration }`

> Direct Deepgram call without caching. Used by editor for ad-hoc transcription.
