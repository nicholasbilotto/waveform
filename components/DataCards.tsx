import { Droplets, Waves, Wind } from "lucide-react-native";
import React from "react";
import { Text, View } from "react-native";

// Helper to format ISO time to "9a", "12p", etc.
const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    let hours = date.getHours();
    const ampm = hours >= 12 ? 'p' : 'a';
    hours = hours % 12;
    hours = hours ? hours : 12; 
    return `${hours}${ampm}`;
};

export function SwellChart({ forecast }: { forecast: any[] }) {
    if (!forecast || forecast.length === 0) return null;

    const maxWave = Math.max(...forecast.map(d => d.waveHeight || 0), 4); // Min ceiling of 4ft

    return (
        <View className="bg-white/5 border border-white/10 rounded-[32px] p-6 mb-4">
            <View className="flex-row items-center mb-6">
                <View className="bg-cyan-500/20 p-2 rounded-xl mr-3 border border-cyan-500/20">
                    <Waves size={16} color="#22d3ee" />
                </View>
                <Text className="text-white/40 text-[10px] font-black uppercase tracking-widest">Swell Timeline</Text>
            </View>

            <View className="flex-row items-end justify-between h-24">
                {forecast.map((hour, idx) => {
                    // Show every other hour to prevent crowding if there are 15 hours
                    if (idx % 2 !== 0) return null; 
                    
                    const heightPct = Math.max(10, (hour.waveHeight / maxWave) * 100);
                    
                    return (
                        <View key={idx} className="items-center w-8">
                            <Text className="text-cyan-400 text-[10px] font-bold mb-2">
                                {hour.waveHeight.toFixed(1)}
                            </Text>
                            <View 
                                style={{ height: `${heightPct}%` }} 
                                className="w-5 bg-cyan-500 rounded-t-md opacity-80"
                            />
                            <Text className="text-white/40 text-[9px] font-medium mt-3">
                                {formatTime(hour.time)}
                            </Text>
                        </View>
                    );
                })}
            </View>
        </View>
    );
}

export function WindChart({ forecast }: { forecast: any[] }) {
    if (!forecast || forecast.length === 0) return null;

    const maxWind = Math.max(...forecast.map(d => d.windSpeed || 0), 10); 

    return (
        <View className="bg-white/5 border border-white/10 rounded-[32px] p-6 mb-4">
            <View className="flex-row items-center mb-6">
                <View className="bg-emerald-500/20 p-2 rounded-xl mr-3 border border-emerald-500/20">
                    <Wind size={16} color="#34d399" />
                </View>
                <Text className="text-white/40 text-[10px] font-black uppercase tracking-widest">Wind Timeline</Text>
            </View>

            <View className="flex-row items-end justify-between h-24">
                {forecast.map((hour, idx) => {
                    if (idx % 2 !== 0) return null; 
                    
                    const heightPct = Math.max(10, (hour.windSpeed / maxWind) * 100);
                    // If wind is > 15kts, turn it yellow/red to warn the user
                    const isHighWind = hour.windSpeed > 15;
                    const barColor = isHighWind ? "bg-red-400" : "bg-emerald-400";
                    const textColor = isHighWind ? "text-red-400" : "text-emerald-400";

                    return (
                        <View key={idx} className="items-center w-8">
                            <Text className={`${textColor} text-[10px] font-bold mb-2`}>
                                {Math.round(hour.windSpeed)}
                            </Text>
                            <View 
                                style={{ height: `${heightPct}%` }} 
                                className={`w-5 ${barColor} rounded-t-md opacity-80`}
                            />
                            <Text className="text-white/40 text-[9px] font-medium mt-3">
                                {formatTime(hour.time)}
                            </Text>
                        </View>
                    );
                })}
            </View>
        </View>
    );
}

// Since drawing a smooth sine-wave without SVG is tricky, we use a staggered bar 
// layout that naturally forms a curve visually representing the water level.
export function TideChart({ forecast }: { forecast: any[] }) {
    if (!forecast || forecast.length === 0) return null;

    return (
        <View className="bg-white/5 border border-white/10 rounded-[32px] p-6 mb-4">
            <View className="flex-row items-center mb-6">
                <View className="bg-blue-500/20 p-2 rounded-xl mr-3 border border-blue-500/20">
                    <Droplets size={16} color="#60a5fa" />
                </View>
                <Text className="text-white/40 text-[10px] font-black uppercase tracking-widest">Tide Movement</Text>
            </View>

            <View className="flex-row items-end justify-between h-24 relative">
                {/* Visual baseline for absolute zero tide */}
                <View className="absolute bottom-6 w-full h-[1px] bg-white/10 border-dashed border-b" />

                {forecast.map((hour, idx) => {
                    if (idx % 2 !== 0) return null; 
                    
                    // Mocking a tide curve based on time of day for the visual since 
                    // Stormglass tide data is usually just High/Low points, not hourly.
                    // If you get hourly tide, map it here exactly like the Swell chart.
                    const simulatedTide = Math.sin((idx / forecast.length) * Math.PI * 2) * 2 + 2.5; 
                    const heightPct = Math.max(15, (simulatedTide / 6) * 100);

                    return (
                        <View key={idx} className="items-center w-8">
                            <View 
                                style={{ height: `${heightPct}%` }} 
                                className="w-5 bg-blue-500 rounded-t-md opacity-50"
                            />
                            <Text className="text-white/40 text-[9px] font-medium mt-3">
                                {formatTime(hour.time)}
                            </Text>
                        </View>
                    );
                })}
            </View>
        </View>
    );
}