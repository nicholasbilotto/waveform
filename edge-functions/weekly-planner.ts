// ✅ USE THIS: CDN Imports (No config file needed)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.17.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- HELPER: Fetch 7 Days of Weather ---
async function fetchWeekForecast(spot: any, supabase: any, SG_API_KEY: string) {
  const { slug, lat, lng, name } = spot;

  // 1. Check the NEW Table (weekly_weather_cache)
  const { data: cache } = await supabase
    .from('weekly_weather_cache') 
    .select('*')
    .eq('location_slug', slug)
    .single();

  // Stale if cache is missing OR older than 6 hours
  const isStale = !cache?.weather_data || 
    (new Date().getTime() - new Date(cache.updated_at).getTime() > 6 * 60 * 60 * 1000);

  if (!isStale) {
    console.log(`✨ Using cached 7-day data for ${name}`);
    return { ...cache.weather_data, source: 'cache' };
  }

  // 2. Fetch Fresh 7-Day Data (If Stale)
  console.log(`⚡️ Fetching fresh 7-day forecast for ${name}...`);
  
  const now = Math.floor(Date.now() / 1000);
  const end = now + (7 * 24 * 60 * 60); // 7 days later
  
  const params = [
    "waveHeight", "swellHeight", "swellPeriod", "windSpeed", "windDirection", "waterTemperature"
  ].join(",");
  console.log("Starting Stormglass call at:", new Date().toISOString())
  try {
    const res = await fetch(
      `https://api.stormglass.io/v2/weather/point?lat=${lat}&lng=${lng}&params=${params}&start=${now}&end=${end}`, 
      { headers: { Authorization: SG_API_KEY } }
    );

    if (!res.ok) throw new Error(`Weather API error: ${res.status}`);
    const data = await res.json();
    const hours = data.hours || [];

    // 3. Compact the Data
    // We Map 0-23h to ensure we don't miss afternoon swells due to timezone shifts
    const relevantHours = hours.map((h: any) => ({
        time: h.time,
        waveHeight: h.waveHeight?.sg || 0,
        swellPeriod: h.swellPeriod?.sg || 0,
        windSpeed: h.windSpeed?.sg || 0,
        windDirection: h.windDirection?.sg || 0,
        waterTemp: h.waterTemperature?.sg || 0
    }));

    const payload = {
      spot_metadata: { name, slug, lat, lng },
      forecast_hourly: relevantHours 
    };

    // Save to the NEW Table
    await supabase.from('weekly_weather_cache').upsert(
      { location_slug: slug, weather_data: payload, updated_at: new Date().toISOString() },
      { onConflict: 'location_slug' }
    );

    return { ...payload, source: 'api' };

  } catch (err) {
    console.error(`❌ Failed to fetch ${name}:`, err);
    return null;
  }
}

// --- HELPER: Summarize for AI (Token Saver) ---
function generateDailySummary(weatherData: any[]) {
    const dailyMap: any = {};

    weatherData.forEach(h => {
        const date = h.time.split("T")[0]; // YYYY-MM-DD
        if (!dailyMap[date]) dailyMap[date] = { waves: [], winds: [] };
        dailyMap[date].waves.push(h.waveHeight);
        dailyMap[date].winds.push(h.windSpeed);
    });

    // Return simple averages/max for each day
    return Object.keys(dailyMap).slice(0, 7).map(date => {
        const d = dailyMap[date];
        const avgWave = d.waves.reduce((a:any, b:any) => a + b, 0) / d.waves.length;
        const maxWave = Math.max(...d.waves);
        const avgWind = d.winds.reduce((a:any, b:any) => a + b, 0) / d.winds.length;
        return { date, avgWave: avgWave.toFixed(1), maxWave: maxWave.toFixed(1), avgWind: avgWind.toFixed(1) };
    });
}

