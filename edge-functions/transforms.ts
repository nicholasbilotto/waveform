// transforms.ts
//
// Pure transform functions for the Waveform marine-data pipeline.
//
// These have NO Deno / Supabase / network dependencies so they can be unit
// tested in isolation. They are intentionally the riskiest pieces of the
// Stormglass -> Open-Meteo + NOAA CO-OPS migration, hence the heavy test
// coverage in transforms_test.ts.
//
// Internal row shape (matches what smart-worker.ts already produces from the
// Stormglass response, so downstream code — compressHourlyData, the AI prompt,
// raw_data injection — does not need to change):
//
//   { time, waveHeight, windSpeed, windDirection, swellPeriod, waterTemp }
//
// UNITS (must stay consistent across every data source):
//   waveHeight   -> meters (m)
//   windSpeed    -> meters/second (m/s)
//   windDirection-> degrees (0-360)
//   swellPeriod  -> seconds (s)
//   waterTemp    -> degrees Celsius (°C)

export interface ForecastRow {
  time: string;
  waveHeight: number;
  windSpeed: number;
  windDirection: number;
  swellPeriod: number;
  waterTemp: number;
}

export interface OpenMeteoMarine {
  hourly: {
    time: string[];
    wave_height: number[];
    wave_period: number[];
    sea_surface_temperature: number[];
  };
}

export interface OpenMeteoForecast {
  hourly: {
    time: string[];
    wind_speed_10m: number[];
    wind_direction_10m: number[];
  };
}

export interface NoaaStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface TidePrediction {
  t: string; // "2026-05-30 06:14"
  v: string; // "4.532"
  type: "H" | "L";
}

export interface Tide {
  time: string;
  height: number;
  type: "H" | "L";
}

/**
 * Zip Open-Meteo's columnar marine + forecast responses into the internal
 * row shape.
 *
 * Open-Meteo is split across two endpoints:
 *   - the Marine API   -> wave_height, wave_period, sea_surface_temperature
 *   - the Forecast API -> wind_speed_10m, wind_direction_10m
 *
 * Both are requested with hourly resolution and the SAME timezone, so their
 * `time` arrays are expected to line up index-for-index. We align defensively
 * by building a lookup keyed on the forecast timestamps rather than assuming
 * the arrays are the same length.
 *
 * IMPORTANT: Open-Meteo's wind_speed_10m defaults to km/h. The migration MUST
 * request `&wind_speed_unit=ms`. This function does NOT convert units — it
 * trusts the caller requested m/s — so the units test in transforms_test.ts is
 * the guard rail that catches a forgotten `wind_speed_unit=ms` parameter.
 *
 * @param marine    Open-Meteo Marine API response
 * @param forecast  Open-Meteo Forecast API response (wind)
 * @param _timezone The timezone both APIs were queried with (kept for signature
 *                  parity / future use; alignment is done by timestamp).
 */
export function mapOpenMeteoToRows(
  marine: OpenMeteoMarine,
  forecast: OpenMeteoForecast,
  _timezone: string,
): ForecastRow[] {
  const mh = marine?.hourly;
  const fh = forecast?.hourly;

  if (!mh?.time || !fh?.time) return [];

  // Build wind lookup by timestamp so a length/offset mismatch between the two
  // APIs cannot silently shift wind data onto the wrong hour.
  const windByTime = new Map<string, { speed: number; dir: number }>();
  for (let i = 0; i < fh.time.length; i++) {
    windByTime.set(fh.time[i], {
      speed: num(fh.wind_speed_10m?.[i]),
      dir: num(fh.wind_direction_10m?.[i]),
    });
  }

  const rows: ForecastRow[] = [];
  for (let i = 0; i < mh.time.length; i++) {
    const time = mh.time[i];
    const wind = windByTime.get(time) ?? { speed: 0, dir: 0 };
    rows.push({
      time,
      waveHeight: num(mh.wave_height?.[i]),
      windSpeed: wind.speed,
      windDirection: wind.dir,
      swellPeriod: num(mh.wave_period?.[i]),
      waterTemp: num(mh.sea_surface_temperature?.[i]),
    });
  }

  return rows;
}

