import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai";
import SunCalc from "npm:suncalc";
import {
  mapOpenMeteoToRows,
  sliceTodayHours,
  findNearestStation,
  parseNoaaTides,
  SOCAL_STATIONS,
} from "./transforms.ts";
import type { ForecastRow, Tide } from "./transforms.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- UPDATE 1: HELPER: Timeout Fetch ---
async function fetchWithTimeout(url: string, options: any = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error; 
  }
}

// --- UPDATE 2: HELPER: Token Saver (Compress Hourly Data) ---
function compressHourlyData(forecastTimeline: any[]) {
    return forecastTimeline.map(h => {
        // Convert ISO string to just the hour (e.g., "8 AM")
        const timeStr = new Date(h.time).toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            timeZone: 'America/Los_Angeles' 
        });
        // Compress the data into a dense string
        return `${timeStr}: Wave ${Number(h.waveHeight).toFixed(1)}m, Swell ${Number(h.swellPeriod).toFixed(1)}s, Wind ${Number(h.windSpeed).toFixed(1)}ms @ ${Number(h.windDirection).toFixed(0)}°, Temp ${h.waterTemp}`;
    });
}

// --- HELPER: Parallel Weather Fetcher (Open-Meteo + NOAA CO-OPS) ---
const WEATHER_CACHE_TTL_MS = 1 * 60 * 60 * 1000; // 1h (tightened per PRD §6)
const TZ = "America/Los_Angeles";

