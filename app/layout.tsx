import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Dose Engine", description: "Route 1 editorial video-to-newsletter workflow" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
