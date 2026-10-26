"use client";

import type { ReactNode } from "react";
import { pnlClass } from "@/components/strategy/report-format";

/** Layout primitives of the Strategy Tester report, in TradingView's style. */

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">{title}</h3>{action}</div>
      {children}
    </section>
  );
}

export function SubSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between"><h4 className="text-sm font-semibold">{title}</h4>{action}</div>
      {children}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{children}</div>;
}

/** A labelled figure; `tone` colours it green/red by sign. */
export function Stat({ label, value, extra, tone }: { label: string; value: string; extra?: string; tone?: number }) {
  const color = tone === undefined ? "" : pnlClass(tone);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-base ${color}`}>{value}{extra !== undefined && <span className="ml-2">{extra}</span>}</span>
    </div>
  );
}

export function Pills<T extends string>({ options, value, onChange }: {
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([key, label]) => (
        <button
          key={key} type="button" onClick={() => onChange(key)}
          className={`rounded-full px-3 py-1 text-sm ${key === value ? "bg-foreground text-background" : "bg-muted text-foreground hover:bg-muted/70"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function IconToggle({ isActive, onClick, title, children }: {
  isActive: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button" title={title} onClick={onClick}
      className={`rounded px-2 py-1 text-xs ${isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

export function Empty() {
  return <p className="py-10 text-center text-sm text-muted-foreground">Not enough data to show</p>;
}
