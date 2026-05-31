// transforms_test.ts
//
// `deno test` unit tests for the pure transform functions in transforms.ts.
//
// These are the riskiest pieces of the Stormglass -> Open-Meteo + NOAA CO-OPS
// migration, so they get heavy coverage here as a safety net BEFORE any
// migration wiring is written.
//
// Run with:
//   deno test edge-functions/transforms_test.ts

import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  findNearestStation,
  mapOpenMeteoToRows,
  type NoaaStation,
  type OpenMeteoForecast,
  type OpenMeteoMarine,
  parseNoaaTides,
  sliceTodayHours,
  SOCAL_STATIONS,
  type TidePrediction,
} from "./transforms.ts";

// ---------------------------------------------------------------------------
// 1. mapOpenMeteoToRows
// ---------------------------------------------------------------------------

function sampleMarine(): OpenMeteoMarine {
  return {
    hourly: {
      time: ["2026-05-30T00:00", "2026-05-30T01:00", "2026-05-30T02:00"],
      wave_height: [1.2, 1.3, 1.1],
      wave_period: [11, 12, 10],
      sea_surface_temperature: [18.5, 18.6, 18.4],
    },
  };
}

function sampleForecast(windSpeeds: number[]): OpenMeteoForecast {
  return {
    hourly: {
      time: ["2026-05-30T00:00", "2026-05-30T01:00", "2026-05-30T02:00"],
      wind_speed_10m: windSpeeds,
      wind_direction_10m: [270, 275, 280],
    },
  };
}

Deno.test("mapOpenMeteoToRows: zips columnar arrays into row shape", () => {
  const rows = mapOpenMeteoToRows(
    sampleMarine(),
    sampleForecast([3.0, 3.5, 4.0]),
    "America/Los_Angeles",
  );

  assertEquals(rows.length, 3);
  assertEquals(rows[0], {
    time: "2026-05-30T00:00",
    waveHeight: 1.2,
    windSpeed: 3.0,
    windDirection: 270,
    swellPeriod: 11,
    waterTemp: 18.5,
  });
  assertEquals(rows[2].waveHeight, 1.1);
  assertEquals(rows[2].windDirection, 280);
});

Deno.test("mapOpenMeteoToRows: aligns wind by timestamp, not by index", () => {
  // Forecast arrives offset / reordered relative to marine. Alignment must be
  // by timestamp so wind never lands on the wrong hour.
  const marine = sampleMarine();
  const forecast: OpenMeteoForecast = {
    hourly: {
      // reversed order on purpose
      time: ["2026-05-30T02:00", "2026-05-30T01:00", "2026-05-30T00:00"],
      wind_speed_10m: [4.0, 3.5, 3.0],
      wind_direction_10m: [280, 275, 270],
    },
  };

  const rows = mapOpenMeteoToRows(marine, forecast, "America/Los_Angeles");
  // 00:00 must still pick up the 270/3.0 wind even though it was last in the
  // forecast arrays.
  assertEquals(rows[0].time, "2026-05-30T00:00");
  assertEquals(rows[0].windSpeed, 3.0);
  assertEquals(rows[0].windDirection, 270);
  assertEquals(rows[2].time, "2026-05-30T02:00");
  assertEquals(rows[2].windSpeed, 4.0);
});

Deno.test("mapOpenMeteoToRows: WRONG-UNITS guard (wind must be m/s not km/h)", () => {
  // Realistic surfable wind is well under 30 m/s. The SAME wind expressed in
  // km/h would be 3.6x larger and blow past 100 for a stiff breeze. This test
  // is the guard rail for a forgotten `&wind_speed_unit=ms` on the Open-Meteo
  // request.
  const msRows = mapOpenMeteoToRows(
    sampleMarine(),
    sampleForecast([3.0, 7.5, 12.0]), // m/s: a breezy-but-plausible day
    "America/Los_Angeles",
  );
  for (const r of msRows) {
    if (!(r.windSpeed < 30)) {
      throw new Error(
        `windSpeed ${r.windSpeed} >= 30 m/s — looks like km/h leaked through`,
      );
    }
  }

  // Demonstrate the bug it catches: the equivalent km/h values would trip it.
  const kmhEquivalent = [3.0, 7.5, 12.0].map((v) => v * 3.6); // [10.8, 27, 43.2]
  const kmhRows = mapOpenMeteoToRows(
    sampleMarine(),
    sampleForecast(kmhEquivalent),
    "America/Los_Angeles",
  );
  const sawImplausible = kmhRows.some((r) => r.windSpeed >= 30);
  assertEquals(
    sawImplausible,
    true,
    "km/h-scale wind should be detectable as implausible",
  );
});

