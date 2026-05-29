import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";

type ForecastContextType = {
    dailyForecast: any | null;
    weeklyForecast: any | null;
    loading: boolean;
    isInitialized: boolean; 
    error: string | null;
    favoriteSpots: string[];
    setFavoriteSpots: React.Dispatch<React.SetStateAction<string[]>>; // Added this
    refreshAll: (force?: boolean) => Promise<void>;
};

const ForecastContext = createContext<ForecastContextType>({
    dailyForecast: null,
    weeklyForecast: null,
    loading: true,
    isInitialized: false, 
    error: null,
    favoriteSpots: [],
    setFavoriteSpots: () => {}, // Added this
    refreshAll: async () => {},
});

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

export const ForecastProvider = ({ children }: { children: React.ReactNode }) => {
    const { user } = useAuth();
    
    const [dailyForecast, setDailyForecast] = useState<any | null>(null);
    const [weeklyForecast, setWeeklyForecast] = useState<any | null>(null);
    const [loading, setLoading] = useState(true);
    const [isInitialized, setIsInitialized] = useState(false); 
    const [error, setError] = useState<string | null>(null);
    const [favoriteSpots, setFavoriteSpots] = useState<string[]>([]);

    const lastFetchTime = useRef<number>(0);
    const activeUser = useRef<string | null>(null); 
    const isFetchingRef = useRef<boolean>(false);

    const fetchDaily = async (slugs: string[], userId: string, forceRefresh: boolean) => {
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

    const fetchWeekly = async (slugs: string[], userId: string, forceRefresh: boolean) => {
        const response = await invokeEdge("weekly-planner", {
            favorite_spots: slugs,
            user_id: userId,
            force_refresh: forceRefresh,
        });
        if (response.error) throw new Error(response.error.message || "Weekly API Error");
        if ((response.data as any)?.error) throw new Error((response.data as any).error);
        return response.data;
    };

    const refreshAll = async (force = false) => {
        if (!user) return;

        // Bypass the lock if we are forcing a refresh (like adding a spot)
        if (isFetchingRef.current && !force) return; 

        const now = Date.now();
        if (!force && isInitialized && dailyForecast && (now - lastFetchTime.current < 10 * 60 * 1000)) {
            return;
        }

        isFetchingRef.current = true; 
        if (force) setLoading(true); // Only show spinner if forced
        setError(null);

        try {
            const { data: profile, error: profileError } = await supabase
                .from("profiles")
                .select("favorite_spots")
                .eq("id", user.id)
                .single();
        
            if (profileError) {
                await supabase.auth.signOut(); 
                setLoading(false);
                isFetchingRef.current = false;
                return; 
            }
            
            const slugs = (profile.favorite_spots || []).map((s: string) => s.toLowerCase());
            setFavoriteSpots(slugs);

            if (slugs.length === 0) {
                setDailyForecast(null);
                setWeeklyForecast(null);
                setLoading(false);
                setIsInitialized(true); 
                isFetchingRef.current = false;
                return;
            }

            // Run both edge functions in parallel, but enforce a hard overall cap
            const dailyPromise = fetchDaily(slugs, user.id, force);
            const weeklyPromise = fetchWeekly(slugs, user.id, force);

            const combined = Promise.allSettled([dailyPromise, weeklyPromise]);

            const combinedWithTimeout = new Promise<PromiseSettledResult<any>[]>((resolve, reject) => {
                const id = setTimeout(() => {
                    reject(new Error("Forecast fetch took too long. Please pull to refresh."));
                }, 20000); // 20s total cap for both

                combined.then((results) => {
                    clearTimeout(id);
                    resolve(results);
                }).catch((err) => {
                    clearTimeout(id);
                    reject(err);
                });
            });

            const [dailyResult, weeklyResult] = await combinedWithTimeout;

            if (dailyResult.status === "fulfilled") {
                setDailyForecast(dailyResult.value);
            } else {
                console.error("Daily forecast failed:", dailyResult.reason);
            }

            if (weeklyResult.status === "fulfilled") {
                let weeklyData = weeklyResult.value;
                if (weeklyData && weeklyData.spots_forecasts) {
                    weeklyData.spots_forecasts = weeklyData.spots_forecasts.filter((spot: any) => {
                        const spotSlug = spot.id?.toLowerCase() || spot.name?.toLowerCase().replace(/\s+/g, '-');
                        return slugs.includes(spotSlug);
                    });
                }
                setWeeklyForecast(weeklyData);
            } else {
                console.error("Weekly forecast failed:", weeklyResult.reason);
            }

            lastFetchTime.current = Date.now();

        } catch (err: any) {
            console.error("🌊 ForecastProvider Error:", err);
            setError(err.message || "Connection failed");
        } finally {
            setLoading(false);
            setIsInitialized(true); 
            isFetchingRef.current = false; 
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
            dailyForecast, weeklyForecast, loading, isInitialized, error, favoriteSpots, setFavoriteSpots, refreshAll 
        }}>
            {children}
        </ForecastContext.Provider>
    );
};

export const useForecast = () => useContext(ForecastContext);