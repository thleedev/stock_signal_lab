"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BarChart3,
  TrendingUp,
  Briefcase,
  Zap,
  PieChart,
  Target,
  Settings,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "대시보드", icon: LayoutDashboard },
  { href: "/stocks", label: "전 종목", icon: BarChart3 },
  { href: "/gap", label: "GAP 추천", icon: Target },
  { href: "/market", label: "투자 시황", icon: TrendingUp },
  { href: "/investment", label: "포트 종목", icon: Briefcase },
  { href: "/signals", label: "AI 신호", icon: Zap },
  { href: "/portfolio", label: "AI 포트폴리오", icon: PieChart },
  { href: "/settings", label: "설정", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <aside className="hidden md:flex fixed top-0 left-0 z-40 h-screen w-60 flex-col bg-[#0d1117] border-r border-[var(--border)]">
      {/* Logo */}
      <div className="flex items-center gap-2 px-5 h-14 shrink-0">
        <Zap className="w-5 h-5 text-[var(--accent)]" />
        <span className="text-lg font-bold gradient-text">AI 매매신호</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? "bg-[#6366f1] text-white"
                  : "text-[var(--muted)] hover:bg-[#161b22] hover:text-[var(--foreground)]"
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
