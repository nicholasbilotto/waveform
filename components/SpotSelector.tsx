import { supabase } from "@/lib/supabase";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  MapPin,
  Trash2
} from "lucide-react-native";
import React, { forwardRef, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

// Types
export type Spot = {
  id: string;
  name: string;
  slug: string;
  county?: string;
};

type Section = {
  title: string;
  data: Spot[];
};

type Props = {
  favoriteSlugs: string[];
  onAdd: (spot: Spot) => void;
  onRemove: (slug: string) => void;
  onClose?: () => void; 
};

export const SpotSelector = forwardRef<BottomSheet, Props>((props, ref) => {
  const { favoriteSlugs, onAdd, onRemove, onClose } = props;
  
  const snapPoints = useMemo(() => ["50%", "85%"], []);

  // UI STATE
  const [expandedCounty, setExpandedCounty] = useState<string | null>(null);

  // DATA STATE
  const [sections, setSections] = useState<Section[]>([]);
  const [isLoading, setIsLoading] = useState(false);

// --- FETCH ALL SPOTS ON MOUNT ---
  useEffect(() => {
    let isMounted = true;
    
    const loadAllSpots = async () => {
      if (sections.length > 0) return; 

      setIsLoading(true);
      
      try {
        // We use Promise.race to force a timeout if Supabase hangs for more than 5 seconds
        const fetchPromise = supabase
          .from("spots")
          .select("id, name, slug, county")
          .in("county", ["LA", "OC", "SD"])
          .order("lat", { ascending: false });
          
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Supabase request timed out")), 5000)
        );

        const { data, error } = await Promise.race([fetchPromise, timeoutPromise]) as any;

        if (error) throw error;

        if (data && isMounted) {
          const la = data.filter((s: Spot) => s.county === "LA");
          const oc = data.filter((s: Spot) => s.county === "OC");
          const sd = data.filter((s: Spot) => s.county === "SD");
          
          setSections([
            { title: "Los Angeles", data: la },
            { title: "Orange County", data: oc },
            { title: "San Diego", data: sd },
          ]);
        }
      } catch (err) {
        console.error("🚨 Error loading spots:", err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadAllSpots();
    
    return () => { isMounted = false; };
  }, []);

  const formatSlug = (slug: string) => {
    return slug
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  // --- TOGGLE LOGIC ---
  const handleSpotToggle = (spot: Spot) => {
    if (favoriteSlugs.includes(spot.slug)) {
      onRemove(spot.slug); // If already added, clicking it again removes it
    } else {
      if (favoriteSlugs.length < 5) onAdd(spot); // Otherwise, add it
    }
  };

  return (
    <BottomSheet
      ref={ref}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      backgroundStyle={{ backgroundColor: "#0f172a" }}
      handleIndicatorStyle={{ backgroundColor: "rgba(255,255,255,0.2)" }}
      backdropComponent={(props) => (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          opacity={0.8}
          pressBehavior="close"
        />
      )}
      onChange={(index) => {
        if (index === -1) {
            Keyboard.dismiss();
            if (props.onClose) props.onClose();
        }
      }}
    >
      {/* CRITICAL FIX: 
        BottomSheetScrollView is now the ROOT component. No wrapping Views.
        This completely fixes the scroll-locking bug. 
      */}
      <BottomSheetScrollView 
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        
        {/* --- 1. HEADER --- */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>Your Rotation</Text>
            <Text style={styles.headerSub}>
              {favoriteSlugs.length} / 5 Spots Selected
            </Text>
          </View>
        </View>

        {/* --- 2. SELECTED SPOTS LIST --- */}
        {favoriteSlugs.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No spots saved yet.</Text>
          </View>
        ) : (
          favoriteSlugs.map((slug) => (
            <View key={`fav-${slug}`} style={styles.itemContainer}>
              <View style={styles.iconBox}>
                <MapPin size={20} color="#22d3ee" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemTitle, { color: "#FFFFFF" }]}>{formatSlug(slug)}</Text>
                <Text style={styles.itemSub}>Current Favorite</Text>
              </View>
              <TouchableOpacity
                onPress={() => onRemove(slug)}
                style={styles.actionButton}
              >
                <Trash2 size={18} color="#f87171" />
              </TouchableOpacity>
            </View>
          ))
        )}

        <View style={styles.divider} />

        {/* --- 3. ACCORDION BROWSER (Only shows if < 5 spots) --- */}
        {isLoading ? (
          <View style={{ paddingVertical: 40, alignItems: 'center' }}>
            <ActivityIndicator size="large" color="#22d3ee" />
          </View>
        ) : favoriteSlugs.length >= 5 ? (
          <View style={styles.limitBox}>
            <AlertCircle size={16} color="rgba(255,255,255,0.4)" />
            <Text style={styles.limitText}>
              You've reached your 5 spot limit. Remove a spot above to add a new one.
            </Text>
          </View>
        ) : (
          sections.map((section) => {
            const isExpanded = expandedCounty === section.title;

            return (
              <View key={section.title} style={styles.accordionSection}>
                
                {/* Accordion Header */}
                <TouchableOpacity
                  style={styles.accordionHeader}
                  onPress={() => setExpandedCounty(isExpanded ? null : section.title)}
                >
                  <Text style={styles.sectionHeaderText}>{section.title}</Text>
                  {isExpanded ? (
                    <ChevronUp size={20} color="rgba(255,255,255,0.5)" />
                  ) : (
                    <ChevronDown size={20} color="rgba(255,255,255,0.5)" />
                  )}
                </TouchableOpacity>

                {/* Accordion List */}
                {isExpanded && (
                  <View style={styles.accordionContent}>
                    {section.data.map((item) => {
                      const isAdded = favoriteSlugs.includes(item.slug);

                      return (
                        <TouchableOpacity
                          key={item.id}
                          // Toggles spot on or off!
                          onPress={() => handleSpotToggle(item)}
                          style={[
                            styles.itemContainer, 
                            isAdded && { opacity: 0.6, borderColor: 'transparent' },
                            { marginBottom: 6, padding: 14 } 
                          ]}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.itemTitle, { color: isAdded ? '#22d3ee' : 'white' }]}>
                              {item.name}
                            </Text>
                          </View>
                          
                          {isAdded ? (
                            <CheckCircle2 size={22} color="#22d3ee" />
                          ) : (
                            <Circle size={22} color='rgba(255,255,255,0.3)' />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })
        )}
      </BottomSheetScrollView>
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  headerTitle: {
    color: "white",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  headerSub: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.1)",
    marginVertical: 24,
  },
  accordionSection: {
    marginBottom: 12,
    backgroundColor: "rgba(255,255,255,0.02)",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  accordionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  sectionHeaderText: {
    color: "white",
    fontSize: 15,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  accordionContent: {
    padding: 12,
  },
  itemContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  itemSub: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 11,
  },
  actionButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  limitBox: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "rgba(255,255,255,0.02)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  limitText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 14,
    textAlign: "center",
    marginTop: 12,
    fontWeight: "500",
    lineHeight: 20,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 20,
    backgroundColor: "rgba(255,255,255,0.02)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  emptyText: {
    color: "rgba(255,255,255,0.4)",
    fontStyle: "italic",
    fontSize: 14,
  },
});