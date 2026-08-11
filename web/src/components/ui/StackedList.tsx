"use client";

import React from "react";

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
}: StackedListProps<T>) {
  return (
    <>
      {/* 좁은 화면: 카드 목록 */}
      <div className="md:hidden divide-y divide-[var(--border)]">
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
      <div className="hidden md:block">{children}</div>
    </>
  );
}
