import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "WebMCPify — Make every app agent-ready", description: "A human-approved workflow for discovering, generating, and verifying WebMCP tools." };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
