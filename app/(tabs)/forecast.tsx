import { SpotSelector } from "@/components/SpotSelector";
import BottomSheet from "@gorhom/bottom-sheet";
import { useFocusEffect } from "@react-navigation/native";
import {
    Clock,
    Edit2,
    TrendingUp,
    TriangleAlert,
    Wind
} from "lucide-react-native";
import React, { useCallback, useRef, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    ImageBackground,
    RefreshControl,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// 1. IMPORT THE NEW HOOK
import { useForecast } from "../../providers/ForecastProvider";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

type SpotForecastItem = {
    day: string;
    val: number;
    color: string;
    label: string;
    wind: string;
    time: string;
};

type SpotData = {
    id: string;
    name: string;
    region: string;
    primary_best_day_index: number;
    forecast: SpotForecastItem[];
};

export default function WeeklyForecastScreen() {
    const { weeklyForecast: data, weeklyLoading, weeklyError, favoriteSpots, refreshAll, fetchWeekly, setFavoriteSpots, isInitialized } = useForecast();
  const { user } = useAuth();

  // Local UI State
  const [refreshing, setRefreshing] = useState(false);
  const bottomSheetRef = useRef<BottomSheet>(null);
  const spotsChangedRef = useRef(false);

  // Lazy-load the weekly forecast when this tab gains focus (only if not already loaded)
  useFocusEffect(
      useCallback(() => {
          if (!data) {
              fetchWeekly();
          }
      }, [data])
  );

  // 3. REFRESH HANDLER (force-refresh the weekly forecast)
  const onRefresh = async () => {
      setRefreshing(true);
      await fetchWeekly(true);
      setRefreshing(false);
  };

  const handleOpenSelector = () => bottomSheetRef.current?.expand();

  // --- RENDER CONTENT LOGIC ---
  const renderContent = () => {
      // 4. Loading State
      if (weeklyLoading && !refreshing) {
        return (
            <View className="flex-1 items-center justify-center">
                <ActivityIndicator size="large" color="#22d3ee" />
                <Text className="text-white/50 text-xs mt-4 font-bold tracking-widest uppercase">
                    Loading Forecast...
                </Text>
            </View>
        );
      }

    // 5. ERROR STATE
    if (weeklyError && !data) {
        // Check if Google's servers are the culprit
        const isHighDemand = weeklyError.includes("503") || weeklyError.toLowerCase().includes("high demand");

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
                        : weeklyError}
                </Text>

                <TouchableOpacity
                    className="bg-cyan-500 px-10 py-4 rounded-full shadow-lg shadow-cyan-500/40"
                    onPress={() => fetchWeekly(true)}
                >
                    <Text className="text-black font-black uppercase tracking-widest text-xs">
                        Try Again
                    </Text>
                </TouchableOpacity>
            </View>
        );
    }

      // 6. Empty State (Removed the duplicate SpotSelector from here)
      if (isInitialized && favoriteSpots.length === 0) {
          return (
              <View className="flex-1 items-center justify-center px-10">
                  <Text className="text-white text-xl font-bold">No Spots Found</Text>
                  <Text className="text-white/40 text-center mt-2 mb-6">
                      Add spots to your favorites to generate a weekly plan.
                  </Text>
                  <TouchableOpacity 
                      onPress={handleOpenSelector}
                      className="bg-cyan-500 px-6 py-3 rounded-full"
                  >
                      <Text className="text-black font-bold">Add Spots</Text>
                  </TouchableOpacity>
              </View>
          );
      }

      return (
          <SafeAreaView edges={["top"]} className="flex-1">
            <View className="pt-2 pb-6 px-6 bg-[#050b18]/90 border-b border-white/5 z-20">
                <View className="flex-row justify-between items-center mb-5">
                    <View>
                        <Text className="text-white text-3xl font-black tracking-tighter">
                            This Week
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

                <View className="flex-row justify-between items-center">
                    {data?.summary_strip?.map((day: any, idx: number) => {
                        const rating = day.rating?.toLowerCase() || "fair";
                        const isEpic = rating.includes("epic");
                        const isGood = rating.includes("good");
                        const isFair = rating.includes("fair");
                        const isPoor = rating.includes("poor");
                        const isRest = !day.winner_slug;
                        
                        let textColor = "text-slate-500";
                        let pillStyle = "bg-slate-800 border-slate-700";

                        if (isPoor) {
                            textColor = "text-red-400";
                            pillStyle = "bg-red-500 border-red-400";
                        } else if (isFair) {
                            textColor = "text-yellow-400";
                            pillStyle = "bg-yellow-500 border-yellow-400";
                        } else if (isGood) {
                            textColor = "text-emerald-400";
                            pillStyle = "bg-emerald-500 border-emerald-400 shadow-lg shadow-emerald-500/20";
                        } else if (isEpic) {
                            textColor = "text-amber-400";
                            pillStyle = "bg-amber-400 border-amber-300 shadow-lg shadow-amber-500/20";
                        }

                        return (
                            <View key={idx} className="items-center space-y-2">
                                <Text className={`text-[10px] font-black ${textColor}`}>{day.day_name}</Text>
                                
                                <View className={`h-12 w-9 rounded-full items-center justify-center border ${pillStyle}`} style={{ marginTop: 4, marginBottom: 4 }}>
                                    {isRest ? (
                                        <View className="h-1 w-1 bg-white/20 rounded-full" />
                                    ) : (
                                        <Text className={`text-[10px] font-bold ${isEpic || isGood ? 'text-black' : 'text-white'}`}>
                                            {day.date_num}
                                        </Text>
                                    )}
                                </View>
                                
                                <View style={{ paddingTop: 4, minHeight: 20 }}>
                                    <Text className="text-[5px] font-bold uppercase text-white/40 w-10 text-center" numberOfLines={2}>
                                        {day.winner_slug ? day.winner_slug : "-"}
                                    </Text>
                                </View>
                            </View>
                        );
                    })}
                </View>
            </View>

            <FlatList 
                data={data?.spots_forecasts}
                keyExtractor={(item: any) => item.id}
                contentContainerStyle={{ paddingBottom: 24, paddingTop: 24 }}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        tintColor="#22d3ee" 
                        colors={["#22d3ee"]} 
                    />
                }
                renderItem={({ item }) => <SmartSpotCard spot={item} />}
            />
          </SafeAreaView>
      );
  };

  return (
    <View className="flex-1 bg-[#050b18]">
      <StatusBar barStyle="light-content" />
      <ImageBackground
        source={require("../../assets/images/gradient.jpg")}
        style={StyleSheet.absoluteFill}
        imageStyle={{ opacity: 0.3 }}
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
            refreshAll(true);   // keep daily in sync
            fetchWeekly(true);  // weekly tab needs a forced refresh too
            spotsChangedRef.current = false; // Reset the flag for next time
        }
    }}
