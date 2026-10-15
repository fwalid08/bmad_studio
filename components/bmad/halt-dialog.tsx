"use client";
import { useState } from "react";
import { ShieldQuestion, MessageCircleQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { HaltRequest } from "@/lib/opencode/types";

export type HaltAnswer =
  | { kind: "permission"; decision: "once" | "always" | "reject" }
  | { kind: "form"; answer: Record<string, string | number | boolean | string[]> };

interface HaltDialogProps {
  halt: HaltRequest | null;
  busy?: boolean;
  onSubmit: (answer: HaltAnswer) => void;
  onClose: () => void;
}

// Blocks the build UI while the agent waits for a human decision: either a tool
// permission (approve/reject) or an agent question (fill the form and answer).
export function HaltDialog({ halt, busy, onSubmit, onClose }: HaltDialogProps) {
  const [values, setValues] = useState<Record<string, string | number | boolean | string[]>>({});

  if (!halt) return null;
  const isPermission = halt.kind === "permission";

  function setValue(key: string, value: string | number | boolean | string[]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <div className="mb-3 flex items-center gap-2">
          {isPermission ? (
            <ShieldQuestion className="text-amber-500 size-5 shrink-0" />
          ) : (
            <MessageCircleQuestion className="text-amber-500 size-5 shrink-0" />
          )}
          <DialogTitle className="text-base font-bold">
            {isPermission ? "Build menunggu izin" : "Agen butuh jawaban"}
          </DialogTitle>
        </div>

        <p className="text-muted-foreground mb-4 text-sm break-words">{halt.title}</p>
        {halt.message && (
          <pre className="bg-muted/50 mb-4 max-h-40 overflow-auto rounded border p-2 text-xs whitespace-pre-wrap">
            {halt.message}
          </pre>
        )}

        {isPermission && (halt.resources?.length ?? 0) > 0 && (
          <ul className="bg-muted/40 mb-4 max-h-32 overflow-auto rounded border p-2 font-mono text-[11px]">
            {halt.resources?.map((r, i) => (
              <li key={i} className="truncate" title={r}>
                {r}
              </li>
            ))}
          </ul>
        )}

        {!isPermission && (
          <div className="mb-4 space-y-3">
            {(halt.fields ?? []).map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={`halt-${f.key}`}>
                  {f.title ?? f.key}
                  {f.required && <span className="text-destructive"> *</span>}
                </Label>
                {f.type === "boolean" ? (
                  <div className="flex items-center gap-2">
                    <input
                      id={`halt-${f.key}`}
                      type="checkbox"
                      className="size-4"
                      checked={Boolean(values[f.key])}
                      onChange={(e) => setValue(f.key, e.target.checked)}
                    />
                    <span className="text-muted-foreground text-xs">{f.description ?? "Ya / Tidak"}</span>
                  </div>
                ) : f.options && f.options.length > 0 ? (
                  <select
                    id={`halt-${f.key}`}
                    className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                    value={String(values[f.key] ?? "")}
                    onChange={(e) => setValue(f.key, e.target.value)}
                  >
                    <option value="">— pilih —</option>
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.type === "number" || f.type === "integer" ? (
                  <Input
                    id={`halt-${f.key}`}
                    type="number"
                    value={String(values[f.key] ?? "")}
                    onChange={(e) => setValue(f.key, Number(e.target.value))}
                  />
                ) : f.description && f.description.length > 80 ? (
                  <Textarea
                    id={`halt-${f.key}`}
                    rows={3}
                    value={String(values[f.key] ?? "")}
                    onChange={(e) => setValue(f.key, e.target.value)}
                  />
                ) : (
                  <Input
                    id={`halt-${f.key}`}
                    value={String(values[f.key] ?? "")}
                    onChange={(e) => setValue(f.key, e.target.value)}
                    placeholder={f.description}
                  />
                )}
                {f.description && f.description.length <= 80 && !f.options && (
                  <p className="text-muted-foreground text-[11px]">{f.description}</p>
                )}
              </div>
            ))}
            {(halt.fields?.length ?? 0) === 0 && (
              <p className="text-muted-foreground text-xs">
                Form tanpa field — kirim jawaban kosong untuk melanjutkan.
              </p>
            )}
          </div>
        )}

        <div className="space-y-2">
          {isPermission ? (
            <>
              <Button
                className="w-full"
                disabled={busy}
                onClick={() => onSubmit({ kind: "permission", decision: "once" })}
              >
                Setujui sekali
              </Button>
              <Button
                variant="secondary"
                className="w-full"
                disabled={busy}
                onClick={() => onSubmit({ kind: "permission", decision: "always" })}
              >
                Selalu setujui
              </Button>
              <Button
                variant="destructive"
                className="w-full"
                disabled={busy}
                onClick={() => onSubmit({ kind: "permission", decision: "reject" })}
              >
                Tolak
              </Button>
            </>
          ) : (
            <Button
              className="w-full"
              disabled={busy}
              onClick={() => onSubmit({ kind: "form", answer: values })}
            >
              Kirim jawaban
            </Button>
          )}
          <Button variant="ghost" className="w-full" disabled={busy} onClick={onClose}>
            Tutup (biarkan build menunggu)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