async function fetchWeatherForSpot(spot: any, supabase: any, clientHour: number) {
  const { slug, lat, lng, name } = spot;

  // 1. Check Cache
  const { data: cache } = await supabase
    .from('stormglass_cache')
    .select('*')
    .eq('location_slug', slug)
    .single();

  const isStale = !cache?.weather_data ||
    (new Date().getTime() - new Date(cache.updated_at).getTime() > WEATHER_CACHE_TTL_MS);

  // payload holds the full (un-sliced) forecast_timeline + tides
  let payload: { forecast_timeline: ForecastRow[]; tides: Tide[] } | null = null;

  if (!isStale) {
    payload = cache.weather_data;
  } else {
    // 2. Fetch Fresh Data
    console.log(`⚡️ Fetching fresh weather for ${name}...`);

    const marineUrl =
      `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}` +
      `&hourly=wave_height,wave_period,sea_surface_temperature&timezone=${TZ}&forecast_days=2`;
    const forecastUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&timezone=${TZ}&forecast_days=2`;

    const station = findNearestStation(lat, lng, SOCAL_STATIONS);
    const tideUrl = station
      ? `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&interval=hilo&datum=MLLW&time_zone=lst_ldt&units=english&format=json&station=${station.id}&date=today`
      : null;

    try {
      const [marineRes, forecastRes, tideRes] = await Promise.all([
        fetchWithTimeout(marineUrl, {}, 4000),
        fetchWithTimeout(forecastUrl, {}, 4000),
        tideUrl ? fetchWithTimeout(tideUrl, {}, 4000) : Promise.resolve(null),
      ]);

      if (!marineRes.ok) throw new Error(`Marine API error: ${marineRes.status}`);
      if (!forecastRes.ok) throw new Error(`Forecast API error: ${forecastRes.status}`);

      const marineJson = await marineRes.json();
      const forecastJson = await forecastRes.json();

      // Map waves + wind into the internal row shape.
      const rows = mapOpenMeteoToRows(marineJson, forecastJson, TZ);

      // Tides (best-effort; non-fatal on failure).
      let tides: Tide[] = [];
      if (tideRes && tideRes.ok) {
        try {
          const tideJson = await tideRes.json();
          tides = parseNoaaTides(tideJson.predictions).tides;
        } catch (tideErr) {
          console.error(`⚠️ Tide parse failed for ${name}:`, tideErr);
        }
      }

      payload = { forecast_timeline: rows, tides };

      await supabase.from('stormglass_cache').upsert(
        { location_slug: slug, weather_data: payload, updated_at: new Date().toISOString() },
        { onConflict: 'location_slug' }
      );

    } catch (err) {
      console.error(`❌ Failed to fetch ${name}:`, err);
      if (cache?.weather_data) payload = cache.weather_data;
      else return null;
    }
  }

  if (!payload) return null;

  // 3. Slice to today's (or tomorrow's) relevant hours.
  const sliced = sliceTodayHours(payload.forecast_timeline ?? [], clientHour);

  return {
    spot_metadata: { name, slug, lat, lng },
    forecast_timeline: sliced,
    tides: payload.tides ?? [],
  };
}

// --- HELPER: Compact tide summary for the AI prompt ---
function summarizeTides(tides: Tide[], now: Date = new Date()) {
  if (!tides || tides.length === 0) return null;

  const parse = (t: string) => new Date(t.replace(" ", "T")).getTime();
  const fmt = (t: string) =>
    new Date(t.replace(" ", "T")).toLocaleTimeString("en-US", {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: TZ,
    });

  const nowMs = now.getTime();
  let nextHigh: Tide | null = null;
  let nextLow: Tide | null = null;
  for (const t of tides) {
    const tMs = parse(t.time);
    if (Number.isNaN(tMs) || tMs < nowMs) continue;
    if (t.type === "H" && (!nextHigh || tMs < parse(nextHigh.time))) nextHigh = t;
    if (t.type === "L" && (!nextLow || tMs < parse(nextLow.time))) nextLow = t;
  }

  // Direction: rising if the next extreme is a High, falling if it's a Low.
  let direction = "unknown";
  const nextHighMs = nextHigh ? parse(nextHigh.time) : Infinity;
  const nextLowMs = nextLow ? parse(nextLow.time) : Infinity;
  if (nextHighMs < nextLowMs) direction = "rising";
  else if (nextLowMs < nextHighMs) direction = "falling";

  return {
    next_high: nextHigh ? `${fmt(nextHigh.time)} (${nextHigh.height.toFixed(1)}ft)` : "n/a",
    next_low: nextLow ? `${fmt(nextLow.time)} (${nextLow.height.toFixed(1)}ft)` : "n/a",
    direction,
  };
}

// --- HELPER: Build a candidate object for the AI prompt from a weather report ---
function buildCandidate(r: any, targetDate: Date) {
  const sunTimes = SunCalc.getTimes(targetDate, r.spot_metadata.lat, r.spot_metadata.lng);
  const fmt = (d: Date) => d.toLocaleTimeString("en-US", {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: "America/Los_Angeles"
  });

  return {
    name: r.spot_metadata.name,
    slug: r.spot_metadata.slug,
    sun_data: { sunrise: fmt(sunTimes.sunrise), sunset: fmt(sunTimes.sunset) },
    tide_summary: summarizeTides(r.tides),
    forecast_summary: compressHourlyData(r.forecast_timeline),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY');

    // --- SINGLE-SPOT MODE (swipe pager lazy-load) ---
    // Short-circuits the multi-spot "pick a winner" logic. Weather is usually
    // warm in the cache from the daily call, so this only pays for one Gemini call.
    if (body.single_spot && body.user_id) {
      const slug: string = body.single_spot;
      const user_id: string = body.user_id;
      const client_hour: number = body.client_hour ?? 12;
      const force_refresh: boolean = body.force_refresh ?? false;

      // Profile (for tone, quiver, wetsuits)
      const { data: userProfile, error: userError } = await supabase
        .from('profiles').select('*').eq('id', user_id).single();
      if (userError) throw new Error("User profile not found");

      // Time window
      const isTomorrow = client_hour >= 20;
      const dayLabel = isTomorrow ? "TOMORROW" : "TODAY";
      const targetDate = new Date();
      if (isTomorrow) targetDate.setDate(targetDate.getDate() + 1);
      const dateString = targetDate.toLocaleDateString("en-US", { weekday: 'long', month: 'long', day: 'numeric' });

      // AI cache check
      const cacheKey = `single-${slug}-v5-${user_id}`;
      const { data: aiCache } = await supabase
        .from('ai_content_cache')
        .select('*')
        .eq('location_slug', cacheKey)
        .eq('user_id', user_id)
        .single();

      const cacheTime = aiCache ? new Date(aiCache.updated_at).getTime() : 0;
      const profileTime = userProfile.updated_at ? new Date(userProfile.updated_at).getTime() : 0;
      const aiIsStale = !aiCache?.ai_response || force_refresh ||
        (new Date().getTime() - cacheTime > 2 * 60 * 60 * 1000) ||
        (profileTime > cacheTime);

      if (!aiIsStale) {
        return new Response(JSON.stringify(aiCache.ai_response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      // Look up the spot
      const { data: spotRow, error: spotErr } = await supabase
        .from('spots').select('*').eq('slug', slug).single();
      if (spotErr || !spotRow) throw new Error(`Spot '${slug}' not found`);

      // Fetch weather (warm cache likely)
      const report = await fetchWeatherForSpot(spotRow, supabase, client_hour);
      if (!report) throw new Error(`Weather fetch failed for '${slug}'`);

      // Tone (same logic as the daily call)
      const skill = userProfile.skill_level || "Intermediate";
      let toneInstruction = "Use standard surf terminology. Be helpful and clear.";
      if (['Advanced', 'Pro'].some(s => skill.includes(s))) {
        toneInstruction = "Use technical, precise surf terminology. Keep analysis concise and expert-level.";
      }
      const quiverList = userProfile.quiver && userProfile.quiver.length > 0
        ? userProfile.quiver.join(", ")
        : userProfile.favorite_board || "Surfboard";
      const wetsuitList = userProfile.wetsuits && userProfile.wetsuits.length > 0
        ? userProfile.wetsuits.join(", ")
        : "3/2mm, 4/3mm, Trunks";

      const candidate = buildCandidate(report, targetDate);

      const genAI = new GoogleGenerativeAI(GEMINI_KEY!);
      const model = genAI.getGenerativeModel({
        model: "gemini-3-flash-preview",
        generationConfig: { responseMimeType: "application/json" }
      });

      const prompt = `
        You are an expert Surf Guide. ${toneInstruction}

        THE CONTEXT:
        - Current User Time: ${client_hour}:00
        - Forecasting For: ${dayLabel} (${dateString})
        - User Skill: ${skill}
        - User Quiver (STRICT): [${quiverList}]
        - User Wetsuits (STRICT): [${wetsuitList}]

        THE SPOT (Hourly Forecast Data):
        ${JSON.stringify(candidate)}

        YOUR TASK:
        1. Analyze conditions for THIS ONE SPOT for ${dayLabel}.
        2. IMPORTANT: If forecasting for TODAY, ONLY recommend an "optimal_time" that starts AFTER ${client_hour}:00.
        3. Assess Paddle Difficulty and Dangers.
        4. Use the EXACT Sunrise/Sunset times provided in the "sun_data" field above. Do not calculate your own.
        5. Factor in tides (see "tide_summary"): low tide exposes reef breaks, high tide is better for beach breaks. Prefer an optimal_time aligned with the favorable tide window.

        STRICT JSON FORMATTING & LENGTH RULES:
        - "human_scale": Must be exactly two numbers separated by a dash (e.g., "3-5"). NO "ft", NO text.
        - "human_relation": Text description of size (e.g. "Waist to Chest High").
        - "why_it_won": MAX 10 WORDS. Concise highlight of this spot's conditions.
        - "wave_description": MAX 2 SENTENCES. Focus on shape/power/surface texture. No fluff.
        - "optimal_window_description": MAX 2 Sentences. Poetic summary of the session.
        - "optimal_window_condition": MAX 3 WORDS. Explain the LIMITER (e.g., "Heavy Winds").
        - "paddle_difficulty": MAX 5 WORDS. e.g. "Moderate - heavy drift".
        - "danger_description": MAX 5 WORDS. e.g. "Shallow reef, urchins".
        - "is_tomorrow": Boolean. true if forecasting for tomorrow.
        - "board_recommendation": MUST be an EXACT string match from the User Quiver list provided above.
        - "board_rec_description": MAX 10 WORDS. Punchy reason.
        - "suggested_wetsuit": MUST be an EXACT string match from the User Wetsuits list provided above.
        - "sun": MUST be strictly ["sunrise string from data", "sunset string from data"]

        OUTPUT FORMAT (JSON Only, a SINGLE object — NOT an array):
        {
          "spot_info": {
              "name": "${report.spot_metadata.name}",
              "slug": "${report.spot_metadata.slug}",
              "rating": "Good",
              "human_scale": "3-5",
              "human_relation": "Waist to Chest"
          },
          "ai_analysis": {
            "is_tomorrow": ${isTomorrow},
            "why_it_won": "Highlight of conditions...",
            "wave_description": "Wave shape description...",
            "optimal_time": [start_hour_int, end_hour_int],
            "optimal_window_description": "Wind turns onshore at 2pm, but fades away as the sun goes down",
            "optimal_window_condition": "Light Winds",
            "sun": ["6:15 AM", "7:45 PM"],
            "board_recommendation": "Fish",
            "board_rec_description": "Perfect for these mushy sections.",
            "paddle_difficulty": "Easy Channel Paddle",
            "danger_description": "Crowded lineup"
          },
          "metadata": { "water_temp": "64°F", "suggested_wetsuit": "3/2mm", "crowd_prediction": "Moderate" }
        }
      `;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      let card: any;
      try {
        const parsed = JSON.parse(responseText);
        // Tolerate the model wrapping the object in an array.
        card = Array.isArray(parsed) ? parsed[0] : parsed;
      } catch (parseError) {
        console.error("Single-spot AI JSON Parse Failed. Raw Text:", responseText);
        throw new Error("AI returned invalid JSON.");
      }

      // Force the correct slug/name (model can drift) and attach raw data.
      card.spot_info = card.spot_info || {};
      card.spot_info.slug = report.spot_metadata.slug;
      card.spot_info.name = report.spot_metadata.name;
      card.raw_data = {
        forecast: report.forecast_timeline,
        tides: report.tides,
      };

      await supabase.from('ai_content_cache').upsert(
        {
          location_slug: cacheKey,
          user_id: user_id,
          ai_response: card,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'location_slug,user_id' }
      );

      return new Response(JSON.stringify(card), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // --- MULTI-SPOT (DAILY) MODE ---
    const { favorite_spots, user_id, client_hour = 12, force_refresh = false } = body;

    if (!favorite_spots || !Array.isArray(favorite_spots) || favorite_spots.length === 0) {
      throw new Error("Missing 'favorite_spots' array.");
    }
    if (!user_id) throw new Error("Missing 'user_id'.");

    // --- 0. PRE-FETCH USER PROFILE ---
    const { data: userProfile, error: userError } = await supabase
      .from('profiles').select('*').eq('id', user_id).single();
    
    if (userError) throw new Error("User profile not found");

    // --- 1. DETERMINE TIME WINDOW ---
    const isTomorrow = client_hour >= 20; 
    const dayLabel = isTomorrow ? "TOMORROW" : "TODAY";
    
    const targetDate = new Date();
    if (isTomorrow) targetDate.setDate(targetDate.getDate() + 1);
    const dateString = targetDate.toLocaleDateString("en-US", { weekday: 'long', month: 'long', day: 'numeric' });

    // --- 2. CHECK AI CACHE ---
    const spotsFingerprint = [...favorite_spots].sort().join('-');
    const cacheKey = `top-pick-v5-${dayLabel.toLowerCase()}-${spotsFingerprint}`;
    
    const { data: aiCache } = await supabase
      .from('ai_content_cache')
      .select('*')
      .eq('location_slug', cacheKey) 
      .eq('user_id', user_id)
      .single();

    const cacheTime = aiCache ? new Date(aiCache.updated_at).getTime() : 0;
    const profileTime = userProfile.updated_at ? new Date(userProfile.updated_at).getTime() : 0;

    const aiIsStale = !aiCache?.ai_response || force_refresh || 
      (new Date().getTime() - cacheTime > 2 * 60 * 60 * 1000) || 
      (profileTime > cacheTime);

    if (!aiIsStale) {
      return new Response(JSON.stringify(aiCache.ai_response), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // --- 3. GENERATE FRESH ---
    const { data: spotsData, error: spotsError } = await supabase
      .from('spots').select('*').in('slug', favorite_spots);
    if (spotsError || !spotsData) throw new Error("Could not find spot details");

    const weatherResults = await Promise.all(
      spotsData.map(spot => fetchWeatherForSpot(spot, supabase, client_hour))
    );
    
    const validReports = weatherResults.filter(r => r !== null);
    if (validReports.length === 0) throw new Error("All weather fetches failed.");

    // --- DYNAMIC TONE ---
    const skill = userProfile.skill_level || "Intermediate";
    let toneInstruction = "Use standard surf terminology. Be helpful and clear.";
    if (['Advanced', 'Pro'].some(s => skill.includes(s))) {
        toneInstruction = "Use technical, precise surf terminology. Keep analysis concise and expert-level.";
    }

    const quiverList = userProfile.quiver && userProfile.quiver.length > 0 
        ? userProfile.quiver.join(", ") 
        : userProfile.favorite_board || "Surfboard";

    const wetsuitList = userProfile.wetsuits && userProfile.wetsuits.length > 0
        ? userProfile.wetsuits.join(", ")
        : "3/2mm, 4/3mm, Trunks"; 

    // --- 4. PREPARE COMPRESSED AI PROMPT DATA ---
    const compressedCandidates = validReports.map(r => buildCandidate(r, targetDate));

    // --- 5. AI GENERATION ---
    const genAI = new GoogleGenerativeAI(GEMINI_KEY!);
    const model = genAI.getGenerativeModel({ 
        model: "gemini-3-flash-preview",
        // UPDATE 3: Force Native JSON Mode
        generationConfig: { responseMimeType: "application/json" } 
    }); 

    const prompt = `
      You are an expert Surf Guide. 
      
      THE CONTEXT:
      - Current User Time: ${client_hour}:00
      - Forecasting For: ${dayLabel} (${dateString})
      - User Skill: ${skill}
      - User Quiver (STRICT): [${quiverList}]
      - User Wetsuits (STRICT): [${wetsuitList}]
      
      THE CANDIDATES (Hourly Forecast Data):
      ${JSON.stringify(compressedCandidates)}

      YOUR TASK:
      1. Analyze conditions for ${dayLabel}.
      2. IMPORTANT: If forecasting for TODAY, ONLY recommend an "optimal_time" that starts AFTER ${client_hour}:00.
      3. Pick the SINGLE best spot.
      4. Assess Paddle Difficulty and Dangers.
      5. Use the EXACT Sunrise/Sunset times provided in the "sun_data" field above. Do not calculate your own.
      6. Factor in tides (see "tide_summary"): low tide exposes reef breaks, high tide is better for beach breaks. Prefer an optimal_time aligned with the favorable tide window.

      STRICT JSON FORMATTING & LENGTH RULES:
      - "human_scale": Must be exactly two numbers separated by a dash (e.g., "3-5"). NO "ft", NO text.
      - "human_relation": Text description of size (e.g. "Waist to Chest High").
      - "why_it_won": MAX 10 WORDS. Concise reason.
      - "wave_description": MAX 2 SENTENCES. Focus on shape/power/surface texture. No fluff.
      - "optimal_window_description": MAX 2 Sentences. Poetic summary of the session.
      - "optimal_window_condition": MAX 3 WORDS. Explain the LIMITER (e.g., "Heavy Winds").
      - "paddle_difficulty": MAX 5 WORDS. e.g. "Moderate - heavy drift".
      - "danger_description": MAX 5 WORDS. e.g. "Shallow reef, urchins".
      - "is_tomorrow": Boolean. true if forecasting for tomorrow.
      - "board_recommendation": MUST be an EXACT string match from the User Quiver list provided above.
      - "board_rec_description": MAX 10 WORDS. Punchy reason.
      - "suggested_wetsuit": MUST be an EXACT string match from the User Wetsuits list provided above.
      - "sun": MUST be strictly ["sunrise string from data", "sunset string from data"]

      OUTPUT FORMAT (JSON Only):
      [{
        "spot_info": { 
            "name": "Winner Name", 
            "slug": "winner-slug", 
            "rating": "Good", 
            "human_scale": "3-5", 
            "human_relation": "Waist to Chest"
        },
        "ai_analysis": {
          "is_tomorrow": ${isTomorrow},
          "why_it_won": "Comparison reasoning...",
          "wave_description": "Wave shape description...",
          "optimal_time": [start_hour_int, end_hour_int],
          "optimal_window_description": "Wind turns onshore at 2pm, but fades away as the sun goes down",
          "optimal_window_condition": "Light Winds",
          "sun": ["6:15 AM", "7:45 PM"], 
          "board_recommendation": "Fish", 
          "board_rec_description": "Perfect for these mushy sections.",
          "paddle_difficulty": "Easy Channel Paddle",
          "danger_description": "Crowded lineup"
        },
        "metadata": { "water_temp": "64°F", "suggested_wetsuit": "3/2mm", "crowd_prediction": "Moderate" }
      }]
    `;

    const result = await model.generateContent(prompt);
    // Because of responseMimeType, we don't need the regex matching anymore.
    const responseText = result.response.text(); 

    let finalJson;
    try {
        finalJson = JSON.parse(responseText);
        
        // --- INJECT RAW DATA FOR THE WINNING SPOT ---
        if (finalJson && finalJson.length > 0) {
            const winnerSlug = finalJson[0].spot_info.slug;
            const winnerData = validReports.find(r => r.spot_metadata.slug === winnerSlug);
            
            if (winnerData) {
                // Attach the UNCOMPRESSED raw data directly to the final response
                finalJson[0].raw_data = {
                    forecast: winnerData.forecast_timeline,
                    tides: winnerData.tides
                };
            }
        }

    } catch (parseError) {
        console.error("AI JSON Parse Failed. Raw Text:", responseText);
        throw new Error("AI returned invalid JSON.");
    }

    await supabase.from('ai_content_cache').upsert(
      { 
        location_slug: cacheKey, 
        user_id: user_id, 
        ai_response: finalJson, 
        updated_at: new Date().toISOString() 
      },
      { onConflict: 'location_slug,user_id' }
    );

    return new Response(JSON.stringify(finalJson), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("Worker Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});