/>
    </View>
  );
}

function SmartSpotCard({ spot }: { spot: SpotData }) {
    const [selectedIndex, setSelectedIndex] = useState(spot.primary_best_day_index);
    const activeData = spot.forecast[selectedIndex];

    if (!activeData) return null;

    let activeTextColor = "text-white";
    if (activeData.color.includes("red")) activeTextColor = "text-red-400";
    if (activeData.color.includes("yellow")) activeTextColor = "text-yellow-400";
    if (activeData.color.includes("emerald")) activeTextColor = "text-emerald-400";
    if (activeData.color.includes("amber")) activeTextColor = "text-amber-400";

    const maxWaveThisWeek = Math.max(...spot.forecast.map(d => d.val || 0));
    const scaleMax = Math.max(6, maxWaveThisWeek);
    const MAX_BAR_HEIGHT = 35; 
    const MIN_BAR_HEIGHT = 4; 

    return (
        <View className="mx-5 mb-5 bg-[#0f172a] border border-white/10 rounded-[28px] overflow-hidden shadow-xl shadow-black">
            
            <View className="px-5 pt-5 flex-row justify-between items-start">
                <View>
                    <Text className="text-white text-xl font-black tracking-tight">{spot.name}</Text>
                    <Text className="text-white/40 text-[10px] font-bold uppercase tracking-widest mt-0.5">{spot.region}</Text>
                </View>
                
                <View className="flex-row items-center bg-white/5 border border-white/5 px-3 py-1.5 rounded-lg">
                    <Clock size={12} color={activeData.color.includes("amber") ? "#fbbf24" : "#94a3b8"} style={{marginRight:6}} />
                    <Text className={`text-[10px] font-black uppercase ${activeTextColor}`}>
                        {activeData.time}
                    </Text>
                </View>
            </View>

            <View className="px-5 mt-5 flex-row items-end justify-between h-[50px]">
                {spot.forecast.map((day, idx) => {
                    const isSelected = idx === selectedIndex;
                    const waveValue = day.val || 0;
                    const ratio = waveValue / scaleMax;
                    const height = MIN_BAR_HEIGHT + (ratio * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT));
                    
                    return (
                        <TouchableOpacity 
                            key={idx} 
                            activeOpacity={0.9}
                            onPress={() => setSelectedIndex(idx)}
                            className="items-center w-8"
                        >
                            <View 
                                style={{ height }} 
                                className={`w-4 rounded-full mb-2 ${day.color} ${isSelected ? 'opacity-100' : 'opacity-40'}`}
                            />
                            <Text 
    className={`text-[9px] font-bold uppercase ${isSelected ? 'text-white' : 'text-slate-600'}`}
    style={isSelected ? { transform: [{ scale: 1.1 }] } : { transform: [{ scale: 1 }] }}
>
    {day.day}
</Text>
                        </TouchableOpacity>
                    )
                })}
            </View>

            <View className="mt-4 bg-[#050b18]/50 border-t border-white/5 px-5 py-4 flex-row items-center justify-between">
                <View className="flex-row items-center">
                    <View className={`p-2 rounded-full mr-3 ${activeData.color.replace("bg-", "bg-opacity-20 bg-")}`}>
                        <TrendingUp size={16} color="white" />
                    </View>
                    <View>
                        <Text className="text-white/40 text-[9px] font-bold uppercase tracking-widest">Wave Height</Text>
                        <Text className="text-white text-base font-black">{activeData.label}</Text>
                    </View>
                </View>

                <View className="h-6 w-[1px] bg-white/10" />

                <View className="flex-row items-center">
                     <View>
                        <Text className="text-white/40 text-[9px] font-bold uppercase tracking-widest text-right">Conditions</Text>
                        <Text className="text-white text-base font-black text-right">{activeData.wind}</Text>
                    </View>
                    <View className={`p-2 rounded-full ml-3 ${activeData.color.replace("bg-", "bg-opacity-20 bg-")}`}>
                        <Wind size={16} color="white" />
                    </View>
                </View>
            </View>
        </View>
    );
}