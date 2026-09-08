import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";

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

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // lang has to follow the chosen locale, not sit hardcoded at "en" — screen
  // readers pick pronunciation from it, and an accessibility audit checks it.
  const locale = await getLocale();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${geistSans.variable} antialiased`}>
        <NextIntlClientProvider>
          <ServiceWorker>{children}</ServiceWorker>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
