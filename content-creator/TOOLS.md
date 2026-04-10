# TOOLS.md

## API
- Base URL: `http://localhost:3000`
- Auth: `Authorization: Bearer <OCTUPOST_API_KEY>`
- Full API reference: `/Users/serhatcamici/Development/ai-video-editor/API-COOKBOOK.md`
- Production funnel: `~/.openclaw/skills/video-editor/SKILL.md`

## DB Naming (güncel)
| Eski | Yeni | Açıklama |
|------|------|----------|
| `series` | `videos` | Tek YouTube videosu |
| `episodes` | `chapters` | Video bölümü |
| `series_id` | `video_id` | FK |
| `episode_id` | `chapter_id` | FK |
| `scenes` | `scenes` | Değişmedi |

## API Routes (güncel)
- `/api/v2/videos/{id}` — video CRUD
- `/api/v2/videos/{id}/chapters` — chapter list
- `/api/v2/chapters/{id}` — chapter CRUD
- `/api/v2/chapters/{id}/scenes` — scene list/create
- `/api/v2/scenes/{id}` — scene CRUD
- `/api/v2/scenes/{id}/generate-tts` — TTS
- `/api/v2/scenes/{id}/generate-video` — Video generation

## Rules
- ID'leri hardcode etme — API'den fresh çek
- Schema: `studio`
- Provider API'lerini direkt çağırma — app route'larını kullan
- Asset create = bare JSON array `[{...}]`
- `duration` yazma → `audio_duration` / `video_duration` kullan
