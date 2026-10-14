"use client";

import { useEffect, useRef } from "react";
import { Info, Brain, Terminal, CheckCircle2, AlertTriangle, Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActivityEvent } from "@/lib/opencode/types";

const KIND_STYLE: Record<ActivityEvent["kind"], { icon: typeof Info; color: string }> = {
  info: { icon: Info, color: "text-muted-foreground" },
  thought: { icon: Brain, color: "text-violet-500" },
  tool_call: { icon: Terminal, color: "text-sky-500" },
  tool_result: { icon: CheckCircle2, color: "text-emerald-500" },
  error: { icon: AlertTriangle, color: "text-red-500" },
  done: { icon: Flag, color: "text-emerald-600" },
};

/** A scrolling, terminal-style activity log for an OpenCode build session. */
export function ActivityLog({ events }: { events: ActivityEvent[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [events.length]);

  return (
    <div className="bg-muted/40 h-[420px] overflow-auto rounded-md border p-3 font-mono text-xs">
      {events.length === 0 ? (
        <p className="text-muted-foreground">No activity yet.</p>
      ) : (
        <ol className="space-y-2">
          {events.map((e, i) => {
            const { icon: Icon, color } = KIND_STYLE[e.kind] ?? KIND_STYLE.info;
            return (
              <li key={i} className="flex gap-2">
                <Icon className={cn("mt-0.5 size-3.5 shrink-0", color)} />
                <div className="min-w-0 flex-1">
                  <span className="text-foreground break-words">{e.title}</span>
                  {e.detail && (
                    <pre className="text-muted-foreground mt-1 max-h-40 overflow-auto rounded bg-black/5 p-2 text-[11px] whitespace-pre-wrap dark:bg-white/5">
                      {e.detail}
                    </pre>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <div ref={endRef} />
    </div>
  );
}
