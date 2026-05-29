import { SpotSelector } from "@/components/SpotSelector";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import BottomSheet from "@gorhom/bottom-sheet";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import {
    Edit2,
    HardHat,
    LogOut,
    MapPin,
    ShieldCheck,
    Star,
    Waves,
    Wind,
} from "lucide-react-native";
import React, { useEffect, useRef, useState } from "react";
import {
    Alert,
    ScrollView,
    StatusBar,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// 1. IMPORT THE GLOBAL BRAIN
import { useForecast } from "../../providers/ForecastProvider";

export default function ProfileScreen() {
    const { user } = useAuth(); 
    const router = useRouter(); 
    const bottomSheetRef = useRef<BottomSheet>(null);
    const spotsChangedRef = useRef(false);

    // 2. PLUG INTO THE GLOBAL SPOTS
    const { favoriteSpots, setFavoriteSpots, refreshAll } = useForecast(); 

    // 3. Removed favoriteSpots from local preferences!
    const [preferences, setPreferences] = useState({
        skill: "Intermediate",
        stance: "Regular", 
        favoriteBoard: "Log",
        quiver: ["Log"],
        crowd: "Quiet",
        wind: "Offshore",
        wetsuits: ["3/2mm"],
    });

    useEffect(() => {
        if (!user) return;

        async function fetchProfile() {
            const { data, error } = await supabase
                .from("profiles")
                .select("*")
                .eq("id", user!.id) 
                .single();

            if (data) {
                setPreferences({
                    skill: data.skill_level || "Intermediate",
                    stance: data.stance || "Regular", 
                    favoriteBoard: data.favorite_board,
                    quiver: data.quiver || [],
                    crowd: data.crowd_tolerance || "Quiet",
                    wind: data.wind_preference || "Offshore",
                    wetsuits: data.wetsuits || [],
                });
            }
        }
        fetchProfile();
    }, [user]);

    const syncUpdate = async (updates: any) => {
        if (!user) return;
        const { error } = await supabase
            .from("profiles")
            .update(updates)
            .eq("id", user.id);

        if (error) console.error("Sync Error:", error.message);
    };

    const handleOpenSelector = () => {
        bottomSheetRef.current?.expand();
    };

    const handleLogout = async () => {
        const { error } = await supabase.auth.signOut();
        if (error) {
            Alert.alert("Error signing out", error.message);
        } else {
            router.replace("/auth");
        }
    };

    const handleBoardPress = (board: string) => {
        const isInQuiver = preferences.quiver.includes(board);
        let newQuiver = [...preferences.quiver];
        let newFavorite = preferences.favoriteBoard;

        if (isInQuiver) {
            newQuiver = newQuiver.filter((b) => b !== board);
            if (newFavorite === board) newFavorite = "";
        } else {
            newQuiver.push(board);
        }

        setPreferences((prev) => ({
            ...prev,
            quiver: newQuiver,
            favoriteBoard: newFavorite,
        }));
        syncUpdate({ quiver: newQuiver, favorite_board: newFavorite });
    };

    const handleBoardLongPress = async (board: string) => {
        if (!preferences.quiver.includes(board)) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        const newFavorite = preferences.favoriteBoard === board ? "" : board;
        setPreferences((prev) => ({ ...prev, favoriteBoard: newFavorite }));
        syncUpdate({ favorite_board: newFavorite });
    };

    const toggleWetsuit = (suit: string) => {
        const isSelected = preferences.wetsuits.includes(suit);
        const newWetsuits = isSelected
            ? preferences.wetsuits.filter((s) => s !== suit)
            : [...preferences.wetsuits, suit];

        setPreferences((prev) => ({ ...prev, wetsuits: newWetsuits }));
        syncUpdate({ wetsuits: newWetsuits });
    };

    const formatSpotName = (slug: string) => {
        return slug
            .split("-")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");
    };

    return (
        <View className="flex-1 bg-[#050b18]">
            <StatusBar barStyle="light-content" />
            <SafeAreaView className="flex-1">
                <View className="px-6 py-4 flex-row justify-between items-center">
                    <View>
                        <Text className="text-white/40 text-[10px] font-black uppercase tracking-[2.5px] mb-1">
                            Personalization
                        </Text>
                        <Text className="text-white text-3xl font-black tracking-tighter">
                            Surfer Profile
                        </Text>
                    </View>
                </View>

                <ScrollView className="px-6" showsVerticalScrollIndicator={false}>
                    
                    <PreferenceSection
                        title="My Spots"
                        icon={<MapPin size={18} color="#f472b6" />}
                    >
                        <View className="flex-row justify-between items-center mb-4 px-1">
                            <Text className="text-white/40 text-[10px] font-bold uppercase">
                                Your Local Rotation
                            </Text>
                            <TouchableOpacity 
                                onPress={handleOpenSelector}
                                className="flex-row items-center bg-white/10 px-3 py-1.5 rounded-full border border-white/5"
                            >
                                <Edit2 size={10} color="rgba(255,255,255,0.7)" style={{marginRight: 4}}/>
                                <Text className="text-white/70 text-[9px] font-black uppercase tracking-widest">
                                    Edit
                                </Text>
                            </TouchableOpacity>
                        </View>

                        <View className="gap-2">
                            {/* 4. Now mapping over the GLOBAL favoriteSpots */}
                            {favoriteSpots.length > 0 ? (
                                favoriteSpots.map((slug) => (
                                    <View 
                                        key={slug} 
                                        className="flex-row items-center justify-between bg-white/5 border border-white/10 p-3 rounded-2xl"
                                    >
                                        <View className="flex-row items-center">
                                            <View className="w-1.5 h-1.5 rounded-full bg-pink-400 mr-3" />
                                            <Text className="text-white font-bold text-sm">
                                                {formatSpotName(slug)}
                                            </Text>
                                        </View>
                                    </View>
                                ))
                            ) : (
                                <Text className="text-white/20 text-xs font-medium italic py-2">
                                    No spots saved yet.
                                </Text>
                            )}
                        </View>
                    </PreferenceSection>

                    <PreferenceSection
                        title="Skill & Quiver"
                        icon={<HardHat size={18} color="#22d3ee" />}
                    >
                        <SelectionGroup
                            label="Skill Level"
                            options={["Beginner", "Intermediate", "Advanced", "Pro"]}
                            selected={preferences.skill}
                            onSelect={(val) => {
                                setPreferences({ ...preferences, skill: val });
                                syncUpdate({ skill_level: val });
                            }}
                        />

                        <View className="mt-6">
                            <SelectionGroup
                                label="Stance"
                                options={["Regular", "Goofy"]}
                                selected={preferences.stance}
                                onSelect={(val) => {
                                    setPreferences({ ...preferences, stance: val });
                                    syncUpdate({ stance: val });
                                }}
                            />
                        </View>

                        <View className="mt-6">
                            <View className="flex-row justify-between items-end mb-3 px-1">
                                <Text className="text-white/40 text-[10px] font-bold uppercase">
                                    Your Quiver
                                </Text>
                                <Text className="text-cyan-400/60 text-[8px] font-black uppercase tracking-tighter">
                                    Long press to select favorite
                                </Text>
                            </View>
                            <View className="flex-row flex-wrap gap-2">
                                {["Log", "Mid", "Fish", "Shorty", "Foamie"].map(
                                    (board) => {
                                        const isOwned =
                                            preferences.quiver.includes(board);
                                        const isFav = preferences.favoriteBoard === board;
                                        return (
                                            <TouchableOpacity
                                                key={board}
                                                onPress={() => handleBoardPress(board)}
                                                onLongPress={() =>
                                                    handleBoardLongPress(board)
                                                }
                                                delayLongPress={400}
                                                className={`px-4 py-2.5 rounded-2xl border flex-row items-center ${
                                                    isFav
                                                        ? "bg-cyan-500 border-cyan-400"
                                                        : isOwned
                                                        ? "bg-white border-white"
                                                        : "bg-white/5 border-white/10"
                                                }`}
                                            >
                                                {isFav && (
                                                    <Star
                                                        size={10}
                                                        color="black"
                                                        fill="black"
                                                        style={{ marginRight: 4 }}
                                                    />
                                                )}
                                                <Text
                                                    className={`text-[10px] font-black ${
                                                        isOwned || isFav
                                                            ? "text-black"
                                                            : "text-white/60"
                                                    }`}
                                                >
                                                    {board}
                                                </Text>
                                            </TouchableOpacity>
                                        );
                                    }
                                )}
                            </View>
                        </View>
                    </PreferenceSection>

                    <PreferenceSection
                        title="Gear Locker"
                        icon={<ShieldCheck size={18} color="#a855f7" />}
                    >
                        <Text className="text-white/40 text-[10px] font-bold uppercase mb-3">
                            Wetsuits You Own
                        </Text>
                        <View className="flex-row flex-wrap gap-2">
                            {[
                                "Spring",
                                "3/2mm",
                                "4/3mm",
                                "5/4mm",
                                "Hood",
                                "Booties",
                            ].map((suit) => {
                                const isSelected = preferences.wetsuits.includes(suit);
                                return (
                                    <TouchableOpacity
                                        key={suit}
                                        onPress={() => toggleWetsuit(suit)}
                                        className={`px-4 py-2.5 rounded-2xl border ${
                                            isSelected
                                                ? "bg-purple-500 border-purple-400"
                                                : "bg-white/5 border-white/10"
                                        }`}
                                    >
                                        <Text
                                            className={`text-[10px] font-black ${
                                                isSelected ? "text-white" : "text-white/60"
                                            }`}
                                        >
                                            {suit}
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    </PreferenceSection>

                    <PreferenceSection
                        title="The Conditions"
                        icon={<Waves size={18} color="#34d399" />}
                    >
                        <SelectionGroup
                            label="Crowd Tolerance"
                            options={["Solo", "Quiet", "Busy", "Any"]}
                            selected={preferences.crowd}
                            onSelect={(val) => {
                                setPreferences({ ...preferences, crowd: val });
                                syncUpdate({ crowd_tolerance: val });
                            }}
                        />
                    </PreferenceSection>

                    <PreferenceSection
                        title="Wind & Texture"
                        icon={<Wind size={18} color="#fbbf24" />}
                    >
                        <SelectionGroup
                            label="Wind Preference"
                            options={[
                                "Glassy Only",
                                "Offshore",
                                "Light Texture",
                                "Any",
                            ]}
                            selected={preferences.wind}
                            onSelect={(val) => {
                                setPreferences({ ...preferences, wind: val });
                                syncUpdate({ wind_preference: val });
                            }}
                        />
                    </PreferenceSection>

                    <TouchableOpacity 
                        onPress={handleLogout}
                        className="bg-red-500/10 border border-red-500/20 p-5 rounded-[32px] flex-row items-center justify-center mb-12"
                    >
                        <LogOut size={18} color="#f87171" style={{ marginRight: 8 }} />
                        <Text className="text-red-400 font-bold uppercase tracking-widest text-xs">
                            Sign Out
                        </Text>
                    </TouchableOpacity>

                    <View className="h-24" />
                </ScrollView>
            </SafeAreaView>

            {/* 5. SPOT SELECTOR WIRED TO GLOBAL STATE */}
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

function PreferenceSection({
    title,
    icon,
    children,
}: {
    title: string;
    icon: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <View className="mb-6">
            <View className="flex-row items-center mb-3 px-1">
                {icon}
                <Text className="text-white font-bold ml-2 uppercase tracking-widest text-[9px] opacity-70">
                    {title}
                </Text>
            </View>
            <View className="bg-white/5 border border-white/10 rounded-[32px] p-6 shadow-sm">
                {children}
            </View>
        </View>
    );
}

function SelectionGroup({
    label,
    options,
    selected,
    onSelect,
}: {
    label: string;
    options: string[];
    selected: string;
    onSelect: (val: string) => void;
}) {
    return (
        <View className="mb-4 last:mb-0">
            <Text className="text-white/40 text-[10px] font-bold uppercase mb-3 px-1">
                {label}
            </Text>
            <View className="flex-row flex-wrap gap-2">
                {options.map((opt) => (
                    <TouchableOpacity
                        key={opt}
                        onPress={() => onSelect(opt)}
                        className={`px-4 py-2.5 rounded-2xl border ${
                            opt === selected
                                ? "bg-white border-white"
                                : "bg-white/5 border-white/10"
                        }`}
                    >
                        <Text
                            className={`text-[10px] font-black ${
                                opt === selected ? "text-black" : "text-white/60"
                            }`}
                        >
                            {opt}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>
        </View>
    );
}