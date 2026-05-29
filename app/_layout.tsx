import { ForecastProvider } from "@/providers/ForecastProvider";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import "react-native-gesture-handler";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "../global.css";
import { AuthProvider, useAuth } from "../providers/AuthProvider";

export { ErrorBoundary } from "expo-router";

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
    const [loaded, error] = useFonts({
        SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
        ...FontAwesome.font,
    });

    useEffect(() => {
        if (error) throw error;
    }, [error]);

    useEffect(() => {
        if (loaded) {
            SplashScreen.hideAsync();
        }
    }, [loaded]);

    if (!loaded) return null;

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <AuthProvider>
                <ForecastProvider>
                    <ThemeProvider value={DarkTheme}>
                        <RootLayoutNav />
                    </ThemeProvider>
                </ForecastProvider>
            </AuthProvider>
        </GestureHandlerRootView>
    );
}

function RootLayoutNav() {
    const { user, loading, profileComplete } = useAuth();
    const segments = useSegments();
    const router = useRouter();

    useEffect(() => {
        if (loading) return;

        // segments[0] tells us which folder the user is currently in
        const inAuthGroup = segments[0] === "auth";
        const inOnboarding = segments[0] === "onboarding";

        if (!user) {
            // 1. If not logged in and not already in auth, redirect to auth
            if (!inAuthGroup) {
                router.replace("/auth");
            }
        } else if (!profileComplete) {
            // 2. If logged in but profile is empty, redirect to onboarding
            if (!inOnboarding) {
                router.replace("/onboarding");
            }
        } else if (user && profileComplete) {
            // 3. If logged in and profile is done, redirect to Home if they try to go back to Auth/Onboarding
            if (inAuthGroup || inOnboarding) {
                router.replace("/");
            }
        }
    }, [user, loading, profileComplete, segments]);

    return (
        <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="auth" />
            <Stack.Screen name="onboarding" />
            <Stack.Screen name="modal" options={{ presentation: "modal" }} />
        </Stack>
    );
}