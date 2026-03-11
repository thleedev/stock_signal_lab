import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AI 매매신호 대시보드",
  description: "키움증권 AI 서비스 3종 신호 수집 및 분석 플랫폼",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <div className="min-h-screen">
          <Sidebar />
          <main className="md:pl-60 pb-20 md:pb-0">
            <div className="max-w-7xl mx-auto px-4 py-6">
              {children}
            </div>
          </main>
          <MobileTabBar />
        </div>
      </body>
    </html>
  );
}
