# Hicret — Mekke'den Medine'ye 🕌

12 bölümlük kısa video belgesel serisi. Netflix belgesel tarzı, Türkçe VO, kronolojik, shorts formatı (9:16).

---

## Table of Contents

- [IDs](#ids)
- [Metadata](#metadata)
- [Rules](#rules)
- [Islamic Rules](#islamic-rules)
- [Language Rules](#language-rules)
- [Period Rules](#period-rules)
- [Episode Transition Map](#episode-transition-map)
- [Event Ownership](#event-ownership)
- [Quran Verses Used](#quran-verses-used)
- [Controversial Points](#controversial-points)
- [Pipeline Status](#pipeline-status)
- [Feedback Log](#feedback-log)
- [Revision History](#revision-history)

---

## IDs

| Key | Value |
|-----|-------|
| **Series ID** | `2592320f-1e17-4d27-a2de-69e352eb21d6` |
| **Project ID** | `67944fde-e218-4470-a9e5-09f84d9b5540` |

> Everything else (storyboard IDs, scene IDs, asset IDs) → **query Supabase live**. Never hardcode.

---

## Metadata

| Setting | Value |
|---------|-------|
| Format | 9:16 (TikTok/Reels/Shorts) |
| Language | Turkish |
| Video Model | Kling O3 ref_to_video |
| TTS | ElevenLabs v2.5 Turkish |
| Scenes/episode | ~7-8 |
| VO/episode | ~150-175 words |
| Mode | narrative |
| Tone | Netflix documentary — pure narration, not preaching |

---

## Rules

### Islamic Rules

| Rule | Detail |
|------|--------|
| **Hz. Muhammed never shown** | No face, no silhouette from front. Allowed: POV, hands, from behind, light halo, footprints |
| **"Peygamber Efendimiz"** | Standard reference (not "Peygamber" alone, not "Hz. Muhammed") |
| **Hz. for all companions** | Hz. Ali, Hz. Ebu Bekir, Hz. Ömer, Hz. Hatice, Hz. Bilal, Hz. Sümeyye, Hz. Esma |
| **No Hz. for enemies** | Ebu Cehil, Süraka (in enemy scenes), Ümmü Ma'bed |
| **Quran verses = Diyanet meal** | Word-for-word match. No paraphrasing. Always include "mealen" |
| **Always cite** | Surah name + verse number after every Quran quote |
| **Natural integration** | Quran and hadith references flow within the story — not separate blocks |

### Language Rules

| Rule | Detail |
|------|--------|
| **No parenthetical explanations** | VO text = exactly what's heard. No `(açıklama)` |
| **Simple Turkish** | Not academic. Everyone should understand |
| **Historical facts only** | No creative additions |
| **No repetition between episodes** | Each event told once, in its correct episode |
| **"Rivayetlere göre"** | Add this prefix for disputed historical events |

### Period Rules (7th Century Arabia, 622 CE)

| Allowed | Not Allowed |
|---------|-------------|
| Swords, spears, bows | Guns, firearms |
| Mud-brick houses | Stone castles, glass buildings |
| Torches, oil lamps | Electric lights |
| Camels, horses | Cars, carts with wheels |
| Simple robes, sandals | Elaborate armor |

---

## Episode Transition Map

Each episode's last scene hooks into the next episode's opening. **Check this before writing a new episode.**

| EP | Last Scene Hook | → | Next Episode Opens With |
|----|-----------------|---|------------------------|
| 1 | "Mekke artık geride kalacaktı" | → | EP2: 622, Mekke'de tek kalan Peygamber Efendimiz |
| 2 | "genç bir yürek lazımdı" | → | EP3: Hz. Ali çağrılıyor |
| 3 | "Karanlık bir sığınak olmuştu" | → | EP4: Yasin Suresi, suikastçıların arasından geçiş |
| 4 | "Sevr Dağı bekliyordu" | → | EP5: Sevr'e tırmanış |
| 5 | "en kritik an yaşanacaktı" | → | EP6: İz sürücü izleri buldu |
| 6 | "görülmemiş bir ödül ilanı" | → | EP7: Kureyş panikledi, yüz deve |
| 7 | "kumda taze izler buldu" | → | EP8: Süraka yaklaşıyor |
| 8 | "18 yıl sonra söz yerine geldi" | → | EP9: 8 günlük yolculuk |
| 9 | "çoktan anlamıştı" | → | EP10: Hurma bahçeleri göründü |
| 10 | "Hz. Ali gelinceye kadar girilmeyecek" | → | EP11: Medine uyandı |
| 11 | "kalabalık nefesini tuttu" | → | EP12: Deve üç kez çöktü |

---

## Event Ownership

Each event belongs to exactly ONE episode. Never tell the same event twice.

| Event | Episode | Scene |
|-------|---------|-------|
| Ali yatakta bulunması | EP4 only | S6 |
| Suikastçılar kapıda bekler | EP3 (gece) + EP4 (sabah keşfi) | |
| Mağaraya ulaşma | EP5 only | |
| Örümcek ağı mucizesi | EP6 only | |
| Süraka olayı | EP8 only | |
| Deve çökmesi | EP12 only | |

---

## Quran Verses Used

| EP | Verse | Topic |
|----|-------|-------|
| 1 | Bakara 2:218 | Hope for those who emigrate |
| 2 | Enfal 8:30 | Allah foils enemy plots |
| 3 | Bakara 2:207 | Those who sacrifice their lives |
| 4 | Yasin 36:9 | Eyes veiled |
| 6 | Tevbe 9:40 | "Don't grieve, Allah is with us" |
| 10 | Tevbe 9:108 | Quba Mosque |

---

## Controversial Points (Resolved)

| Topic | Resolution |
|-------|-----------|
| EP11 Tala'al-Bedru timing | Added "Rivayetlere göre" — disputed whether it was during Hijra or Badr |
| EP9 Guide Abdullah bin Uraykıt | Noted in VO that he was not Muslim |
| EP4 Hadith accuracy | Fixed typo ("hayırlısısın") + added source |

---

## Pipeline Status

- [x] Onboarding
- [x] Bible & episode outlines
- [x] All 12 episode scripts written
- [x] Quran verse verification
- [x] Hz./language corrections
- [x] Serhat approval on scripts
- [x] Assets created (10 characters + 14 locations)
- [x] Episode synopses written
- [x] Grid pipeline removed (approve = direct scene creation)
- [x] EP1 scene prompts written (v3, 8 scenes)
- [x] EP1 approved + scenes created
- [ ] EP1 video generation (in progress)
- [ ] EP2-EP12 scene prompts
- [ ] TTS generation
- [ ] Remaining video generation
- [ ] Final review & publish

---

## Feedback Log

### 2026-03-23

- **EP1 S1:** Background image ref unnecessary for Mekke establishing shot — removed
- **EP1 S2:** 14.5s too long for 2 shots → split to 3 shots (5s each)
- **EP1 S5:** Total duration should be 15s not 14s → fixed
- **EP1 S7:** 22s exceeds 15s max → split into S7 (10s) + S8 (7s)
- **General:** Max 15 seconds per scene rule established
- **General:** Don't put `9:16`, `@Element`, `@Image` in prompts — these are API parameters
- **General:** Don't bypass the endpoint — use the API, always dry run first
- **General:** $13-14 wasted on broken video generations — follow the workflow

### 2026-03-22

- **All episodes:** Scene prompts should be written episode by episode, not all at once (84 prompts = quality drop)
- **All episodes:** Multi-shot mandatory — no single-shot scenes for VO > 6s
- **EP7-EP8-EP9:** Chronology fixed (Sevr → mağaradan çıkış → ödül ilanı → Süraka → Ümmü Ma'bed)

---

## Revision History

### v3 (2026-03-23)
- EP1 split from 7 to 8 scenes (S7 exceeded 15s)
- All prompts cleaned: removed `@Element`, `@Image`, `9:16` tags
- `VIDEO_GENERATION_WORKFLOW.md` created to prevent future mistakes

### v2 (2026-03-22)
- EP3-EP4 overlap fixed (Ali yatakta = only EP4)
- Storyboard ID mapping fixed
- Transition map created

### v1 (2026-03-21)
- All 12 episodes rewritten from scratch
- Quran verses aligned with Diyanet meal
- Hz. prefixes added consistently
