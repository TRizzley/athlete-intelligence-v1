import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Coach — Sprint V1",
  description:
    "A vendor-neutral performance coach. Know exactly how hard to train today — based on your body, not population averages.",
};

export const viewport: Viewport = {
  themeColor: "#0A0C10",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="app-backdrop min-h-screen">{children}</div>
        <Analytics />
      </body>
    </html>
  );
}
