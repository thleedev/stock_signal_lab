"use client";

import React from "react";

interface Column<T> {
  key: string;
  label: string;
  priority: "always" | "sm" | "md" | "lg";
  align?: "left" | "center" | "right";
  width?: string;
  render?: (item: T) => React.ReactNode;
}

interface ResponsiveTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  onRowClick?: (item: T) => void;
  emptyMessage?: string;
}

const PRIORITY_CLASS: Record<string, string> = {
  always: "",
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

const ALIGN_CLASS: Record<string, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

export function ResponsiveTable<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  emptyMessage = "데이터가 없습니다",
}: ResponsiveTableProps<T>) {
  if (data.length === 0) {
    return (
      <div className="card card-padding-lg text-center text-[var(--muted)]">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)]">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`py-3 px-2 font-medium text-[var(--muted)] ${PRIORITY_CLASS[col.priority]} ${ALIGN_CLASS[col.align || "left"]}`}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((item) => (
            <tr
              key={keyExtractor(item)}
              className={`border-b border-[var(--border)] ${onRowClick ? "cursor-pointer hover:bg-[var(--card-hover)]" : ""}`}
              onClick={() => onRowClick?.(item)}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`py-3 px-2 ${PRIORITY_CLASS[col.priority]} ${ALIGN_CLASS[col.align || "left"]}`}
                >
                  {col.render
                    ? col.render(item)
                    : String(
                        (item as Record<string, unknown>)[col.key] ?? "",
                      )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
