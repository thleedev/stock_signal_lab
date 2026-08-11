"use client";

import React from "react";

/** 카드→테이블 전환 브레이크포인트. 소비처의 테이블에서 가장 늦게(가장 넓은 폭에서) 나타나는 컬럼 기준에 맞춥니다 */
export type StackedListBreakpoint = "md" | "lg";

// Tailwind 는 클래스명을 정적으로 추출하므로 `${bp}:hidden` 처럼 문자열을 조립하면
// 스타일이 빠집니다. 브레이크포인트별 완전한 클래스 문자열을 미리 적어 두고 고릅니다.
const CARD_CLASS: Record<StackedListBreakpoint, string> = {
  md: "md:hidden divide-y divide-[var(--border)]",
  lg: "lg:hidden divide-y divide-[var(--border)]",
};
const TABLE_CLASS: Record<StackedListBreakpoint, string> = {
  md: "hidden md:block",
  lg: "hidden lg:block",
};

interface StackedListProps<T> {
  /** 카드로 그릴 항목 목록 */
  items: T[];
  /** React key 로 쓸 값을 뽑습니다 */
  keyOf: (item: T) => string;
  /** 카드 한 장의 내용을 그립니다. 카드 껍데기는 이 컴포넌트가 씌웁니다 */
  renderCard: (item: T) => React.ReactNode;
  /** 카드를 눌렀을 때의 동작 */
  onItemClick?: (item: T, e: React.MouseEvent) => void;
  /** 데스크톱에서 그대로 보여줄 기존 테이블 */
  children: React.ReactNode;
  /**
   * 카드→테이블 전환 폭. 기본값은 md(768px) 입니다.
   * 소비처 테이블의 컬럼 은닉이 md:table-cell 까지만 있으면 기본값으로 충분하지만,
   * lg:table-cell 까지 숨는 컬럼(예: /stocks 의 신호 배지 3종)이 있으면 "lg" 를 지정해야
   * md~lg 사이 폭에서 카드도 없고 컬럼도 없는 정보 손실 구간이 생기지 않습니다.
   */
  breakpoint?: StackedListBreakpoint;
}

/**
 * 좁은 화면에서는 카드를, 넓은 화면에서는 기존 테이블을 보여줍니다.
 *
 * 컬럼 스키마를 요구하지 않고 renderCard 로 카드 내용을 위임합니다.
 * 앞서 있던 ResponsiveTable 은 Column<T> 배열을 강제해 배지·팝오버·액션 메뉴가
 * 섞인 실제 테이블을 표현하지 못했고 결국 아무 곳에서도 쓰이지 않았습니다.
 *
 * 전환은 CSS 로만 처리합니다. 자바스크립트 판정을 쓰면 서버 렌더링 결과와
 * 어긋나 첫 페인트가 깜빡입니다.
 *
 * 전환 폭은 breakpoint prop 으로 고릅니다(기본 md). 카드가 사라지는 폭과 테이블의
 * 마지막 컬럼이 나타나는 폭이 어긋나면 그 사이 구간에서 카드도 컬럼도 없는 정보
 * 손실 구간이 생기므로, 소비처 테이블에서 가장 늦게 나타나는 컬럼의 브레이크포인트에
 * 맞춰야 합니다.
 *
 * 빈 상태는 이 컴포넌트가 처리하지 않습니다. items 가 비어도 카드 블록과
 * children 을 그대로 렌더합니다. 카드 껍데기와 반응형 전환만 책임진다는
 * 설계 의도에 빈 상태 문구도 내용이라 벗어나며, 소비처가 이미 .card 래퍼
 * 안에서 테이블을 감싸는 경우 여기서 또 .card 를 그리면 테두리가 이중으로
 * 겹칩니다. 빈 상태 표시는 페이지가 책임집니다.
 */
export function StackedList<T>({
  items,
  keyOf,
  renderCard,
  onItemClick,
  children,
  breakpoint = "md",
}: StackedListProps<T>) {
  return (
    <>
      {/* 좁은 화면: 카드 목록 */}
      <div className={CARD_CLASS[breakpoint]}>
        {items.map((item) => (
          <div
            key={keyOf(item)}
            onClick={onItemClick ? (e) => onItemClick(item, e) : undefined}
            className={`px-3 py-3 ${onItemClick ? "cursor-pointer hover:bg-[var(--card-hover)]" : ""}`}
          >
            {renderCard(item)}
          </div>
        ))}
      </div>

      {/* 넓은 화면: 기존 테이블 */}
      <div className={TABLE_CLASS[breakpoint]}>{children}</div>
    </>
  );
}
