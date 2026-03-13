"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Briefcase, Zap, BarChart3, TrendingUp, MoreHorizontal } from "lucide-react";
import { useState } from "react";

const MAIN_TABS = [
  { href: "/", label: "대시보드", icon: LayoutDashboard },
  { href: "/stocks", label: "종목", icon: BarChart3 },
  { href: "/signals", label: "AI신호", icon: Zap },
  { href: "/my-portfolio", label: "프트종목", icon: Briefcase },
];

const MORE_TABS = [
  { href: "/market", label: "시황", icon: TrendingUp },
  { href: "/investment", label: "포트종목", icon: Briefcase },
  { href: "/portfolio", label: "AI포트", icon: Briefcase },
  { href: "/compare", label: "비교", icon: BarChart3 },
  { href: "/reports", label: "리포트", icon: Zap },
];

export function MobileTabBar() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  const moreActive = MORE_TABS.some((t) => isActive(t.href));

  return (
    <>
      {/* 더보기 패널 */}
      {moreOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="absolute bottom-14 left-0 right-0 bg-[#0d1117] border-t border-[var(--border)] p-3 grid grid-cols-6 gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            {MORE_TABS.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={`flex flex-col items-center gap-1 py-2 rounded-lg text-xs ${
                    active ? "text-[var(--accent)] bg-[#161b22]" : "text-[var(--muted)]"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0d1117] border-t border-[var(--border)]">
        <div className="flex items-center justify-around h-14">
          {MAIN_TABS.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-0.5 px-3 py-1.5 relative ${
                  active ? "text-[var(--accent)]" : "text-[var(--muted)]"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px]">{item.label}</span>
                {active && (
                  <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-gradient-to-r from-[#6366f1] to-[#a855f7]" />
                )}
              </Link>
            );
          })}

          {/* 더보기 버튼 */}
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className={`flex flex-col items-center gap-0.5 px-3 py-1.5 relative ${
              moreActive || moreOpen ? "text-[var(--accent)]" : "text-[var(--muted)]"
            }`}
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[10px]">더보기</span>
            {moreActive && !moreOpen && (
              <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-gradient-to-r from-[#6366f1] to-[#a855f7]" />
            )}
          </button>
        </div>
      </nav>
    </>
  );
}
