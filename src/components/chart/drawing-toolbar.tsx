"use client";

import { memo } from "react";
import {
  Layers,
  MousePointer,
  MoveRight,
  Ruler,
  Square,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { type DrawingToolType } from "@/lib/user-drawings";

export interface DrawingToolbarProps {
  readonly activeTool: DrawingToolType;
  readonly onSelectTool: (tool: DrawingToolType) => void;
  readonly onClearDrawings: () => void;
  readonly drawingCount: number;
}

interface ToolItem {
  readonly tool: DrawingToolType;
  readonly label: string;
  readonly icon: typeof MousePointer;
}

const TOOLS: readonly ToolItem[] = [
  { tool: "cursor", label: "Crosshair / Select (Esc)", icon: MousePointer },
  { tool: "trendline", label: "Trendline", icon: TrendingUp },
  { tool: "ray", label: "Horizontal Ray", icon: MoveRight },
  { tool: "fibonacci", label: "Fib Retracement", icon: Layers },
  { tool: "rectangle", label: "Rectangle", icon: Square },
  { tool: "measure", label: "Measure Tool", icon: Ruler },
];

export const DrawingToolbar = memo(function DrawingToolbar({
  activeTool,
  onSelectTool,
  onClearDrawings,
  drawingCount,
}: DrawingToolbarProps) {
  return (
    <div className="absolute left-1.5 top-12 z-20 flex flex-col items-center gap-0.5 rounded-md border border-border bg-popover/90 p-0.5 shadow-md backdrop-blur-sm">
      {TOOLS.map(({ tool, label, icon: Icon }) => {
        const isActive = activeTool === tool;
        return (
          <button
            key={tool}
            type="button"
            title={label}
            onClick={() => onSelectTool(isActive && tool !== "cursor" ? "cursor" : tool)}
            className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
              isActive
                ? "bg-[#2962ff] text-white shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-white"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
      <div className="my-0.5 h-px w-5 bg-border" />
      <button
        type="button"
        title={drawingCount > 0 ? `Clear ${drawingCount} drawings` : "No drawings to clear"}
        disabled={drawingCount === 0}
        onClick={onClearDrawings}
        className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-[#f23645] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
});
