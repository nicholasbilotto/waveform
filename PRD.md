# Waveform — Launch PRD: Provider Migration + Speed + Swipe

**Owner:** Nick Bilotto
**Author:** drafted with Claude (grill-me session)
**Created:** 2026-05-30 (Sat)
**Target:** Final, tested **TestFlight** build by **2026-06-01 (Mon)**
**Status:** Draft — pending final confirmation before implementation

---

## 1. Summary

Waveform is a "just tell me where to surf" app. You preload your favorite SoCal spots and your gear (quiver, wetsuits, skill) once; every open returns a single decisive answer — *conditions are X, the best spot for you today is Y, bring this board, go.* The answer is personalized by the LLM to your ability and gear.

This PRD covers four pieces of work to get to a final launch build:

1. **Cost** — move off paid **Stormglass** to **free** data (Open-Meteo + NOAA). Only the LLM should cost money.
2. **Speed** — cut cold-open latency from **20–60s → ~5–8s**, instant when warm. Speed is existential: a slow answer defeats the app's entire purpose.
3. **Quality** — feed **tides** (and all conditions) into the LLM prompt; today tides are fetched but never used.
4. **Feature** — home screen becomes a **swipe pager** across the best spot + your other favorites (lazy-loaded so it doesn't hurt speed).

Plus targeted **unit tests** + a **manual QA checklist** before the TestFlight cut.

---

## 2. Background & problem statement

- The app **worked ~1 month ago** but was **too slow** (20–60s per cold load). Root causes are identified below — they are fixable without a rearchitecture.
- The marine data provider is **Stormglass** (paid). The owner mistakenly believed it was Open-Meteo. Goal: **stop paying for data**.
- The owner believed tides were fed to the LLM. **They are not** — only wave/swell/wind/temp reach Gemini ([smart-worker.ts:34](edge-functions/smart-worker.ts:34), [:203](edge-functions/smart-worker.ts:203)). Tides are fetched, cached, injected into `raw_data.tides`, and never rendered or prompted.
- The home screen shows only the single best spot. The owner wants to swipe to other favorites — **only if speed is preserved**.
- Distribution is already on **TestFlight** for the owner + testers. Goal is a polished "final version," tested on-device first.

### Stack (as-is)
- **Client:** Expo (~54), Expo Router, React 19, NativeWind, `@gorhom/bottom-sheet`, reanimated/gesture-handler.
- **Backend:** Supabase — Auth, Postgres, Edge Functions (Deno).
- **AI:** Google Gemini (`gemini-3-flash-preview`).
- **Edge functions:** `smart-worker` (daily best-spot pick), `weekly-planner` (7-day outlook). Live in Supabase; mirrored in `edge-functions/` in the repo. **Owner deploys to Supabase manually after each edit.**
- **Data scope:** SoCal only — `spots` table filtered to counties `["LA","OC","SD"]` ([SpotSelector.tsx:71](components/SpotSelector.tsx:71)), each with `lat`/`lng`.
- **Personalization:** `profiles` table — `skill_level`, `stance`, `quiver`, `wetsuits`, `crowd_tolerance`, `wind_preference`, `favorite_spots`.

---

## 3. Goals / Non-goals

### Goals
- G1. Zero recurring **data** cost (Open-Meteo + NOAA are keyless/free). Gemini remains the only paid dependency.
- G2. Cold home open **≤ ~8s**; warm open (within 2h) **< 1s**.
- G3. Tides included in the LLM prompt and reflected in predictions.
- G4. Home swipe pager across best spot + other favorites, lazy-loaded.
- G5. Unit tests for the risky data transforms + a manual QA checklist; verified on device + testers.
- G6. Final TestFlight build by Mon Jun 1.

### Non-goals (this cycle)
- Public App Store submission/review (post-launch).
- Scheduled pre-warming cron (post-launch optional; would make even cold opens instant).
- Android verification (unless owner confirms it's in scope).
- Rebuilding auth, onboarding, or the weekly UI beyond the changes below.
- Real hourly tide chart rendering (we wire swell/wind charts only — see §10).

---

## 4. Success metrics

| Metric | Today | Target |
|---|---|---|
| Cold home open (cache miss) | 20–60s | ≤ ~8s |
| Warm home open (<2h cache) | varies | < 1s |
| Home blocked by weekly call | Yes | No (decoupled) |
| Marine data cost | Paid (Stormglass) | $0 |
| Tides in LLM prompt | No | Yes |
| New API keys to manage | — | 0 (Open-Meteo/NOAA keyless) |
| Swipe across favorites | N/A | Works, lazy-loaded |

---

## 5. Current architecture (as-is) & identified latency causes

**Flow:** Client `ForecastProvider.refreshAll()` calls `smart-worker` (daily) and `weekly-planner` (weekly) in parallel, each capped at 20s. Both fetch Stormglass weather (per spot, cached) → one Gemini call → cache result.

**Identified causes of the 20–60s:**
1. **Home blocks on the weekly call.** `isInitialized` only flips true after *both* daily and weekly settle ([ForecastProvider.tsx:151-180](providers/ForecastProvider.tsx:151)). The home tab doesn't use weekly data, but its spinner waits for it.
2. **`weekly-planner` has no fetch timeout** ([weekly-planner.ts:41](edge-functions/weekly-planner.ts:41)) and isn't in JSON mode — it regex-strips the response ([:219](edge-functions/weekly-planner.ts:219)), slower and more failure-prone than `smart-worker`'s native JSON mode.
3. **Cold starts** — `npm:` imports in `smart-worker` ([:2-3](edge-functions/smart-worker.ts:2)) resolve slowly on a cold Deno isolate.
4. **LLM floor** — a genuine Gemini generation is the irreducible cost on a cache miss; with ~1–2×/day opens >2h apart, opens usually hit this path.
5. **Cosmetic/correctness:** the pull-to-refresh comment says "do not force an AI token burn" directly above a forced `refreshAll(true)` ([index.tsx:55](app/(tabs)/index.tsx:55), [forecast.tsx:59](app/(tabs)/forecast.tsx:59)). Forcing on *manual* pull is correct; the comment is just wrong and should be cleaned.

**Caching (keep):** weather per-spot (`stormglass_cache` 4h, `weekly_weather_cache` 6h); AI per (spot-fingerprint, user) in `ai_content_cache` (daily 2h, weekly 4h).

---

## 6. Target architecture (to-be)

### Data sources (all free, keyless)
| Need | Source | Endpoint |
|---|---|---|
| Waves, swell (height/period/direction), sea-surface temp | **Open-Meteo Marine** | `https://marine-api.open-meteo.com/v1/marine` |
| Wind (speed/direction) | **Open-Meteo Forecast** | `https://api.open-meteo.com/v1/forecast` |
| Tides (high/low predictions) | **NOAA CO-OPS** | `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter` |

- **Units (must match the existing prompt labels so AI behavior is unchanged):** wave height **m**, period **s**, wind **m/s** (`wind_speed_unit=ms`), sea-surface temp **°C**. The LLM already converts m→ft (`human_scale`) and °C→°F (`water_temp`); keep that.
- **Timezone:** request `timezone=America/Los_Angeles`. Open-Meteo then returns **midnight-aligned** hourly arrays (index 0 = 00:00 local), unlike Stormglass which started at "now." The today/tomorrow slicing must be re-derived from `client_hour` (see §7, R3).
- **Response shape:** Open-Meteo returns **columnar** arrays (`{hourly:{time:[...], wave_height:[...]}}`). We zip these into the existing internal row shape `{time, waveHeight, windSpeed, windDirection, swellPeriod, waterTemp}` so downstream code and the prompt are unchanged.
- **NOAA station mapping:** embed a small list of SoCal CO-OPS tide stations (LA/OC/SD) with lat/lng in the edge function; pick the **nearest** station to each spot. No DB schema change. (Candidate stations incl. La Jolla `9410230`, San Diego `9410170`, Los Angeles `9410660`, Santa Monica `9410840`, Newport Beach — final IDs verified during build.)

### Speed model
- Home fires **only the daily** call and renders the moment it returns. **Weekly is lazy** (fetched on the Weekly tab), never blocking home.
- Keep the **2h** AI cache; opens within 2h are sub-second. Pull-to-refresh forces fresh. Tighten **weather** cache to ~1h so a fresh regen uses current data.
- Cold path made fast via: Open-Meteo's quick fetch (parallel + timeouts), native JSON mode on both functions, fastest stable model, and not waiting on weekly.

---

## 7. Detailed requirements

### Workstream A — Edge functions (owner deploys after each round)

**A1. `smart-worker` — replace Stormglass with Open-Meteo + NOAA**
- Rewrite `fetchWeatherForSpot` to call Open-Meteo Marine + Forecast (parallel, with `fetchWithTimeout`) and NOAA CO-OPS tides; map columnar → internal row shape; keep the cache read/write contract (table `stormglass_cache`, field `weather_data`).
- Acceptance: returns `{ spot_metadata, forecast_timeline:[{time,waveHeight,windSpeed,windDirection,swellPeriod,waterTemp}], tides:[{time,height,type}] }`; no Stormglass/`SG_API_KEY` references remain.

**A2. `smart-worker` — feed tides into the prompt**
- Add a compact tide summary (e.g., next high/low times + heights, and tide state during the optimal window) into `compressedCandidates`, and add a line to the prompt instructing the guide to factor tide.
- Acceptance: the serialized prompt contains tide data for each candidate.

**A3. `smart-worker` — single-spot mode (for swipe)**
- Accept `{ single_spot: slug, user_id }`. Skip the "pick a winner" comparison; return the **same card schema** for just that spot. Reuse cached weather. Cache per `single-<slug>` + user with the 2h window.
- Acceptance: calling with one slug returns one spot's full analysis quickly (weather cache hit → LLM-only).

**A4. `smart-worker` — bump cache version**
- Change AI cache key `top-pick-v4-*` → `v5-*` so old (tide-less) responses are invalidated. Clear/expire `stormglass_cache` rows on deploy (shape-compatible, but stale Stormglass entries should refresh).

**A5. `weekly-planner` — Open-Meteo + hardening**
- Replace Stormglass with Open-Meteo (Marine + wind), `forecast_days=7`; add `fetchWithTimeout`; switch to **native JSON mode** (`responseMimeType: "application/json"`), remove regex stripping. Tides omitted from the weekly (coarse 7-day strip; tide not shown). Bump weekly cache key.
- Acceptance: weekly returns valid JSON without regex; no Stormglass refs; per-fetch timeouts in place.

**A6. Imports / cold start**
- Standardize on `esm.sh` ESM imports (drop `npm:` specifiers in `smart-worker`) to reduce cold-start import time. Keep `suncalc` for sunrise/sunset.

### Workstream B — Client speed

**B1. Decouple daily/weekly in `ForecastProvider`**
- Separate state + loading for daily vs weekly. Home init fetches **daily only**; flip `isInitialized` as soon as daily settles. Add a `fetchWeekly()` triggered lazily (Weekly tab focus).
- Acceptance: home renders with a valid daily pick without weekly having returned.

**B2. Refresh semantics**
- Respect the 2h cache on open (force=false). Keep `force=true` only on pull-to-refresh. Fix/remove the misleading comments. Spot add/remove naturally re-keys the cache (no forced bypass needed).

**B3. Weekly lazy load**
- In `forecast.tsx`, fetch weekly on tab focus if not loaded; own loading state; pull-to-refresh forces.

### Workstream C — Swipe feature (lazy per-spot)

**C1. Home pager (`index.tsx`)**
- Replace single-card render with a **horizontal paging FlatList** (`pagingEnabled`, no new dependency) over `[winnerSlug, ...otherFavoriteSlugs]`.
- Page 0 = winner (from the daily call). Pages 1..N lazy-load via single-spot mode (C2). Per-card loading spinner; **pre-fetch the neighbor**; page-indicator dots.
- Acceptance: swiping reveals each favorite; first paint of the winner is unchanged in speed; non-winner cards load on demand and cache.

**C2. Provider support for single-spot**
- Add `fetchSpotDetail(slug)` to `ForecastProvider` that calls `smart-worker` single-spot mode, caches per slug in provider state (2h), dedupes in-flight requests.

### Workstream D — Testing

**D1. Unit tests (pure transforms)**
- Open-Meteo columnar→row mapping; unit handling (m / m·s⁻¹ / °C) and label correctness; today vs tomorrow hour-slicing from `client_hour` incl. the ≥20:00 "tomorrow" rule; nearest-NOAA-station selection; NOAA predictions parse (next high/low). Pure functions extracted so they run under a lightweight runner (`deno test` alongside edge code, and/or ported into the app's test setup).
- Acceptance: tests pass; intentionally wrong units fail a test.

**D2. Manual QA checklist** — see §11; run on device + ≥1 tester before the TestFlight cut.

---

## 8. Data contracts (reference)

**Open-Meteo Marine** — `hourly=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_period,swell_wave_direction,sea_surface_temperature&timezone=America/Los_Angeles`

**Open-Meteo Forecast** — `hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&timezone=America/Los_Angeles`

**NOAA CO-OPS** — `product=predictions&interval=hilo&datum=MLLW&time_zone=lst_ldt&units=english&format=json&station=<id>&date=today` → `{predictions:[{t,v,type:"H"|"L"}]}`

**Internal weather row (unchanged):** `{ time, waveHeight, windSpeed, windDirection, swellPeriod, waterTemp }`
**Daily card schema (unchanged):** `spot_info{name,slug,rating,human_scale,human_relation}`, `ai_analysis{...}`, `metadata{water_temp,suggested_wetsuit,crowd_prediction}`, `raw_data{forecast,tides}`.

---

## 9. Sequencing & timeline

| Phase | When | Work | Gate |
|---|---|---|---|
| 0 | Sat | Test scaffolding for pure transforms (optional, recommended first) | runner green |
| 1 | Sat–Sun | A1–A6 edge migration + D1 unit tests | **owner deploys**, daily verified on device |
| 2 | Sun | B1–B3 decouple/speed + C1–C2 swipe pager | swipe + weekly verified on device |
| 3 | Sun–Mon | D2 manual QA on device + testers; polish | checklist passes |
| 4 | Mon | Bump iOS build number, EAS production build → **TestFlight** | build live |

---

## 10. Open implementation decisions (default unless you object)

1. **NOAA stations embedded** in the edge function (nearest by lat/lng); no DB change. *Default: yes.*
2. **Gemini model:** keep `gemini-3-flash-preview` (worked recently, fast tier). It's a *preview* model — small deprecation risk on a "final" build; can pin a stable Flash instead. *Default: keep, flag risk.*
3. **Dead "Timeline data unavailable" box** ([index.tsx:359](app/(tabs)/index.tsx:359)): `SwellChart`/`WindChart` already exist and `raw_data.forecast` is already returned — **wire them into the winner card** to fill it. *Default: wire up. Alt: remove the box.*
4. **Weather cache TTL** 4h → ~1h so fresh regenerations use current data. *Default: ~1h.*
5. **Discovered personalization gap (optional):** onboarding collects `wind_preference`, `crowd_tolerance`, `stance` but the daily prompt ignores them ([smart-worker.ts:220-279](edge-functions/smart-worker.ts:220)). Adding them is a cheap quality win. *Default: out of scope for Monday; flag for post-launch (or include if Phase 1 finishes early).*

---

## 11. Manual QA checklist (Workstream D2)

- [ ] Sign in / session persists across app restart
- [ ] Onboarding: all 5 steps, profile saves (skill, quiver, wetsuits, prefs, spots)
- [ ] Add/remove spots (≤5 limit enforced); home updates
- [ ] **Home cold open ≤ ~8s**; shows best pick + board from *my* quiver + wetsuit from *my* locker
- [ ] Home warm open (<2h) is near-instant
- [ ] Swipe: every favorite reachable; non-winner cards lazy-load; neighbor pre-fetched; dots correct
- [ ] Pull-to-refresh forces a fresh generation
- [ ] Weekly tab loads on open (not before); 7-day strip + per-spot cards render
- [ ] Error states: no spots, network failure, AI 503 "high demand"
- [ ] **Units sanity:** wave ft plausible vs a known source; wind reasonable; **tide high/low times match NOAA** for the station
- [ ] **Timezone:** after 8pm local, forecast flips to "Tomorrow"; optimal window starts after current hour for "Today"
- [ ] Verified on owner device **and** ≥1 tester via TestFlight

---

## 12. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Can't run deployed edge functions locally (Supabase secrets) | Slows verification | Extract pure logic for unit tests; provide curl snippets; tight edit→deploy→verify loop on device |
| `gemini-3-flash-preview` deprecated | AI calls fail | Pin a stable Flash model if it breaks |
| NOAA station far from a spot / accuracy | Tide slightly off | Nearest-station + correct datum (MLLW); document mapping |
| **Open-Meteo free tier is non-commercial** | Licensing for a paid/commercial app | Accepted for launch; upgrade (~€29/mo) or self-host later, or move waves to NOAA buoys if enforcement ever matters. NOAA + the data itself are unrestricted |
| Open-Meteo midnight-aligned indexing bug | Wrong hours shown | Dedicated unit tests for today/tomorrow slicing |
| Swipe output/round-trips grow latency | Slower home | Lazy per-spot (not all-in-one); reuse cached weather; pre-fetch only the neighbor |

---

## 13. Out of scope / post-launch backlog
- Scheduled pre-warm cron (instant cold opens given ~2×/day usage).
- Public App Store submission + review.
- Use `wind_preference` / `crowd_tolerance` / `stance` in the prompt (§10.5).
- Real hourly tide chart; Android parity pass; analytics on open latency.
