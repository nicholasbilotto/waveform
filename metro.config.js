const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const config = getDefaultConfig(__dirname);

// We pass the config and the path to your global CSS
module.exports = withNativeWind(config, { input: "./global.css" });