// --- MAIN HANDLER ---
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { favorite_spots, user_id } = await req.json();
    
    // --- SETUP ---
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    const SG_API_KEY = Deno.env.get('STORMGLASS_API_KEY');
    const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY');

    // 🛡️ THE FIX: Cache Key Fingerprinting
    // Sorts the array alphabetically so ["A", "B"] and ["B", "A"] generate the exact same cache key
    const spotsFingerprint = [...favorite_spots].sort().join('-');
    const cacheKey = `weekly-${spotsFingerprint}`;

    // --- 1. CHECK WEEKLY CACHE ---
    const { data: aiCache } = await supabase
      .from('ai_content_cache')
      .select('*')
      .eq('location_slug', cacheKey) // <-- Using the unique fingerprint!
      .eq('user_id', user_id)
      .single();

    const cacheAge = aiCache ? new Date().getTime() - new Date(aiCache.updated_at).getTime() : 999999999;
    
    // If AI result is fresh (< 4 hours), return it immediately
    if (aiCache && cacheAge < 4 * 60 * 60 * 1000) {
       console.log("✨ Returning cached Weekly Plan.");
       return new Response(JSON.stringify(aiCache.ai_response), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // --- 2. GATHER DATA ---
    const { data: spotsData } = await supabase.from('spots').select('*').in('slug', favorite_spots);
    if (!spotsData || spotsData.length === 0) throw new Error("No spots found");

    const weatherReports = await Promise.all(
      spotsData.map(spot => fetchWeekForecast(spot, supabase, SG_API_KEY!))
    );
    const validReports = weatherReports.filter(r => r !== null);

    // --- 3. PREPARE AI PROMPT (UPDATED LOGIC) ---
    const candidates = validReports.map((r: any) => ({
        name: r.spot_metadata.name,
        slug: r.spot_metadata.slug,
        daily_summary: generateDailySummary(r.forecast_hourly)
    }));

    const prompt = `
    You are a Local Surf Guide, not a harsh competition judge. 
    Analyze 7-day forecasts for: ${candidates.map(c => c.name).join(", ")}.
    DATA: ${JSON.stringify(candidates)}

    OBJECTIVE:
    Identify the best spot to surf for each day, but accurately describe the conditions. Most days are "Good" if they are surfable.

    STRICT RATING RULES (Traffic Light System):
    - "Fair" (Yellow): The standard rating. Usable waves, maybe some wind, or small but clean. (Use "bg-yellow-500").
    - "Good" (Green): Clean conditions, decent size, fun. This should be common for surfable days. (Use "bg-emerald-500").
    - "Poor" (Red): ONLY use if Flat (0-1ft) or terrible blown-out onshore wind. (Use "bg-red-500").
    - "Epic" (Gold): RARE. Only for perfect swell + perfect offshore. Use sparingly. (Use "bg-amber-400").

    VISUALIZATION RULES (Crucial):
    - You must generate a "val" (0-100) for EVERY day in the 'forecast' array.
    - "val" represents WAVE HEIGHT, not quality. 
    - 2ft = 20, 3ft = 35, 4ft = 50, 6ft+ = 80+.
    - NEVER set "val" to 0 unless the wave height is actually 0ft.
    - Even if a day is "Poor" (Red) because of wind, if it is 5ft, "val" must be 50.

    OUTPUT JSON format:
    {
      "summary_strip": [
        { 
          "day_name": "MON", 
          "date_num": "27", 
          "winner_slug": "beacons", 
          "rating": "Good", 
          "height": "3-4ft" 
        }, 
        ... (7 days)
      ],
      "spots_forecasts": [
        {
          "id": "spot_slug",
          "name": "Spot Name",
          "region": "Region Name",
          "primary_best_day_index": 2, 
          "forecast": [
            { 
               "day": "M", 
               "val": 40, (Height: 0-100)
               "color": "bg-emerald-500", (Rating Color)
               "label": "3-4ft",
               "wind": "Glassy",
               "time": "6am-9am" 
            },
            ... (7 days)
          ]
        }
        ... (all spots)
      ]
    }
    `;

    // --- 4. GENERATE & CACHE ---
    const genAI = new GoogleGenerativeAI(GEMINI_KEY!);
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" }); 
    console.log("Starting Gemini call at:", new Date().toISOString())
    const result = await model.generateContent(prompt);
    const responseText = result.response.text().replace(/```json|```/g, "").trim();
    
    // 🛡️ SAFE PARSING BLOCK
    let finalJson;
    try {
        finalJson = JSON.parse(responseText);
    } catch (parseError) {
        console.error("🚨 AI returned invalid JSON:", responseText);
        throw new Error("AI formatting failed. Please refresh to try again.");
    }

    // Save
    await supabase.from('ai_content_cache').upsert({ 
        location_slug: cacheKey, // <-- Using the unique fingerprint!
        user_id: user_id, 
        ai_response: finalJson, 
        updated_at: new Date().toISOString() 
    }, { onConflict: 'location_slug,user_id' });

    return new Response(JSON.stringify(finalJson), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error("Function Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});