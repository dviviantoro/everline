import type { Metadata } from "next";
import { Big_Shoulders, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const displayFont = Big_Shoulders({
  variable: "--font-display",
  weight: ["600", "700", "800", "900"],
  subsets: ["latin"],
});

const bodyFont = IBM_Plex_Sans({
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

const monoFont = IBM_Plex_Mono({
  variable: "--font-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "EverLine — 20kV Grid Intelligence",
  description: "Map-based POC tracking PLN's 20kV transformers and lines in Central Java",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable} h-full antialiased`}
    >
      <body className="h-full bg-ink font-body text-paper">{children}</body>
    </html>
  );
}