/**
 * Slice a midnight-aligned hourly array down to the hours that matter for the
 * surf window.
 *
 * Assumes index 0 == 00:00 local time and the array spans at least 48 hours
 * (today + tomorrow), which is what the Open-Meteo request asks for.
 *
 * Rules:
 *   - clientHour >= 20  -> it's late; flip to tomorrow and return hours 0-23 of
 *                          the next day (indices 24-47).
 *   - otherwise         -> return from clientHour through the last reasonable
 *                          surf hour (LAST_SURF_HOUR, inclusive) for today.
 */
export function sliceTodayHours(
  rows: ForecastRow[],
  clientHour: number,
): ForecastRow[] {
  const LAST_SURF_HOUR = 20; // 8 PM, inclusive

  if (clientHour >= 20) {
    // Tomorrow: full day 0:00..23:00 -> indices 24..47.
    return rows.slice(24, 48);
  }

  const start = Math.max(0, clientHour);
  // +1 because LAST_SURF_HOUR is inclusive (slice end is exclusive).
  const end = LAST_SURF_HOUR + 1;
  return rows.slice(start, end);
}

/**
 * Find the nearest NOAA station to a spot using the Haversine great-circle
 * distance. Returns null if the station list is empty.
 */
export function findNearestStation(
  lat: number,
  lng: number,
  stations: NoaaStation[],
): NoaaStation | null {
  if (!stations || stations.length === 0) return null;

  let best: NoaaStation = stations[0];
  let bestDist = haversineKm(lat, lng, best.lat, best.lng);

  for (let i = 1; i < stations.length; i++) {
    const d = haversineKm(lat, lng, stations[i].lat, stations[i].lng);
    if (d < bestDist) {
      bestDist = d;
      best = stations[i];
    }
  }

  return best;
}

/**
 * Default SoCal CO-OPS tide stations.
 */
export const SOCAL_STATIONS: NoaaStation[] = [
  { id: "9410230", name: "La Jolla", lat: 32.867, lng: -117.254 },
  { id: "9410170", name: "San Diego", lat: 32.714, lng: -117.174 },
  { id: "9410660", name: "Los Angeles", lat: 33.720, lng: -118.272 },
  { id: "9410840", name: "Santa Monica", lat: 34.008, lng: -118.500 },
  { id: "9410580", name: "Newport Beach", lat: 33.618, lng: -117.878 },
];

/**
 * Parse NOAA CO-OPS tide predictions (hi/lo extremes) into the internal Tide
 * shape, then find the next high and next low relative to `now`.
 *
 * NOAA timestamps come back as "YYYY-MM-DD HH:mm" in the station's local time
 * (we request time_zone=lst_ldt). We parse them with new Date(...) using the
 * same convention as `now` so comparisons are apples-to-apples. The caller is
 * responsible for passing a `now` consistent with the prediction timezone.
 */
export function parseNoaaTides(
  predictions: TidePrediction[],
  now: Date = new Date(),
): { tides: Tide[]; nextHigh: Tide | null; nextLow: Tide | null } {
  const tides: Tide[] = (predictions ?? []).map((p) => ({
    time: p.t,
    height: num(p.v),
    type: p.type,
  }));

  const nowMs = now.getTime();
  let nextHigh: Tide | null = null;
  let nextLow: Tide | null = null;

  for (const tide of tides) {
    const tMs = parseNoaaTime(tide.time);
    if (Number.isNaN(tMs) || tMs < nowMs) continue;

    if (tide.type === "H") {
      if (nextHigh === null || tMs < parseNoaaTime(nextHigh.time)) nextHigh = tide;
    } else if (tide.type === "L") {
      if (nextLow === null || tMs < parseNoaaTime(nextLow.time)) nextLow = tide;
    }
  }

  return { tides, nextHigh, nextLow };
}

// --- internal helpers ---

/** Coerce possibly-string/null/undefined numeric fields to a number (0 fallback). */
function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Parse a NOAA "YYYY-MM-DD HH:mm" timestamp to epoch ms. */
function parseNoaaTime(t: string): number {
  // Replace the space with 'T' so Date parses it as local time consistently.
  return new Date(t.replace(" ", "T")).getTime();
}

/** Haversine great-circle distance in kilometers. */
function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371; // Earth radius km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