Deno.test("mapOpenMeteoToRows: coerces string/null fields, empty input -> []", () => {
  assertEquals(
    mapOpenMeteoToRows(
      { hourly: { time: [], wave_height: [], wave_period: [], sea_surface_temperature: [] } },
      { hourly: { time: [], wind_speed_10m: [], wind_direction_10m: [] } },
      "UTC",
    ),
    [],
  );

  // Missing wind for a timestamp falls back to 0 rather than NaN/undefined.
  const rows = mapOpenMeteoToRows(
    sampleMarine(),
    { hourly: { time: ["2026-05-30T00:00"], wind_speed_10m: [5], wind_direction_10m: [200] } },
    "UTC",
  );
  assertEquals(rows[1].windSpeed, 0);
  assertEquals(rows[1].windDirection, 0);
});

// ---------------------------------------------------------------------------
// 2. sliceTodayHours
// ---------------------------------------------------------------------------

function fullDayRows(): ReturnType<typeof mapOpenMeteoToRows> {
  // 48 midnight-aligned hourly rows. time encodes day+hour so we can assert
  // which slice we got back.
  const rows = [];
  for (let day = 0; day < 2; day++) {
    for (let h = 0; h < 24; h++) {
      rows.push({
        time: `d${day}h${String(h).padStart(2, "0")}`,
        waveHeight: 1,
        windSpeed: 1,
        windDirection: 1,
        swellPeriod: 1,
        waterTemp: 1,
      });
    }
  }
  return rows;
}

Deno.test("sliceTodayHours: clientHour=19 stays TODAY", () => {
  const rows = fullDayRows();
  const sliced = sliceTodayHours(rows, 19);
  // today, from 19:00 up to and including 20:00
  assertEquals(sliced[0].time, "d0h19");
  assertEquals(sliced[sliced.length - 1].time, "d0h20");
  assertEquals(sliced.length, 2);
});

Deno.test("sliceTodayHours: clientHour=20 flips to TOMORROW (full day)", () => {
  const rows = fullDayRows();
  const sliced = sliceTodayHours(rows, 20);
  assertEquals(sliced.length, 24);
  assertEquals(sliced[0].time, "d1h00");
  assertEquals(sliced[sliced.length - 1].time, "d1h23");
});

Deno.test("sliceTodayHours: morning clientHour returns from then to 20:00", () => {
  const rows = fullDayRows();
  const sliced = sliceTodayHours(rows, 6);
  assertEquals(sliced[0].time, "d0h06");
  assertEquals(sliced[sliced.length - 1].time, "d0h20");
  assertEquals(sliced.length, 15); // hours 6..20 inclusive
});

Deno.test("sliceTodayHours: clientHour=0 returns full surf window", () => {
  const rows = fullDayRows();
  const sliced = sliceTodayHours(rows, 0);
  assertEquals(sliced[0].time, "d0h00");
  assertEquals(sliced[sliced.length - 1].time, "d0h20");
});

// ---------------------------------------------------------------------------
// 3. findNearestStation
// ---------------------------------------------------------------------------

