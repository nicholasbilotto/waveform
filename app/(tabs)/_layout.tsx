import { Tabs } from "expo-router";
import { Home, User, Waves } from "lucide-react-native";
import React from "react";
import { Platform } from "react-native";

export default function TabLayout() {
    return (
        <Tabs
            screenOptions={{
                // Hide the default header since you built custom headers
                headerShown: false, 
                
                // Active/Inactive Colors
                tabBarActiveTintColor: "#22d3ee", // Your cyan accent
                tabBarInactiveTintColor: "rgba(255,255,255,0.4)", // Faded white
                
                // Tab Bar Background Styling
                tabBarStyle: {
                    backgroundColor: "#050b18", // Deep space blue background
                    borderTopColor: "rgba(255,255,255,0.05)", // Very subtle border
                    paddingBottom: Platform.OS === 'ios' ? 24 : 10, // Push up for iPhone home bar
                    height: Platform.OS === 'ios' ? 88 : 65,
                },
                
                // Label Text Styling
                tabBarLabelStyle: {
                    fontSize: 10,
                    fontWeight: "900",
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    marginTop: 4,
                }
            }}
        >
            <Tabs.Screen
                name="index"
                options={{
                    title: "Home",
                    tabBarIcon: ({ color }) => (
                        <Home size={24} color={color} strokeWidth={2.5} />
                    ),
                }}
            />

			<Tabs.Screen
                name="forecast"
                options={{
                    title: "Forecast",
                    tabBarIcon: ({ color }) => (
                        <Waves size={24} color={color} strokeWidth={2.5} />
                    ),
                }}
            />

			<Tabs.Screen
                name="profile"
                options={{
                    title: "Profile",
                    tabBarIcon: ({ color }) => (
                        <User size={24} color={color} strokeWidth={2.5} />
                    ),
                }}
            />
        </Tabs>
    );
}