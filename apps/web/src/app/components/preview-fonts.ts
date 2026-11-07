import localFont from "next/font/local";

const publicSans = localFont({
  src: "./fonts/public-sans/latin-variable.woff2",
  weight: "400 700",
  style: "normal",
  variable: "--font-public-sans",
  display: "swap",
});

const barlow = localFont({
  src: [
    { path: "./fonts/barlow/latin-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/barlow/latin-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/barlow/latin-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/barlow/latin-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-barlow",
  display: "swap",
  preload: false,
});

const plexMono = localFont({
  src: [
    {
      path: "./fonts/ibm-plex-mono/latin-400.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/ibm-plex-mono/latin-500.woff2",
      weight: "500",
      style: "normal",
    },
  ],
  variable: "--font-plex-mono",
  display: "swap",
  preload: false,
});

// Loaded only by the review route. The landing page keeps its original fonts.
export const previewFontVariables = `${publicSans.variable} ${barlow.variable} ${plexMono.variable}`;