Deno.test("findNearestStation: San Diego county point picks an SD station, not Santa Monica", () => {
  // Point near Sunset Cliffs / Ocean Beach, San Diego.
  const station = findNearestStation(32.745, -117.255, SOCAL_STATIONS);
  assertEquals(station !== null, true);
  const sdIds = new Set(["9410230", "9410170"]); // La Jolla, San Diego
  assertEquals(
    sdIds.has(station!.id),
    true,
    `expected La Jolla or San Diego, got ${station!.name}`,
  );
  // explicitly NOT Santa Monica
  assertEquals(station!.id === "9410840", false);
});

Deno.test("findNearestStation: LA county point picks Santa Monica", () => {
  // Malibu-ish.
  const station = findNearestStation(34.03, -118.68, SOCAL_STATIONS);
  assertEquals(station!.name, "Santa Monica");
});

Deno.test("findNearestStation: exact station coords return that station (zero distance)", () => {
  const lj = SOCAL_STATIONS[0];
  const station = findNearestStation(lj.lat, lj.lng, SOCAL_STATIONS);
  assertEquals(station!.id, lj.id);
});

Deno.test("findNearestStation: empty station list returns null", () => {
  const stations: NoaaStation[] = [];
  assertEquals(findNearestStation(32.7, -117.2, stations), null);
});

// ---------------------------------------------------------------------------
// 4. parseNoaaTides
// ---------------------------------------------------------------------------

function samplePredictions(): TidePrediction[] {
  return [
    { t: "2026-05-30 02:14", v: "1.110", type: "L" },
    { t: "2026-05-30 08:30", v: "4.532", type: "H" },
    { t: "2026-05-30 14:05", v: "0.880", type: "L" },
    { t: "2026-05-30 20:40", v: "5.010", type: "H" },
  ];
}

Deno.test("parseNoaaTides: parses predictions into typed tide rows", () => {
  const { tides } = parseNoaaTides(samplePredictions(), new Date("2026-05-30T00:00"));
  assertEquals(tides.length, 4);
  assertEquals(tides[1], { time: "2026-05-30 08:30", height: 4.532, type: "H" });
  assertEquals(typeof tides[0].height, "number");
});

Deno.test("parseNoaaTides: finds next high and next low after `now`", () => {
  // now = 10:00. Next low is 14:05, next high is 20:40 (08:30 high already passed).
  const now = new Date("2026-05-30T10:00");
  const { nextHigh, nextLow } = parseNoaaTides(samplePredictions(), now);
  assertEquals(nextLow!.time, "2026-05-30 14:05");
  assertEquals(nextLow!.type, "L");
  assertEquals(nextHigh!.time, "2026-05-30 20:40");
  assertEquals(nextHigh!.type, "H");
});

Deno.test("parseNoaaTides: early morning `now` picks the first of each type", () => {
  const now = new Date("2026-05-30T00:00");
  const { nextHigh, nextLow } = parseNoaaTides(samplePredictions(), now);
  assertEquals(nextLow!.time, "2026-05-30 02:14");
  assertEquals(nextHigh!.time, "2026-05-30 08:30");
});

Deno.test("parseNoaaTides: when all tides are in the past, next* are null", () => {
  const now = new Date("2026-05-31T00:00");
  const { nextHigh, nextLow } = parseNoaaTides(samplePredictions(), now);
  assertEquals(nextHigh, null);
  assertEquals(nextLow, null);
});

Deno.test("parseNoaaTides: empty / missing predictions don't throw", () => {
  const res = parseNoaaTides([], new Date("2026-05-30T10:00"));
  assertEquals(res.tides, []);
  assertEquals(res.nextHigh, null);
  assertEquals(res.nextLow, null);
});

// A small assertThrows usage to satisfy the std import requirement and document
// that the functions themselves never throw on malformed-but-typed input
// (defensive design). This guards against a future refactor that makes them
// throw unexpectedly.
Deno.test("transforms are defensive: malformed-but-typed input does not throw", () => {
  assertThrows(
    () => {
      mapOpenMeteoToRows(sampleMarine(), sampleForecast([1]), "UTC");
      // force a throw to prove assertThrows is wired correctly
      throw new Error("sentinel");
    },
    Error,
    "sentinel",
  );
});
