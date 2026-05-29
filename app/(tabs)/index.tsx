import { SpotSelector } from "@/components/SpotSelector";
import { MOCK_SPOTS } from "@/constants/Spots";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import BottomSheet from "@gorhom/bottom-sheet";
import { BlurView } from "expo-blur";
import {
    Activity,
    Droplets,
    Edit2,
    Sun,
    TriangleAlert,
    Trophy,
    Users,
    Zap
} from "lucide-react-native";
import React, { useRef, useState } from "react";
import {
    ActivityIndicator,
    ImageBackground,
    RefreshControl,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// 1. IMPORT THE NEW HOOK
import { useForecast } from "../../providers/ForecastProvider";

type DataRowProps = {
    icon: React.ReactNode;
    label: string;
    value: string;
    subValue: string;
};

export default function HomeScreen() {
    // 2. USE THE GLOBAL CONTEXT
    const { dailyForecast: forecast, loading, error, favoriteSpots, setFavoriteSpots, refreshAll, isInitialized } = useForecast();
        const { user } = useAuth();
    
    // Local UI state
    const [refreshing, setRefreshing] = useState(false);
    const activeSpotMock = MOCK_SPOTS[0]; 
    const bottomSheetRef = useRef<BottomSheet>(null);
    const spotsChangedRef = useRef(false);

    // 3. REFRESH HANDLER
    const onRefresh = async () => {
        setRefreshing(true);
        // FALSE: Do not force an AI token burn. Just get the latest cached data.
        await refreshAll(true); 
        setRefreshing(false);
    };

    const handleOpenSelector = () => bottomSheetRef.current?.expand();

    const getRatingStyle = (rating: string) => {
        const lower = rating?.toLowerCase() || "";
        if (lower.includes("epic") || lower.includes("excellent")) {
            return { bg: "bg-cyan-500/20", border: "border-cyan-500/30", text: "text-cyan-400" };
        }
        if (lower.includes("good")) {
            return { bg: "bg-emerald-500/20", border: "border-emerald-500/30", text: "text-emerald-400" };
        }
        if (lower.includes("fair")) {
            return { bg: "bg-yellow-500/20", border: "border-yellow-500/30", text: "text-yellow-400" };
        }
        return { bg: "bg-slate-500/20", border: "border-slate-500/30", text: "text-slate-400" };
    };

    // --- TIMELINE HELPERS ---
    const START_HOUR = 5;
    const TOTAL_HOURS = 15;

    const getTimelinePosition = () => {
        if (!forecast) return { left: "25%", width: "30%" };
        const [start, end] = forecast.ai_analysis.optimal_time;
        
        const startPct = ((start - START_HOUR) / TOTAL_HOURS) * 100;
        const widthPct = ((end - start) / TOTAL_HOURS) * 100;
        
        return { 
            left: `${Math.max(0, Math.min(100, startPct))}%`, 
            width: `${Math.max(5, Math.min(100, widthPct))}%` 
        };
    };

    const renderTimeMarkers = () => {
        const markers = [6, 9, 12, 15, 18]; 
        return markers.map((hour) => {
            const leftPct = ((hour - START_HOUR) / TOTAL_HOURS) * 100;
            const label = hour > 12 ? `${hour - 12}p` : hour === 12 ? "12p" : `${hour}a`;
            
            return (
                <View key={hour} style={{ position: 'absolute', left: `${leftPct}%`, alignItems: 'center', top: 6 }}>
                    <View className="h-2 w-0.5 bg-white/10 mb-1" />
                    <Text className="text-white/20 text-[8px] font-medium">{label}</Text>
                </View>
            );
        });
    };

    // --- RENDER CONTENT LOGIC (Safe from unmounting the BottomSheet) ---
    const renderContent = () => {
        // 4. LOADING STATE
        if ((!isInitialized) || (loading && !refreshing)) {
            return (
                <View className="flex-1 items-center justify-center">
                    <ActivityIndicator size="large" color="#22d3ee" />
                    <Text className="text-white/50 text-xs mt-4 font-bold tracking-widest uppercase">
                        Judging the lineup...
                    </Text>
                </View>
            );
        }

       // 5. ERROR STATE
       if (error && !forecast) {
        // Check if Google's servers are the culprit
        const isHighDemand = error.includes("503") || error.toLowerCase().includes("high demand");

        return (
            <View className="flex-1 items-center justify-center px-8">
                <View className="bg-red-500/10 p-4 rounded-full mb-6">
                    <TriangleAlert size={32} color="#f87171" />
                </View>
                
                <Text className="text-white text-xl font-black mb-2 text-center tracking-tighter">
                    {isHighDemand ? "AI Guides are Crowded" : "System Malfunction"}
                </Text>
                
                <Text className="text-white/40 text-center mb-8 leading-5 font-medium">
                    {isHighDemand 
                        ? "The AI is currently catching too many waves. Give it a minute to paddle back out and try again." 
                        : error}
                </Text>

                <TouchableOpacity 
                    className="bg-cyan-500 px-10 py-4 rounded-full shadow-lg shadow-cyan-500/40" 
                    onPress={() => refreshAll(true)}
                >
                    <Text className="text-black font-black uppercase tracking-widest text-xs">
                        Try Again
                    </Text>
                </TouchableOpacity>
            </View>
        );
    }

        // 6. EMPTY STATE (Removed the duplicate SpotSelector from here)
        if (isInitialized && favoriteSpots.length === 0) {
            return (
                <View className="flex-1 items-center justify-center px-8">
                    <Text className="text-white text-xl font-bold mb-2">No Spots Selected</Text>
                    <Text className="text-white/40 text-center mb-6">Add spots to your rotation to get a forecast.</Text>
                    <TouchableOpacity className="bg-cyan-500 px-6 py-3 rounded-full" onPress={handleOpenSelector}>
                        <Text className="text-black font-bold">Add Spots</Text>
                    </TouchableOpacity>
                </View>
            );
        }

        // 7. LOADED STATE
        const ratingStyle = getRatingStyle(forecast?.spot_info.rating || "Fair");
        const timelinePos = getTimelinePosition();
        const rawScale = forecast?.spot_info.human_scale || "2-3";
        const [minHeight, maxHeight] = rawScale.split("-");
        const headerDayText = forecast?.ai_analysis.is_tomorrow ? "Tomorrow" : "Today";

        return (
            <View className="flex-1">
                <View className="overflow-hidden border-b border-white/10">
                    <BlurView intensity={30} tint="dark">
                        <SafeAreaView edges={["top"]}>
                            <View className="px-6 flex-row items-end justify-between pb-5 pt-2">
                                <View>
                                    <View className="flex-row items-center mb-1">
                                        <Trophy size={10} color="#fbbf24" style={{marginRight: 4}}/>
                                        <Text className="text-amber-400 text-[10px] font-black uppercase tracking-[2px]">
                                            Best Break {headerDayText}
                                        </Text>
                                    </View>
                                    <Text className="text-white text-3xl font-black tracking-tighter">
                                        {forecast?.spot_info.name}
                                    </Text>
                                </View>

                                <TouchableOpacity
                                    onPress={handleOpenSelector}
                                    className="bg-white/10 px-4 py-2 rounded-full border border-white/5 flex-row items-center mb-1"
                                >
                                    <Edit2 size={12} color="rgba(255,255,255,0.6)" style={{ marginRight: 6 }} />
                                    <Text className="text-white/80 text-[10px] font-bold uppercase tracking-widest">
                                        Edit
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </SafeAreaView>
                    </BlurView>
                </View>

                <ScrollView 
                    className="flex-1 px-4 pt-5 pb-12" 
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={onRefresh}
                            tintColor="#22d3ee" 
                            colors={["#22d3ee"]} 
                        />
                    }
                >
                    <View className="mb-7">
                        <View className="flex-row justify-between items-start">
                            <View className="ml-4">
                                <Text className="text-white text-7xl font-black tracking-tighter">
                                    {minHeight}-{maxHeight}{" "}
                                    <Text className="text-cyan-400 text-4xl">ft</Text>
                                </Text>
                                <Text className="text-white/60 text-xl font-bold tracking-tight mt-1">
                                    {forecast?.spot_info.human_relation}
                                </Text>
                            </View>

                            <View className={`${ratingStyle.bg} border ${ratingStyle.border} px-4 py-2 rounded-full flex-row items-center`}>
                                <Text className={`${ratingStyle.text} text-[10px] font-black uppercase tracking-widest`}>
                                    {forecast?.spot_info.rating}
                                </Text>
                            </View>
                        </View>

                        {forecast?.ai_analysis.why_it_won && (
                            <View className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 mx-4 mt-5">
                                <Text className="text-amber-200 text-xs font-semibold leading-5">
                                    <Text className="font-black uppercase text-[10px] tracking-wider text-amber-500">Why it's best: </Text>
                                    {forecast.ai_analysis.why_it_won}
                                </Text>
                            </View>
                        )}

                        <Text className="text-slate-300 text-sm font-semibold leading-6 mt-4 pr-4 ml-5">
                            {forecast?.ai_analysis.wave_description}
                        </Text>
                    </View>

                    <View className="flex-row h-44 mb-4 gap-4">
                        <View className="flex-[1.3] bg-[#0f172a] border border-white/10 rounded-[36px] p-6 justify-between overflow-hidden">
                            <View className="flex-row items-center">
                                <Zap size={14} color="#22d3ee" style={{ marginRight: 8 }} />
                                <Text className="text-cyan-400 text-[9px] font-black uppercase tracking-[1.5px]">BOARD REC</Text>
                            </View>
                            <View>
                                <Text className="text-white text-3xl font-black uppercase tracking-tighter mb-1">
                                    {forecast?.ai_analysis.board_recommendation}
                                </Text>
                                <Text className="text-slate-400 text-[11px] font-medium leading-4" numberOfLines={4}>
                                    {forecast?.ai_analysis.board_rec_description}
                                </Text>
                            </View>
                        </View>

                        <View className="flex-1 bg-[#0f172a] border border-white/10 rounded-[36px] p-6 justify-between relative">
                            <View className="flex-row items-center opacity-80">
                                <Droplets size={12} color="#22d3ee" style={{ marginRight: 6 }} />
                                <Text className="text-cyan-400 text-[9px] font-black uppercase tracking-[1.5px]">WATER</Text>
                            </View>
                            <View>
                                <Text className="text-white text-4xl font-black tracking-tighter">
                                    {forecast?.metadata.water_temp}
                                </Text>
                                <Text className="text-white/70 text-[11px] font-bold mt-1">
                                    {forecast?.metadata.suggested_wetsuit} Suit
                                </Text>
                            </View>
                        </View>
                    </View>

                    <View className="bg-white/5 border border-white/10 rounded-[32px] p-6 mb-4">
                        <View className="flex-row justify-between items-center mb-6">
                            <Text className="text-white/40 text-[9px] font-black uppercase tracking-widest">Optimal Window</Text>
                            <Text className="text-cyan-400 text-[10px] font-bold uppercase">
                                {forecast?.ai_analysis.optimal_window_condition}
                            </Text>
                        </View>
                        
                        <View className="relative h-14 justify-start mb-1">
                            <View className="h-1.5 bg-white/10 w-full rounded-full absolute top-0" />
                            <View 
                                className="h-1.5 bg-cyan-500 absolute rounded-full top-0 shadow-[0_0_12px_#22d3ee] z-10" 
                                style={timelinePos as any} 
                            />
                            <View className="absolute w-full h-full pointer-events-none">
                                {renderTimeMarkers()}
                            </View>
                            <View className="absolute w-full top-6 flex-row justify-between px-1">
                                <View className="items-center">
                                    <Sun size={10} color="#fbbf24" />
                                    <Text className="text-white/30 text-[8px] font-bold mt-1">
                                        {forecast?.ai_analysis.sun[0]?.replace(" AM", "a")}
                                    </Text>
                                </View>
                                <View className="items-center">
                                    <Sun size={10} color="#f87171" />
                                    <Text className="text-white/30 text-[8px] font-bold mt-1">
                                        {forecast?.ai_analysis.sun[1]?.replace(" PM", "p")}
                                    </Text>
                                </View>
                            </View>
                        </View>

                        <Text className="text-slate-400 text-[11px] leading-5 font-medium mt-2">
                            {forecast?.ai_analysis.optimal_window_description}
                        </Text>
                    </View>

                    <View className="bg-white/5 border border-white/10 rounded-[32px] p-6 mb-4 flex-row items-center justify-between">
                        <View className="flex-row items-center">
                            <View className="bg-emerald-500/10 p-3 rounded-2xl mr-4 border border-emerald-500/10">
                                <Users size={18} color="#34d399" />
                            </View>
                            <View>
                                <Text className="text-white/40 text-[9px] font-black uppercase tracking-widest">Crowd Prediction</Text>
                                <Text className="text-white text-lg font-bold">{forecast?.metadata.crowd_prediction}</Text>
                            </View>
                        </View>
                    </View>

                    {forecast?.ai_analysis.paddle_difficulty ? (
                        <View className="flex-row gap-4 mb-8">
                            <View className="flex-1 bg-blue-500/10 border border-blue-500/20 rounded-[32px] p-5">
                                <View className="bg-blue-500/20 self-start p-2 rounded-xl mb-3">
                                    <Activity size={16} color="#60a5fa" />
                                </View>
                                <Text className="text-white/40 text-[9px] font-black uppercase tracking-widest mb-1">Paddle Out</Text>
                                <Text className="text-white text-lg font-bold leading-5">
                                    {forecast?.ai_analysis.paddle_difficulty}
                                </Text>
                            </View>

                            <View className="flex-1 bg-red-500/10 border border-red-500/20 rounded-[32px] p-5">
                                <View className="bg-red-500/20 self-start p-2 rounded-xl mb-3">
                                    <TriangleAlert size={16} color="#f87171" />
                                </View>
                                <Text className="text-white/40 text-[9px] font-black uppercase tracking-widest mb-1">Hazards</Text>
                                <Text className="text-red-200 text-xs font-bold leading-4">
                                    {forecast?.ai_analysis.danger_description}
                                </Text>
                            </View>
                        </View>
                    ) : null}

                    <View className="mt-4">
                        {forecast?.raw_data?.forecast ? (
                            <>
                            </>
                        ) : (
                            <View className="bg-white/5 p-6 rounded-[32px] items-center">
                                <Text className="text-white/40 text-xs">Timeline data unavailable</Text>
                            </View>
                        )}
                    </View>
                </ScrollView>
            </View>
        );
    };

    return (
        <View className="flex-1 bg-[#050b18]">
            <StatusBar barStyle="light-content" />
            <ImageBackground
                source={require("../../assets/images/gradient.jpg")}
                style={StyleSheet.absoluteFill}
                imageStyle={{ opacity: 0.3 }} // FIXED: Background now matches Forecast perfectly
            />

            {renderContent()}

            <SpotSelector
    ref={bottomSheetRef}
    favoriteSlugs={favoriteSpots} 
    onAdd={async (spot) => {
        if (!user) return;
        spotsChangedRef.current = true; // ⚡ Mark as changed!
        
        const newSpots = [...favoriteSpots, spot.slug];
        setFavoriteSpots(newSpots); // UI updates instantly
        await supabase.from("profiles").update({ favorite_spots: newSpots }).eq("id", user.id);
    }}
    onRemove={async (slug) => {
        if (!user) return;
        spotsChangedRef.current = true; // ⚡ Mark as changed!
        
        const newSpots = favoriteSpots.filter((s) => s !== slug);
        setFavoriteSpots(newSpots); // UI updates instantly
        await supabase.from("profiles").update({ favorite_spots: newSpots }).eq("id", user.id);
    }} 
    onClose={() => {
        // ⚡ ONLY run the heavy AI fetch if they actually made edits
        if (spotsChangedRef.current) {
            refreshAll(true);
            spotsChangedRef.current = false; // Reset the flag for next time
        }
    }}
/>
        </View>
    );
}