import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RetroLoop — 問い返すAIふりかえり",
  description:
    "整理じゃない。問い返して、改善が根付くまで追う。AIふりかえりツール RetroLoop。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
