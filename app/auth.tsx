import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ChevronRight, Lock, Mail, User } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { supabase } from '../lib/supabase'; // Ensure path is correct

export default function AuthScreen() {
  const router = useRouter();
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');

  const handleAuth = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    
    try {
      if (isSignUp) {
        // --- SIGN UP FLOW ---
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
            },
          },
        });
        
        if (error) throw error;

        // CHECK THIS LOGIC:
        // If 'session' exists in the data, it means email confirmation is OFF 
        // and the user is logged in immediately.
        if (data.session) {
          router.replace('/'); 
        } else {
          // This will only run if you turn email confirmation back ON later
          Alert.alert('Check your inbox', 'Please verify your email to continue.');
        }

      } else {
        // --- LOG IN FLOW ---
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;
        router.replace('/'); 
      }
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="flex-1 bg-[#050b18]">
      <StatusBar style="light" />
      <ImageBackground
        source={require('../assets/images/gradient.jpg')} // Ensure you have this image
        style={StyleSheet.absoluteFill}
        imageStyle={{ opacity: 0.6 }}
      />
      
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1 justify-center px-6"
      >
        <View className="items-center mb-10">
          <Text className="text-cyan-400 text-xs font-black uppercase tracking-[4px] mb-2">
            Welcome to Waveform
          </Text>
          <Text className="text-white text-5xl font-black tracking-tighter text-center">
            {isSignUp ? 'Create\nAccount' : 'Welcome\nBack'}
          </Text>
        </View>

        {/* --- FORM CONTAINER --- */}
        <View className="gap-4">
          
          {/* Full Name (Sign Up Only) */}
          {isSignUp && (
            <View className="bg-white/5 border border-white/10 rounded-[32px] px-6 h-16 flex-row items-center">
              <User size={20} color="rgba(255,255,255,0.4)" style={{ marginRight: 12 }} />
              <View className="flex-1">
                <Text className="text-white/30 text-[9px] font-black uppercase tracking-widest mb-0.5">
                  Full Name
                </Text>
                <TextInput
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder="Kelly Slater"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  className="text-white text-lg font-bold p-0"
                />
              </View>
            </View>
          )}

          {/* Email Input */}
          <View className="bg-white/5 border border-white/10 rounded-[32px] px-6 h-16 flex-row items-center">
            <Mail size={20} color="rgba(255,255,255,0.4)" style={{ marginRight: 12 }} />
            <View className="flex-1">
              <Text className="text-white/30 text-[9px] font-black uppercase tracking-widest mb-0.5">
                Email Address
              </Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="surfer@waveform.app"
                placeholderTextColor="rgba(255,255,255,0.2)"
                autoCapitalize="none"
                keyboardType="email-address"
                className="text-white text-lg font-bold p-0"
              />
            </View>
          </View>

          {/* Password Input */}
          <View className="bg-white/5 border border-white/10 rounded-[32px] px-6 h-16 flex-row items-center">
            <Lock size={20} color="rgba(255,255,255,0.4)" style={{ marginRight: 12 }} />
            <View className="flex-1">
              <Text className="text-white/30 text-[9px] font-black uppercase tracking-widest mb-0.5">
                Password
              </Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor="rgba(255,255,255,0.2)"
                secureTextEntry
                className="text-white text-lg font-bold p-0"
              />
            </View>
          </View>

          {/* Action Button */}
          <TouchableOpacity 
            onPress={handleAuth}
            disabled={loading}
            className="bg-cyan-500 h-16 rounded-full flex-row items-center justify-center mt-4 shadow-[0_0_20px_rgba(34,211,238,0.3)]"
          >
            {loading ? (
              <ActivityIndicator color="#050b18" />
            ) : (
              <>
                <Text className="text-[#050b18] text-lg font-black uppercase tracking-widest mr-2">
                  {isSignUp ? 'Get Started' : 'Sign In'}
                </Text>
                <ChevronRight size={20} color="#050b18" strokeWidth={3} />
              </>
            )}
          </TouchableOpacity>

        </View>

        {/* --- TOGGLE MODE --- */}
        <TouchableOpacity 
          onPress={() => setIsSignUp(!isSignUp)}
          className="mt-8 self-center p-4"
        >
          <Text className="text-white/40 font-medium">
            {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
            <Text className="text-cyan-400 font-bold">
              {isSignUp ? 'Sign In' : 'Sign Up'}
            </Text>
          </Text>
        </TouchableOpacity>

      </KeyboardAvoidingView>
    </View>
  );
}