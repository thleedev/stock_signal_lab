"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Star, Briefcase, ExternalLink, X } from "lucide-react";

interface StockActionMenuProps {
  symbol: string;
  name: string;
  currentPrice?: number | null;
  isOpen: boolean;
  onClose: () => void;
  position?: { x: number; y: number };
  isFavorite?: boolean;
  isInPortfolio?: boolean;
  onToggleFavorite?: () => void;
}

export default function StockActionMenu({
  symbol,
  name,
  currentPrice,
  isOpen,
  onClose,
  position,
  isFavorite = false,
  isInPortfolio = false,
  onToggleFavorite,
}: StockActionMenuProps) {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [isOpen, onClose]);

  const handleToggleFavorite = useCallback(async () => {
    if (onToggleFavorite) {
      onToggleFavorite();
    } else {
      if (isFavorite) {
        await fetch(`/api/v1/favorites/${symbol}`, { method: "DELETE" });
      } else {
        await fetch("/api/v1/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, name }),
        });
      }
    }
    onClose();
    router.refresh();
  }, [symbol, name, isFavorite, onToggleFavorite, onClose, router]);

  const handleTogglePortfolio = useCallback(async () => {
    setAdding(true);
    try {
      if (isInPortfolio) {
        await fetch(`/api/v1/watchlist?symbol=${encodeURIComponent(symbol)}`, {
          method: "DELETE",
        });
      } else {
        const bp = currentPrice ?? null;
        await fetch("/api/v1/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol,
            name,
            buy_price: bp,
            stop_loss_price: bp ? Math.round(bp * 0.9) : null,
            target_price: bp ? Math.round(bp * 1.1) : null,
          }),
        });
      }
    } catch (e) {
      console.error("[StockActionMenu] 포트 변경 실패:", e);
    } finally {
      setAdding(false);
      onClose();
      router.refresh();
    }
  }, [symbol, name, currentPrice, isInPortfolio, onClose, router]);

  const handleViewDetail = useCallback(() => {
    onClose();
    router.push(`/stock/${symbol}`);
  }, [symbol, onClose, router]);

  if (!isOpen) return null;

  // 메뉴 위치 계산
  const style: React.CSSProperties = position
    ? {
        position: "fixed",
        left: position.x,
        top: position.y,
        zIndex: 9999,
      }
    : {
        position: "absolute",
        right: 0,
        top: "100%",
        zIndex: 9999,
      };

  return (
    <>
      {/* 배경 오버레이 (모바일) */}
      <div className="fixed inset-0 bg-black/30 z-[9998] md:bg-transparent" onClick={onClose} />

      {/* 메뉴 */}
      <div
        ref={menuRef}
        style={style}
        className="bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl min-w-[200px] overflow-hidden"
      >
        {/* 헤더 */}
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">{name}</div>
            <div className="text-xs text-[var(--muted)]">{symbol}</div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--card-hover)]">
            <X className="w-4 h-4 text-[var(--muted)]" />
          </button>
        </div>

        {/* 메뉴 항목 */}
        <div className="py-1">
          <button
            onClick={handleTogglePortfolio}
            disabled={adding}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[var(--card-hover)] transition-colors text-left"
          >
            <Briefcase className={`w-4 h-4 ${isInPortfolio ? "text-purple-400" : "text-[var(--muted)]"}`} />
            <span>{isInPortfolio ? "포트에서 삭제" : "포트에 추가"}</span>
          </button>

          <button
            onClick={handleToggleFavorite}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[var(--card-hover)] transition-colors text-left"
          >
            <Star className={`w-4 h-4 ${isFavorite ? "text-yellow-400 fill-yellow-400" : "text-[var(--muted)]"}`} />
            <span>{isFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}</span>
          </button>

          <button
            onClick={handleViewDetail}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[var(--card-hover)] transition-colors text-left"
          >
            <ExternalLink className="w-4 h-4 text-[var(--muted)]" />
            <span>상세보기</span>
          </button>
        </div>
      </div>
    </>
  );
}
