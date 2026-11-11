import type { Metadata } from "next";
import { Caveat, Fraunces } from "next/font/google";
import "./globals.css";

// Fraunces: a soft, friendly serif for the story. Caveat: the handwriting in the margin.
const story = Fraunces({ subsets: ["latin"], axes: ["SOFT", "opsz"], variable: "--font-story" });
const hand = Caveat({ subsets: ["latin"], variable: "--font-hand" });

export const metadata: Metadata = { title: "My Story", description: "A place to write stories" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${story.variable} ${hand.variable}`}>
      <body>{children}</body>
    </html>
  );
}
