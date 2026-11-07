import localFont from "next/font/local";

const sans = localFont({
  src: "../components/fonts/public-sans/latin-variable.woff2",
  weight: "400 700",
  variable: "--font-app-sans",
  display: "swap",
});

const mono = localFont({
  src: "../components/fonts/ibm-plex-mono/latin-500.woff2",
  weight: "500",
  variable: "--font-app-mono",
  display: "swap",
  preload: false,
});

export const appFontVariables = `${sans.variable} ${mono.variable}`;
