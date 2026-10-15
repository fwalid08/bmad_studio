"use client";

import { useEffect, useRef } from "react";
import { Info, Brain, Terminal, CheckCircle2, AlertTriangle, Flag, PauseCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import type { ActivityEvent } from "@/lib/opencode/types";

const KIND_STYLE: Record<ActivityEvent["kind"], { icon: typeof Info; color: string }> = {
  info: { icon: Info, color: "text-muted-foreground" },
  thought: { icon: Brain, color: "text-violet-500" },
  tool_call: { icon: Terminal, color: "text-sky-500" },
  tool_result: { icon: CheckCircle2, color: "text-emerald-500" },
  error: { icon: AlertTriangle, color: "text-red-500" },
  done: { icon: Flag, color: "text-emerald-600" },
  halt: { icon: PauseCircle, color: "text-amber-500" },
};

/** A scrolling, terminal-style activity log for an OpenCode build session. */
export function ActivityLog({ events, className }: { events: ActivityEvent[]; className?: string }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [events.length]);

  const toolCalls = new Map<string, { count: number; details: Set<string> }>();
  for (const event of events) {
    if (event.kind !== "tool_call") continue;
    const name = event.title.replace(/^▶\s*/, "");
    const group = toolCalls.get(name) ?? { count: 0, details: new Set<string>() };
    group.count += 1;
    if (event.detail) group.details.add(event.detail);
    toolCalls.set(name, group);
  }
  const renderedToolCalls = new Set<string>();

  return (
    <div className={cn("bg-muted/40 h-[420px] overflow-auto rounded-md border p-3 font-mono text-xs", className)}>
      {events.length === 0 ? (
        <p className="text-muted-foreground">No activity yet.</p>
      ) : (
        <ol className="space-y-2">
          {events.map((e, i) => {
            let title = e.title;
            let detail = e.detail;
            if (e.kind === "tool_call") {
              const name = e.title.replace(/^▶\s*/, "");
              if (renderedToolCalls.has(name)) return null;
              renderedToolCalls.add(name);
              const group = toolCalls.get(name);
              title = `Memanggil ${name} ${group?.count ?? 1}x`;
              detail = [...(group?.details ?? [])].join("\n") || undefined;
            }
            const { icon: Icon, color } = KIND_STYLE[e.kind] ?? KIND_STYLE.info;
            const foldDetail =
              e.kind === "tool_call" ||
              e.kind === "tool_result" ||
              (e.kind === "error" && e.title.startsWith("✖"));
            return (
              <li key={i} className="flex gap-2 rounded-md border border-border/60 bg-background p-2 shadow-sm">
                <Icon className={cn("mt-0.5 size-3.5 shrink-0", color)} />
                <div className="min-w-0 flex-1">
                  {(e.kind !== "thought" || !detail) && (
                    <span className="text-foreground break-words">{title}</span>
                  )}
                  {detail && (
                    e.kind === "thought" ? (
                      <div className="md-preview min-w-0 font-sans text-sm text-foreground">
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{detail}</ReactMarkdown>
                      </div>
                    ) : foldDetail ? (
                      <details className="mt-1 min-w-0 text-muted-foreground">
                        <summary className="w-fit cursor-pointer select-none text-[11px] hover:text-foreground">Detail</summary>
                        <div className="md-preview mt-1 max-h-48 overflow-auto font-sans text-xs break-words text-foreground">
                          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{detail}</ReactMarkdown>
                        </div>
                      </details>
                    ) : (
                      <div className="md-preview min-w-0 font-sans text-xs text-muted-foreground">
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{detail}</ReactMarkdown>
                      </div>
                    )
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
