import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

const supabaseUrl = "https://qbvekmuwkeyyobxzhrrs.supabase.co";
const supabaseAnonKey = "sb_publishable_Af-EPHCObJ2c7EX1yVUGTg_V_mpZBpZ";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
	auth: {
		storage: AsyncStorage,
		autoRefreshToken: true,
		persistSession: true,
		detectSessionInUrl: false,
	},
});
