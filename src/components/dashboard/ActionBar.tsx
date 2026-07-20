import React from "react";

export function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-5 py-2.5 shrink-0">
      {children}
    </div>
  );
}
