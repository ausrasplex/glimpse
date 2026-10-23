import type { Metadata, Viewport } from "next";
import "../client/styles.css";

export const metadata: Metadata = {
  title: "Glimpse",
  description: "One second a day, all in one place.",
  icons: { icon: "/favicon.ico", apple: "/apple-touch-icon.png" },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Glimpse", statusBarStyle: "black-translucent" }
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#121212" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
