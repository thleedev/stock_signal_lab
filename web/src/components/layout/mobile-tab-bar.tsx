"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, BarChart3, TrendingUp, Briefcase, Zap } from "lucide-react";

const TAB_ITEMS = [
  { href: "/", label: "홈", icon: Home },
  { href: "/stocks", label: "종목", icon: BarChart3 },
  { href: "/market", label: "시황", icon: TrendingUp },
  { href: "/investment", label: "포트", icon: Briefcase },
  { href: "/signals", label: "신호", icon: Zap },
];

export function MobileTabBar() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0d1117] border-t border-[var(--border)]">
      <div className="flex items-center justify-around h-14">
        {TAB_ITEMS.map((item) => {
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
      </div>
    </nav>
  );
}
