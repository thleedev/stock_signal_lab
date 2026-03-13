"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Star, StarOff, Briefcase, ExternalLink, X, Check } from "lucide-react";
import type { WatchlistGroup } from "@/types/stock";
import { TradeModal } from "@/app/my-portfolio/components/trade-modal";
import { useStockModal } from "@/contexts/stock-modal-context";

interface Portfolio {
  id: number;
  name: string;
  is_default: boolean;
}

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
  groups?: WatchlistGroup[];
  symbolGroupIds?: string[];
  onGroupToggle?: (group: WatchlistGroup) => void;
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
  groups,
  symbolGroupIds,
  onGroupToggle,
}: StockActionMenuProps) {
  const router = useRouter();
  const { openStockModal } = useStockModal();
  const menuRef = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState(false);
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);

  // click-outside / Esc — TradeModal 열려 있으면 무시
  useEffect(() => {
    if (!isOpen || showTradeModal) return;
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
  }, [isOpen, showTradeModal, onClose]);

  const handleAddToPortfolio = useCallback(async () => {
    if (isInPortfolio) {
      setAdding(true);
      try {
        const res = await fetch(`/api/v1/user-portfolio/trades?symbol=${encodeURIComponent(symbol)}`);
        const data = await res.json();
        const trades: Array<{ id: number; side: string; created_at: string }> = data.trades ?? [];
        const latestBuy = trades
          .filter((t) => t.side === "BUY")
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
        if (latestBuy) {
          const delRes = await fetch(`/api/v1/user-portfolio/trades?trade_id=${latestBuy.id}`, {
            method: "DELETE",
          });
          if (delRes.status === 409) {
            alert("이미 처리된 거래입니다.");
          }
        }
      } catch (e) {
        console.error("[StockActionMenu] 포트 삭제 실패:", e);
      } finally {
        setAdding(false);
        onClose();
        router.refresh();
      }
      return;
    }

    // 포트폴리오 목록 조회 후 TradeModal 표시 (메뉴는 isOpen 상태 유지)
    try {
      const res = await fetch("/api/v1/user-portfolio");
      const data = await res.json();
      setPortfolios(data.portfolios ?? []);
    } catch (e) {
      console.error("[StockActionMenu] 포트폴리오 목록 조회 실패:", e);
    }
    setShowTradeModal(true);
  }, [symbol, isInPortfolio, onClose, router]);

  const handleTradeModalClose = useCallback(() => {
    setShowTradeModal(false);
    onClose();
  }, [onClose]);

  const handleTradeSubmit = useCallback(() => {
    setShowTradeModal(false);
    onClose();
    router.refresh();
  }, [onClose, router]);

  const handleViewDetail = useCallback(() => {
    onClose();
    openStockModal(symbol, name);
  }, [symbol, name, onClose, openStockModal]);

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
      {/* TradeModal이 열려 있지 않을 때만 메뉴 표시 */}
      {!showTradeModal && (
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
              {/* 1. 상세보기 */}
              <button
                onClick={handleViewDetail}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[var(--card-hover)] transition-colors text-left"
              >
                <ExternalLink className="w-4 h-4 text-[var(--muted)]" />
                <span>상세보기</span>
              </button>

              {/* 2. 포트에 추가/삭제 */}
              <button
                onClick={handleAddToPortfolio}
                disabled={adding}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[var(--card-hover)] transition-colors text-left"
              >
                <Briefcase className={`w-4 h-4 ${isInPortfolio ? "text-purple-400" : "text-[var(--muted)]"}`} />
                <span>{isInPortfolio ? "포트에서 삭제" : "포트에 추가"}</span>
              </button>

              {/* 3. 관심종목 추가/일괄 해제 */}
              {onToggleFavorite && (
                <button
                  onClick={() => { onToggleFavorite(); onClose(); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[var(--card-hover)] transition-colors text-left"
                >
                  {isFavorite ? (
                    <>
                      <StarOff className="w-4 h-4 text-orange-400" />
                      <span className="text-orange-400">관심그룹 일괄 해제</span>
                    </>
                  ) : (
                    <>
                      <Star className="w-4 h-4 text-yellow-400" />
                      <span>관심종목 추가</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* 관심그룹 서브메뉴 */}
            {groups && groups.length > 0 && (
              <div>
                <div className="px-4 py-1.5 text-xs text-[var(--muted)] border-t border-[var(--border)]">
                  관심그룹
                </div>
                {groups.map((group) => {
                  const inGroup = (symbolGroupIds ?? []).includes(group.id);
                  return (
                    <button
                      key={group.id}
                      onClick={() => { onGroupToggle?.(group); }}
                      className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-[var(--card-hover)] transition-colors text-left"
                    >
                      <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${
                        inGroup ? "bg-[#6366f1] border-[#6366f1]" : "border-[var(--border)]"
                      }`}>
                        {inGroup && <Check className="w-2.5 h-2.5 text-white" />}
                      </span>
                      <span className="text-[var(--foreground)]">{group.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* TradeModal — isOpen 상태에서 메뉴 대신 표시 */}
      <TradeModal
        mode="buy"
        isOpen={showTradeModal}
        onClose={handleTradeModalClose}
        onSubmit={handleTradeSubmit}
        initialSymbol={symbol}
        initialName={name}
        initialPrice={currentPrice ?? undefined}
        portfolios={portfolios}
      />
    </>
  );
}
