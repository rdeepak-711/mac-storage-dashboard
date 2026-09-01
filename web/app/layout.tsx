import type { Metadata } from "next";
import { Public_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Public Sans (body) + JetBrains Mono (numeric/path data) — deliberately
// not Geist/Inter/Space Grotesk, per .impeccable.md's reflex-font list.
// "Precise, calm, technical" (design-brief.md) called for something
// closer to a technical-document face than a startup-dashboard default.
const bodyFont = Public_Sans({
  variable: "--font-body",
  subsets: ["latin"],
});

const dataFont = JetBrains_Mono({
  variable: "--font-data",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mac Storage Cleanup",
  description: "Where your disk space is actually going.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${bodyFont.variable} ${dataFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
