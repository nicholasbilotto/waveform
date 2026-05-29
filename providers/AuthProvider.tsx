import { Session, User } from "@supabase/supabase-js";
import React, {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { supabase } from "../lib/supabase";

type AuthContextType = {
	user: User | null;
	session: Session | null;
	loading: boolean;
	profileComplete: boolean;
	refreshProfileStatus: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
	user: null,
	session: null,
	loading: true,
	profileComplete: false,
	refreshProfileStatus: async () => {},
});

const checkProfileComplete = async (userId: string): Promise<boolean> => {
	const { data } = await supabase
		.from("profiles")
		.select("skill_level")
		.eq("id", userId)
		.maybeSingle();
	return Boolean(data?.skill_level);
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
	const [user, setUser] = useState<User | null>(null);
	const [session, setSession] = useState<Session | null>(null);
	const [loading, setLoading] = useState(true);
	const [profileComplete, setProfileComplete] = useState(false);
	const lastCheckedUserId = useRef<string | null>(null);

	const refreshProfileStatus = useCallback(async () => {
		if (!user) {
			setProfileComplete(false);
			return;
		}
		const complete = await checkProfileComplete(user.id);
		setProfileComplete(complete);
	}, [user]);

	useEffect(() => {
		let mounted = true;

		(async () => {
			const {
				data: { session: initialSession },
			} = await supabase.auth.getSession();
			if (!mounted) return;

			setSession(initialSession);
			setUser(initialSession?.user ?? null);

			if (initialSession?.user) {
				const complete = await checkProfileComplete(initialSession.user.id);
				if (!mounted) return;
				lastCheckedUserId.current = initialSession.user.id;
				setProfileComplete(complete);
			}
			setLoading(false);
		})();

		const {
			data: { subscription },
		} = supabase.auth.onAuthStateChange(async (event, nextSession) => {
			// TOKEN_REFRESHED and USER_UPDATED fire often and don't change identity.
			// Re-checking the profile on those events causes a global re-render storm.
			if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
				setSession(nextSession);
				return;
			}

			setSession(nextSession);
			setUser(nextSession?.user ?? null);

			if (!nextSession?.user) {
				lastCheckedUserId.current = null;
				setProfileComplete(false);
				setLoading(false);
				return;
			}

			if (lastCheckedUserId.current !== nextSession.user.id) {
				const complete = await checkProfileComplete(nextSession.user.id);
				if (!mounted) return;
				lastCheckedUserId.current = nextSession.user.id;
				setProfileComplete(complete);
			}
			setLoading(false);
		});

		return () => {
			mounted = false;
			subscription.unsubscribe();
		};
	}, []);

	const value = useMemo(
		() => ({ user, session, loading, profileComplete, refreshProfileStatus }),
		[user, session, loading, profileComplete, refreshProfileStatus],
	);

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
