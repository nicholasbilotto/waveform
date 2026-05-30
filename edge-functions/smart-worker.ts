import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { GoogleGenerativeAI } from "npm:@google/generative-ai";
import SunCalc from "npm:suncalc"; 

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

// --- HELPER: Parallel Weather Fetcher ---
async function fetchWeatherForSpot(spot: any, supabase: any, SG_API_KEY: string, isTomorrow: boolean) {
  const { slug, lat, lng, name } = spot;

  // 1. Check Cache
  const { data: cache } = await supabase
    .from('stormglass_cache')
    .select('*')
    .eq('location_slug', slug)
    .single();

  const isStale = !cache?.weather_data || 
    (new Date().getTime() - new Date(cache.updated_at).getTime() > 4 * 60 * 60 * 1000);

  let payload;

  if (!isStale) {
    payload = { ...cache.weather_data, source: 'cache' };
  } else {
    // 2. Fetch Fresh Data
    console.log(`⚡️ Fetching fresh weather for ${name}...`);
    const params = ["waveHeight", "wavePeriod", "swellHeight", "swellPeriod", "swellDirection", "windSpeed", "windDirection", "waterTemperature"].join(",");
    
    try {
      // Applied fetchWithTimeout here
      const [wRes, tRes] = await Promise.all([
        fetchWithTimeout(`https://api.stormglass.io/v2/weather/point?lat=${lat}&lng=${lng}&params=${params}&numberOfHours=48`, { headers: { Authorization: SG_API_KEY } }, 4000),
        fetchWithTimeout(`https://api.stormglass.io/v2/tide/extremes/point?lat=${lat}&lng=${lng}`, { headers: { Authorization: SG_API_KEY } }, 4000)
      ]);

      if (!wRes.ok) throw new Error(`Weather API error: ${wRes.status}`);
      
      const wData = await wRes.json();
      const tData = tRes.ok ? await tRes.json() : { data: [] };
      const hours = wData.hours || [];

      payload = {
        spot_metadata: { name, slug, lat, lng },
        tides: tData.data?.slice(0, 8) || [],
        full_forecast: hours.map((h: any) => ({
          time: h.time, 
          waveHeight: h.waveHeight?.sg || 0,
          windSpeed: h.windSpeed?.sg || 0,
          windDirection: h.windDirection?.sg || 0,
          swellPeriod: h.swellPeriod?.sg || 0,
          waterTemp: h.waterTemperature?.sg || "N/A"
        }))
      };

      await supabase.from('stormglass_cache').upsert(
        { location_slug: slug, weather_data: payload, updated_at: new Date().toISOString() },
        { onConflict: 'location_slug' }
      );

    } catch (err) {
      console.error(`❌ Failed to fetch ${name}:`, err);
      if (cache?.weather_data) payload = { ...cache.weather_data, source: 'stale_cache' };
      else return null;
    }
  }

  // 3. Filter Data
  const startIndex = isTomorrow ? 24 : 0;
  const endIndex = startIndex + 14; 

  return {
    spot_metadata: payload.spot_metadata,
    forecast_timeline: payload.full_forecast?.slice(startIndex, endIndex) || [], 
    tides: payload.tides
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { favorite_spots, user_id, client_hour = 12, force_refresh = false } = await req.json();

    if (!favorite_spots || !Array.isArray(favorite_spots) || favorite_spots.length === 0) {
      throw new Error("Missing 'favorite_spots' array.");
    }
    if (!user_id) throw new Error("Missing 'user_id'.");

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    const SG_API_KEY = Deno.env.get('STORMGLASS_API_KEY');
    const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY');

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
    const cacheKey = `top-pick-v4-${dayLabel.toLowerCase()}-${spotsFingerprint}`;
    
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
      spotsData.map(spot => fetchWeatherForSpot(spot, supabase, SG_API_KEY!, isTomorrow))
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
    const compressedCandidates = validReports.map(r => {
        const sunTimes = SunCalc.getTimes(targetDate, r.spot_metadata.lat, r.spot_metadata.lng);
        const fmt = (d: Date) => d.toLocaleTimeString("en-US", {
            hour: 'numeric', 
            minute:'2-digit',
            timeZone: "America/Los_Angeles"
        });
        
        return {
            name: r.spot_metadata.name,
            slug: r.spot_metadata.slug,
            sun_data: { sunrise: fmt(sunTimes.sunrise), sunset: fmt(sunTimes.sunset) },
            // Apply Token Saver Here
            forecast_summary: compressHourlyData(r.forecast_timeline) 
        };
    });

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