import type { Metadata, Viewport } from "next";
import {
  Anek_Devanagari,
  Bricolage_Grotesque,
  Hanken_Grotesk,
  JetBrains_Mono,
  Mukta,
} from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

import { ServiceWorker } from "@/components/ServiceWorker";

import "./globals.css";

/* The design's type pairing, self-hosted.
 *
 * The design document links these from fonts.googleapis.com. That is right for
 * a document and wrong for this app: a third-party stylesheet is a second
 * connection before a single glyph is requested, and this phone is already
 * downloading a model. next/font subsets and serves them from our own origin,
 * so the pairing survives with no external request and no layout shift.
 *
 * Only the two Latin faces are preloaded. The Devanagari pair is a large
 * download that most sessions never render, and the mono face is used for
 * short labels where a swap costs nothing — preloading all five would spend
 * the performance budget on glyphs that are not on screen. */
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  display: "swap",
});

const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  display: "swap",
});

const anek = Anek_Devanagari({
  variable: "--font-anek",
  subsets: ["devanagari"],
  display: "swap",
  preload: false,
});

const mukta = Mukta({
  variable: "--font-mukta",
  subsets: ["devanagari"],
  weight: ["400", "500", "600"],
  display: "swap",
  preload: false,
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

const FONTS = [bricolage, hanken, anek, mukta, jetbrains]
  .map((font) => font.variable)
  .join(" ");

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
  // Paper and the warm charcoal ground, so the system chrome joins the app
  // rather than framing it.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f4f1" },
    { media: "(prefers-color-scheme: dark)", color: "#191715" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // lang has to follow the chosen locale, not sit hardcoded at "en" — screen
  // readers pick pronunciation from it, an accessibility audit checks it, and
  // the Devanagari type stack in globals.css is selected by :lang(hi).
  const locale = await getLocale();
  // Passed explicitly so client components can call useTranslations. Without
  // this they can read the locale but not the strings, and the only way to get
  // copy to them is to pass formatted values as props — which cannot include a
  // formatter function, because functions are not serializable across the
  // server/client boundary.
  const messages = await getMessages();

  return (
    // The font variables go on <html>, not <body>. globals.css builds
    // --stack-display and --stack-body from them inside `:root`, and a var()
    // in a :root declaration resolves against :root — so defining them one
    // level down on <body> leaves those stacks invalid and every face silently
    // falls back to Times New Roman while the page still looks "styled".
    <html lang={locale} className={FONTS} suppressHydrationWarning>
      <body className="antialiased">
        <NextIntlClientProvider messages={messages}>
          <ServiceWorker>{children}</ServiceWorker>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
