import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";

import { ServiceWorker } from "@/components/ServiceWorker";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

// The home-screen name is "Companion", not "SENTINEL". Principle 1: someone
// glancing at this person's phone should not see a monitoring product, and the
// person opening it should see something that reads as theirs.
export const metadata: Metadata = {
  applicationName: "Companion",
  title: {
    default: "Companion",
    template: "%s · Companion",
  },
  description: "Your private wellness companion.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Companion",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pinch-zoom stays available. Disabling it fails an accessibility audit and
  // this app is used by people reading small text one-handed in poor light.
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f8f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0f2a3f" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} antialiased`}>
        <ServiceWorker>{children}</ServiceWorker>
      </body>
    </html>
  );
}
