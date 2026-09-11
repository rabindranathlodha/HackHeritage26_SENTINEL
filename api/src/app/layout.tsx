import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";

import "./globals.css";

// The same three Latin faces as the Personnel Companion, self-hosted the same
// way. The Devanagari pair is absent: the console is an English-only staff tool
// in this build, and shipping two faces nobody renders is dead weight.
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

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: {
    default: "SENTINEL Welfare Console",
    template: "%s · Welfare Console",
  },
  description:
    "Surfaces elevated welfare-risk indicators for human review. Not a clinical diagnosis.",
  // A staff tool behind a login has nothing to gain from being indexed.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f4f1" },
    { media: "(prefers-color-scheme: dark)", color: "#191715" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The font variables go on <html>, not <body>: globals.css composes
  // --stack-body from them inside :root, and a var() in a :root declaration
  // resolves against :root. Defined one level down, every face silently falls
  // back to Times while the page still looks styled.
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${hanken.variable} ${jetbrains.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
