"use client";

import Link from "next/link";
import { useState } from "react";

interface NavItem {
  href: string;
  label: string;
}

export function MobileNav({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden ml-auto">
      <button
        onClick={() => setOpen(!open)}
        className="p-2 rounded-md hover:bg-slate-100 transition-colors"
        aria-label="메뉴"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
          {open ? (
            <path d="M5 5l10 10M15 5L5 15" />
          ) : (
            <path d="M3 5h14M3 10h14M3 15h14" />
          )}
        </svg>
      </button>
      {open && (
        <div className="absolute top-14 left-0 right-0 bg-white border-b border-[var(--border)] shadow-lg z-50">
          <div className="max-w-6xl mx-auto px-4 py-2">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="block px-3 py-2.5 rounded-md text-sm text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-slate-50 transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
