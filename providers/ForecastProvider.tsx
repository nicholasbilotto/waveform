import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";

type ForecastContextType = {
    dailyForecast: any | null;
    weeklyForecast: any | null;
    loading: boolean;           // = dailyLoading (backward compat)
    dailyLoading: boolean;
    weeklyLoading: boolean;
    isInitialized: boolean;
    error: string | null;       // = daily error
    weeklyError: string | null;
    favoriteSpots: string[];
    setFavoriteSpots: React.Dispatch<React.SetStateAction<string[]>>; // Added this
    refreshAll: (force?: boolean) => Promise<void>;  // daily only
    fetchWeekly: (force?: boolean) => Promise<void>; // lazy weekly
    // Single-spot lazy load (swipe pager)
    fetchSpotDetail: (slug: string) => Promise<any>;
    spotDetails: Record<string, any>;          // keyed by slug
    spotDetailLoading: Record<string, boolean>; // keyed by slug
    spotDetailErrors: Record<string, string>;   // keyed by slug
};

const ForecastContext = createContext<ForecastContextType>({
    dailyForecast: null,
    weeklyForecast: null,
    loading: true,
    dailyLoading: true,
    weeklyLoading: false,
    isInitialized: false,
    error: null,
    weeklyError: null,
    favoriteSpots: [],
    setFavoriteSpots: () => {}, // Added this
    refreshAll: async () => {},
    fetchWeekly: async () => {},
    fetchSpotDetail: async () => null,
    spotDetails: {},
    spotDetailLoading: {},
    spotDetailErrors: {},
});

// 2h cache window for a single-spot detail (matches the worker's AI TTL)
const SPOT_DETAIL_CACHE_MS = 2 * 60 * 60 * 1000;

