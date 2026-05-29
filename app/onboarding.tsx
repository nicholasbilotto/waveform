import { SpotSelector } from "@/components/SpotSelector";
import BottomSheet from "@gorhom/bottom-sheet";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { MapPin, Plus, X } from "lucide-react-native";
import React, { useRef, useState } from "react";
import {
	ActivityIndicator,
	Alert,
	ScrollView,
	Text,
	TouchableOpacity,
	View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { useAuth } from "../providers/AuthProvider";
import { useForecast } from "../providers/ForecastProvider";

// Types for our form data
type OnboardingData = {
	skill_level: string;
	stance: string;
	quiver: string[];
	wetsuits: string[];
	crowd_tolerance: string;
	wind_preference: string;
	favorite_spots: string[];
};

export default function OnboardingScreen() {
	const { user, refreshProfileStatus } = useAuth();
	const { refreshAll } = useForecast();
	const router = useRouter();
	const bottomSheetRef = useRef<BottomSheet>(null);

	const [step, setStep] = useState(0);
	const [loading, setLoading] = useState(false);
	const TOTAL_STEPS = 5; // 0 to 4

	// Form State
	const [formData, setFormData] = useState<OnboardingData>({
		skill_level: "",
		stance: "Regular",
		quiver: [],
		wetsuits: [],
		crowd_tolerance: "Quiet",
		wind_preference: "Offshore",
		favorite_spots: [],
	});

	const updateData = (key: keyof OnboardingData, value: any) => {
		setFormData((prev) => ({ ...prev, [key]: value }));
	};

	const toggleSelection = (key: "quiver" | "wetsuits", item: string) => {
		const currentList = formData[key];
		if (currentList.includes(item)) {
			updateData(
				key,
				currentList.filter((i) => i !== item),
			);
		} else {
			updateData(key, [...currentList, item]);
		}
	};

	const handleAddSpot = (spot: any) => {
		if (!formData.favorite_spots.includes(spot.slug)) {
			updateData("favorite_spots", [...formData.favorite_spots, spot.slug]);
		}
	};

	const handleRemoveSpot = (slug: string) => {
		updateData(
			"favorite_spots",
			formData.favorite_spots.filter((s) => s !== slug),
		);
	};

	const formatSpotName = (slug: string) => {
		return slug
			.split("-")
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join(" ");
	};

	const finishOnboarding = async () => {
		if (!user) return;
		setLoading(true);

		const { error } = await supabase
			.from("profiles")
			.update({
				skill_level: formData.skill_level,
				stance: formData.stance,
				quiver: formData.quiver,
				wetsuits: formData.wetsuits,
				crowd_tolerance: formData.crowd_tolerance,
				wind_preference: formData.wind_preference,
				favorite_spots: formData.favorite_spots,
				updated_at: new Date(),
			})
			.eq("id", user.id);

		if (error) {
			Alert.alert("Error", error.message);
			setLoading(false);
		} else {
			// 1. Tell Auth the profile is done
			await refreshProfileStatus();

			// 2. Tell the ForecastProvider to fetch the brand new spots
			await refreshAll(true);

			setLoading(false);

			// 3. Now route home, and the data will be waiting!
			router.replace("/");
		}
	};

	// Reusable Components
	const StepTitle = ({ children }: { children: string }) => (
		<Text className="text-3xl font-black text-white mb-2 tracking-tighter">
			{children}
		</Text>
	);

	const StepSubtitle = ({ children }: { children: string }) => (
		<Text className="text-white/60 text-lg mb-8 font-medium">{children}</Text>
	);

	const SelectionButton = ({
		label,
		selected,
		onPress,
	}: {
		label: string;
		selected: boolean;
		onPress: () => void;
	}) => (
		<TouchableOpacity
			onPress={onPress}
			className={`p-5 rounded-2xl border mb-3 flex-row justify-between items-center ${selected ? "bg-cyan-500/20 border-cyan-500" : "bg-white/5 border-white/10"}`}
		>
			<Text
				className={`text-lg font-bold ${selected ? "text-cyan-400" : "text-gray-300"}`}
			>
				{label}
			</Text>
			{selected && (
				<View className="w-3 h-3 bg-cyan-400 rounded-full shadow-[0_0_8px_#22d3ee]" />
			)}
		</TouchableOpacity>
	);

	const NextButton = ({
		onPress,
		disabled,
		label,
	}: {
		onPress: () => void;
		disabled?: boolean;
		label?: string;
	}) => (
		<TouchableOpacity
			onPress={onPress}
			disabled={disabled}
			className={`mt-auto p-5 rounded-full items-center mb-4 ${disabled ? "bg-white/10" : "bg-cyan-500 shadow-[0_0_20px_rgba(34,211,238,0.3)]"}`}
		>
			{loading ? (
				<ActivityIndicator color="#050b18" />
			) : (
				<Text
					className={`font-black text-lg uppercase tracking-widest ${disabled ? "text-white/20" : "text-[#050b18]"}`}
				>
					{label || "Next Step"}
				</Text>
			)}
		</TouchableOpacity>
	);

	// --- RENDER STEPS ---

	const renderStep0_Skill = () => (
		<>
			<StepTitle>Skill Level</StepTitle>
			<StepSubtitle>
				Help WaveForm curate the right spots for you.
			</StepSubtitle>
			{["Beginner", "Intermediate", "Advanced", "Pro"].map((level) => (
				<SelectionButton
					key={level}
					label={level}
					selected={formData.skill_level === level}
					onPress={() => updateData("skill_level", level)}
				/>
			))}
			<View className="h-6" />
			<StepTitle>Stance</StepTitle>
			<View className="flex-row gap-4">
				{["Regular", "Goofy"].map((s) => (
					<TouchableOpacity
						key={s}
						onPress={() => updateData("stance", s)}
						className={`flex-1 p-4 rounded-xl border ${formData.stance === s ? "bg-cyan-500/20 border-cyan-500" : "bg-white/5 border-white/10"}`}
					>
						<Text
							className={`text-center font-bold ${formData.stance === s ? "text-cyan-400" : "text-gray-300"}`}
						>
							{s}
						</Text>
					</TouchableOpacity>
				))}
			</View>
			<NextButton
				onPress={() => setStep(1)}
				disabled={!formData.skill_level}
			/>
		</>
	);

	const renderStep1_Quiver = () => (
		<>
			<StepTitle>Your Quiver</StepTitle>
			<StepSubtitle>Select the boards you currently own.</StepSubtitle>
			{["Log", "Fish", "Mid", "Shorty", "Foamie"].map((board) => (
				<SelectionButton
					key={board}
					label={board}
					selected={formData.quiver.includes(board)}
					onPress={() => toggleSelection("quiver", board)}
				/>
			))}
			<NextButton onPress={() => setStep(2)} />
		</>
	);

	const renderStep2_Wetsuits = () => (
		<>
			<StepTitle>Wetsuit Locker</StepTitle>
			<StepSubtitle>What suits do you have available?</StepSubtitle>
			{["Spring", "3/2mm", "4/3mm", "5/4mm", "Hood", "Booties"].map(
				(suit) => (
					<SelectionButton
						key={suit}
						label={suit}
						selected={formData.wetsuits.includes(suit)}
						onPress={() => toggleSelection("wetsuits", suit)}
					/>
				),
			)}
			<NextButton onPress={() => setStep(3)} />
		</>
	);

	const renderStep3_Preferences = () => (
		<>
			<StepTitle>Conditions</StepTitle>
			<StepSubtitle>Tell us your ideal surf day.</StepSubtitle>

			<Text className="text-white/40 text-[10px] font-bold uppercase mb-3 px-1">
				Crowd Tolerance
			</Text>
			<View className="flex-row flex-wrap gap-2 mb-8">
				{["Solo", "Quiet", "Busy", "Any"].map((opt) => (
					<TouchableOpacity
						key={opt}
						onPress={() => updateData("crowd_tolerance", opt)}
						className={`px-4 py-3 rounded-xl border ${formData.crowd_tolerance === opt ? "bg-cyan-500/20 border-cyan-500" : "bg-white/5 border-white/10"}`}
					>
						<Text
							className={`font-bold ${formData.crowd_tolerance === opt ? "text-cyan-400" : "text-gray-300"}`}
						>
							{opt}
						</Text>
					</TouchableOpacity>
				))}
			</View>

			<Text className="text-white/40 text-[10px] font-bold uppercase mb-3 px-1">
				Wind Preference
			</Text>
			{["Glassy Only", "Offshore", "Light Texture", "Any"].map((opt) => (
				<SelectionButton
					key={opt}
					label={opt}
					selected={formData.wind_preference === opt}
					onPress={() => updateData("wind_preference", opt)}
				/>
			))}

			<NextButton onPress={() => setStep(4)} />
		</>
	);

	const renderStep4_Spots = () => (
		<>
			<StepTitle>Your Rotation</StepTitle>
			<StepSubtitle>Which spots do you surf the most?</StepSubtitle>

			<TouchableOpacity
				onPress={() => bottomSheetRef.current?.expand()}
				className="bg-cyan-500/10 border border-cyan-500/50 p-4 rounded-2xl flex-row items-center justify-center mb-6 border-dashed"
			>
				<Plus size={20} color="#22d3ee" style={{ marginRight: 8 }} />
				<Text className="text-cyan-400 font-bold uppercase tracking-widest">
					Add Spot
				</Text>
			</TouchableOpacity>

			<ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
				<View className="gap-3 pb-20">
					{formData.favorite_spots.length > 0 ? (
						formData.favorite_spots.map((slug) => (
							<View
								key={slug}
								className="flex-row items-center justify-between bg-white/5 border border-white/10 p-4 rounded-2xl"
							>
								<View className="flex-row items-center">
									<MapPin
										size={16}
										color="#f472b6"
										style={{ marginRight: 12 }}
									/>
									<Text className="text-white font-bold text-base">
										{formatSpotName(slug)}
									</Text>
								</View>
								<TouchableOpacity
									onPress={() => handleRemoveSpot(slug)}
									className="p-2"
								>
									<X size={16} color="rgba(255,255,255,0.4)" />
								</TouchableOpacity>
							</View>
						))
					) : (
						<Text className="text-white/30 text-center mt-10 italic">
							No spots added yet. Tap above to start building your
							lineup.
						</Text>
					)}
				</View>
			</ScrollView>

			<NextButton
				onPress={finishOnboarding}
				label="Finish Setup"
				disabled={formData.favorite_spots.length === 0}
			/>
		</>
	);

	return (
		<View className="flex-1 bg-[#050b18]">
			<StatusBar style="light" />
			<SafeAreaView className="flex-1 px-6 py-4">
				{/* Progress Bar */}
				<View className="flex-row h-1 bg-white/10 mb-8 rounded-full overflow-hidden mt-4">
					<View
						className="bg-cyan-500 h-full shadow-[0_0_10px_#22d3ee]"
						style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }}
					/>
				</View>

				{step === 0 && renderStep0_Skill()}
				{step === 1 && renderStep1_Quiver()}
				{step === 2 && renderStep2_Wetsuits()}
				{step === 3 && renderStep3_Preferences()}
				{step === 4 && renderStep4_Spots()}
			</SafeAreaView>

			{/* Spot Selector Modal (Hidden until triggered) */}
			<SpotSelector
				ref={bottomSheetRef}
				favoriteSlugs={formData.favorite_spots}
				onAdd={handleAddSpot}
				onRemove={handleRemoveSpot}
			/>
		</View>
	);
}
