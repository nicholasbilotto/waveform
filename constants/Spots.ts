export type SurfSpot = {
	id: string;
	name: string;
	height: string;
	condition: string;
	optimalTime: string;
	swell: string;
	period: string;
	wind: string;
	tide: string;
	board: string;
};

export const MOCK_SPOTS: SurfSpot[] = [
	{
		id: "1",
		name: "Swamis",
		height: "3-4",
		condition: "Clean and crumbly in the morning. Perfect for the log.",
		optimalTime: "7:45 AM",
		swell: "4.2ft",
		period: "14s WNW",
		wind: "6kts Offshore",
		tide: "2.1ft Rising",
		board: "Log",
	},
	{
		id: "2",
		name: "Trestles",
		height: "4-6",
		condition: "Punchy A-frames. Steep takeoffs and fast sections.",
		optimalTime: "6:15 AM",
		swell: "5.5ft",
		period: "12s S",
		wind: "3kts Light",
		tide: "1.5ft Low",
		board: "Shorty",
	},
	{
		id: "3",
		name: "Malibu",
		height: "2-3",
		condition: "Classic point break peelers. Crowded but worth the wait.",
		optimalTime: "9:30 AM",
		swell: "3.0ft",
		period: "16s W",
		wind: "8kts Side-on",
		tide: "3.2ft High",
		board: "Mid-Length",
	},
];