// Helper: invoke an Edge Function with a hard timeout
const invokeEdge = async <TData = any>(
    name: string,
    body: any,
    timeoutMs = 20000
): Promise<{ data: TData | null; error: any }> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await supabase.functions.invoke<TData>(name, {
            body,
            signal: controller.signal as any,
        });
        return res;
    } catch (err: any) {
        if (err?.name === "AbortError") {
            throw new Error("Request timed out. Please pull to refresh.");
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
};

// 4h cache window for the weekly forecast
const WEEKLY_CACHE_MS = 4 * 60 * 60 * 1000;

export const ForecastProvider = ({ children }: { children: React.ReactNode }) => {
    const { user } = useAuth();

    const [dailyForecast, setDailyForecast] = useState<any | null>(null);
    const [weeklyForecast, setWeeklyForecast] = useState<any | null>(null);
    const [dailyLoading, setDailyLoading] = useState(true);
    const [weeklyLoading, setWeeklyLoading] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [weeklyError, setWeeklyError] = useState<string | null>(null);
    const [favoriteSpots, setFavoriteSpots] = useState<string[]>([]);

    // Single-spot detail state (swipe pager lazy-load)
    const [spotDetails, setSpotDetails] = useState<Record<string, any>>({});
    const [spotDetailLoading, setSpotDetailLoading] = useState<Record<string, boolean>>({});
    const [spotDetailErrors, setSpotDetailErrors] = useState<Record<string, string>>({});
    const spotDetailFetchTimes = useRef<Record<string, number>>({});
    const inFlightSlugsRef = useRef<Set<string>>(new Set());

    const lastFetchTime = useRef<number>(0);
    const activeUser = useRef<string | null>(null);
    const isFetchingRef = useRef<boolean>(false);

    // Weekly de-dupe + cache tracking
    const isFetchingWeeklyRef = useRef<boolean>(false);
    const lastWeeklyFetchTime = useRef<number>(0);

    const requestDaily = async (slugs: string[], userId: string, forceRefresh: boolean) => {
        const localHour = new Date().getHours();
        const response = await invokeEdge("smart-worker", {
            favorite_spots: slugs,
            user_id: userId,
            client_hour: localHour,
            force_refresh: forceRefresh,
        });
        if (response.error) throw new Error(response.error.message || "Daily API Error");
        if ((response.data as any)?.error) throw new Error((response.data as any).error);
        return Array.isArray(response.data) ? (response.data as any)[0] : response.data;
    };

    const requestWeekly = async (slugs: string[], userId: string, forceRefresh: boolean) => {
        const response = await invokeEdge("weekly-planner", {
            favorite_spots: slugs,
            user_id: userId,
            force_refresh: forceRefresh,
        });
        if (response.error) throw new Error(response.error.message || "Weekly API Error");
        if ((response.data as any)?.error) throw new Error((response.data as any).error);
        return response.data;
    };

    // Daily-only refresh. Flips isInitialized the moment daily settles (success OR error).
    const refreshAll = async (force = false) => {
        if (!user) return;

        // Bypass the lock if we are forcing a refresh (like adding a spot)
        if (isFetchingRef.current && !force) return;

        const now = Date.now();
        if (!force && isInitialized && dailyForecast && (now - lastFetchTime.current < 10 * 60 * 1000)) {
            return;
        }

        isFetchingRef.current = true;
        if (force) setDailyLoading(true); // Only show spinner if forced
        setError(null);

        try {
            const { data: profile, error: profileError } = await supabase
                .from("profiles")
                .select("favorite_spots")
                .eq("id", user.id)
                .single();

            if (profileError) {
                await supabase.auth.signOut();
                setDailyLoading(false);
                isFetchingRef.current = false;
                return;
            }

            const slugs = (profile.favorite_spots || []).map((s: string) => s.toLowerCase());
            setFavoriteSpots(slugs);

            if (slugs.length === 0) {
                setDailyForecast(null);
                setDailyLoading(false);
                setIsInitialized(true);
                isFetchingRef.current = false;
                return;
            }

            const daily = await requestDaily(slugs, user.id, force);
            setDailyForecast(daily);
            lastFetchTime.current = Date.now();
        } catch (err: any) {
            console.error("🌊 ForecastProvider Error:", err);
            setError(err.message || "Connection failed");
        } finally {
            setDailyLoading(false);
            setIsInitialized(true);
            isFetchingRef.current = false;
        }
    };

    // Lazy weekly fetch. Triggered when the Weekly tab gains focus.
    const fetchWeekly = async (force = false) => {
        if (!user) return;

        // De-dupe in-flight calls
        if (isFetchingWeeklyRef.current) return;

        // Respect a 4h cache unless forced
        const now = Date.now();
        if (!force && weeklyForecast && (now - lastWeeklyFetchTime.current < WEEKLY_CACHE_MS)) {
            return;
        }

        isFetchingWeeklyRef.current = true;
        setWeeklyLoading(true);
        setWeeklyError(null);

        try {
            const { data: profile, error: profileError } = await supabase
                .from("profiles")
                .select("favorite_spots")
                .eq("id", user.id)
                .single();

            if (profileError) {
                setWeeklyError("Connection failed");
                return;
            }

            const slugs = (profile.favorite_spots || []).map((s: string) => s.toLowerCase());

            if (slugs.length === 0) {
                setWeeklyForecast(null);
                return;
            }

            let weeklyData = await requestWeekly(slugs, user.id, force);
            if (weeklyData && weeklyData.spots_forecasts) {
                weeklyData.spots_forecasts = weeklyData.spots_forecasts.filter((spot: any) => {
                    const spotSlug = spot.id?.toLowerCase() || spot.name?.toLowerCase().replace(/\s+/g, '-');
                    return slugs.includes(spotSlug);
                });
            }
            setWeeklyForecast(weeklyData);
            lastWeeklyFetchTime.current = Date.now();
        } catch (err: any) {
            console.error("🌊 Weekly Forecast Error:", err);
            setWeeklyError(err.message || "Connection failed");
        } finally {
            setWeeklyLoading(false);
            isFetchingWeeklyRef.current = false;
        }
    };

    // Lazy single-spot fetch for the swipe pager. Deduped + 2h cached per slug.
    const fetchSpotDetail = async (slug: string) => {
        if (!user || !slug) return null;

        // Serve from cache if fresh
        const fetchedAt = spotDetailFetchTimes.current[slug] || 0;
        if (spotDetails[slug] && (Date.now() - fetchedAt < SPOT_DETAIL_CACHE_MS)) {
            return spotDetails[slug];
        }

        // De-dupe in-flight requests for the same slug
        if (inFlightSlugsRef.current.has(slug)) return null;
        inFlightSlugsRef.current.add(slug);

        setSpotDetailLoading(prev => ({ ...prev, [slug]: true }));
        setSpotDetailErrors(prev => {
            if (!prev[slug]) return prev;
            const next = { ...prev };
            delete next[slug];
            return next;
        });

        try {
            const localHour = new Date().getHours();
            const response = await invokeEdge("smart-worker", {
                single_spot: slug,
                user_id: user.id,
                client_hour: localHour,
            });
            if (response.error) throw new Error(response.error.message || "Spot detail API Error");
            if ((response.data as any)?.error) throw new Error((response.data as any).error);

            // Worker returns a single card object; tolerate an array wrap.
            const card = Array.isArray(response.data) ? (response.data as any)[0] : response.data;
            setSpotDetails(prev => ({ ...prev, [slug]: card }));
            spotDetailFetchTimes.current[slug] = Date.now();
            return card;
        } catch (err: any) {
            console.error(`🌊 Spot detail error (${slug}):`, err);
            setSpotDetailErrors(prev => ({ ...prev, [slug]: err.message || "Connection failed" }));
            return null;
        } finally {
            setSpotDetailLoading(prev => ({ ...prev, [slug]: false }));
            inFlightSlugsRef.current.delete(slug);
        }
    };

    useEffect(() => {
        if (user && (user.id !== activeUser.current || !isInitialized)) {
            activeUser.current = user.id;
            refreshAll();
        }
    }, [user?.id]);

    return (
        <ForecastContext.Provider value={{
            dailyForecast,
            weeklyForecast,
            loading: dailyLoading, // backward compat: home only cares about daily
            dailyLoading,
            weeklyLoading,
            isInitialized,
            error,
            weeklyError,
            favoriteSpots,
            setFavoriteSpots,
            refreshAll,
            fetchWeekly,
            fetchSpotDetail,
            spotDetails,
            spotDetailLoading,
            spotDetailErrors,
        }}>
            {children}
        </ForecastContext.Provider>
    );
};

export const useForecast = () => useContext(ForecastContext);
