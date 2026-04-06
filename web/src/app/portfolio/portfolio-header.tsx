"use client";

import { useGlobalPriceRefresh } from "@/hooks/use-global-price-refresh";
import { PriceUpdateBadge } from "@/components/common/price-update-badge";
import { PageHeader } from "@/components/ui";

interface Props {
  lastPriceUpdate?: string | null;
}

export function PortfolioHeader({ lastPriceUpdate }: Props) {
  const { refreshing, isStale, updateTime, refresh } =
    useGlobalPriceRefresh({});

  return (
    <PageHeader
      title="AI 포트폴리오"
      subtitle="3개 AI 합산 성과"
      action={
        <PriceUpdateBadge
          priceUpdateLabel={updateTime}
          isStale={isStale}
          refreshing={refreshing}
          onRefresh={refresh}
        />
      }
    />
  );
}
