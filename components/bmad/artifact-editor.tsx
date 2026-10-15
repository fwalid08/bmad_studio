"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Wand2,
  PenLine,
  Download,
  Check,
  RotateCcw,
  Code,
  Eye,
  ArrowLeft,
  Loader2,
  Bot,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { TEMPLATES } from "@/lib/bmad/templates";
import { normalizeMarkdown } from "@/lib/bmad/markdown";
import { validateArtifact } from "@/lib/bmad/validate";
import type { RoadmapStep } from "@/lib/bmad/roadmap";
import type { Project, ArtifactStatus, StepId } from "@/lib/bmad/types";
import { statusLabel } from "@/lib/progress";

export type DraftMode = "manual" | "agent";

export interface StepNav {
  id: StepId;
  name: string;
}

interface Props {
  step: RoadmapStep;
  project: Project;
  draftMode: DraftMode;
  onDraftModeChange: (m: DraftMode) => void;
  onSave: (content: string, status: ArtifactStatus) => void;
  prevStep: StepNav | null;
  nextStep: StepNav | null;
  onNavigate: (stepId: StepId) => void;
}

export function ArtifactEditor({
  step,
  project,
  draftMode,
  onDraftModeChange,
  onSave,
  prevStep,
  nextStep,
  onNavigate,
}: Props) {
  const artifact = project.artifacts[step.id];
  const tpl = TEMPLATES[step.id];
  const isComplete = artifact?.status === "complete";

  // Manual flow: form first, editor appears only after Generate.
  // If a draft already exists (revisit / agent draft), start on the result.
  const [manualView, setManualView] = useState<"form" | "result">(
    artifact?.content?.trim() ? "result" : "form"
  );
  const [editorView, setEditorView] = useState<"code" | "preview">("code");
  const [content, setContent] = useState(artifact?.content ?? "");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Sync external updates (e.g. "Buatkan draft" from the agent card).
  useEffect(() => {
    setContent(artifact?.content ?? "");
    if (artifact?.content?.trim()) setManualView("result");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id, artifact?.updatedAt]);

  const generated = useMemo(() => {
    if (!tpl) return "";
    return tpl.build(answers, project.name);
  }, [answers, tpl, project.name]);

  const previewContent = useMemo(() => normalizeMarkdown(content), [content]);
  const issues = useMemo(
    () => validateArtifact(step.id, content, project.name),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [content, step.id]
  );

  function handleFormat() {
    const formatted = normalizeMarkdown(content);
    if (formatted !== content) {
      setContent(formatted);
      onSave(formatted, artifact?.status ?? "draft");
    }
  }

  function handleGenerate() {
    setContent(generated);
    onSave(generated, "draft");
    setManualView("result");
  }

  function handleSave(status: ArtifactStatus) {
    setSaving(status === "draft");
    try {
      onSave(content, status);
    } finally {
      // store update is sync; release the spinner on next tick
      setTimeout(() => setSaving(false), 400);
    }
  }

  function download() {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = step.output;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const modeToggle = (
    <div
      className="grid w-full grid-cols-2 overflow-hidden rounded-lg border text-sm"
      role="group"
      aria-label="Draft mode"
    >
      <button
        type="button"
        onClick={() => onDraftModeChange("manual")}
        className={
          "flex items-center justify-center gap-1.5 px-3 py-2 transition-colors " +
          (draftMode === "manual"
            ? "bg-primary/10 font-medium"
            : "hover:bg-accent text-muted-foreground")
        }
        title="Isi form wizard sendiri, lalu Generate (tanpa AI)"
      >
        <PenLine className="size-4" /> Manual
      </button>
      <button
        type="button"
        onClick={() => onDraftModeChange("agent")}
        className={
          "flex items-center justify-center gap-1.5 border-l px-3 py-1.5 transition-colors " +
          (draftMode === "agent"
            ? "bg-primary/10 font-medium"
            : "hover:bg-accent text-muted-foreground")
        }
        title="Minta AI menuliskan draft langkah ini"
      >
        <Bot className="size-4" /> Agent
      </button>
    </div>
  );

  const viewToggle = (
    <div
      className="flex overflow-hidden rounded-full border text-xs"
      role="group"
      aria-label="Editor view"
    >
      <button
        type="button"
        onClick={() => setEditorView("code")}
        className={
          "flex items-center gap-1 px-3 py-1.5 transition-colors " +
          (editorView === "code"
            ? "bg-primary/10 font-medium"
            : "hover:bg-accent")
        }
      >
        <Code className="size-3.5" /> Code
      </button>
      <button
        type="button"
        onClick={() => setEditorView("preview")}
        className={
          "flex items-center gap-1 border-l px-3 py-1.5 transition-colors " +
          (editorView === "preview"
            ? "bg-primary/10 font-medium"
            : "hover:bg-accent")
        }
      >
        <Eye className="size-3.5" /> Preview
      </button>
    </div>
  );

  const topHeaderBar = (
    <div className="rounded-lg bg-gradient-to-r from-zinc-900 to-zinc-800 px-4 py-3 shadow-sm dark:from-zinc-950 dark:to-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="outline" className="border-white/20 text-zinc-200">
            {step.code}
          </Badge>
          <span className="min-w-0 truncate text-sm font-medium text-white">
            {step.output}
          </span>
          <span className="shrink-0 text-xs text-zinc-400">
            {statusLabel(artifact?.status ?? "not-started")}
            {isComplete ? " · Terkunci" : ""}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={download}
            disabled={!content}
            className="border-white/25 bg-white/5 text-zinc-100 shadow-sm hover:bg-white/15 hover:text-white disabled:opacity-40"
          >
            <Download className="size-4" /> Export
          </Button>
          {!isComplete ? (
            <Button
              size="sm"
              onClick={() => handleSave("complete")}
              disabled={!content.trim()}
              className="bg-emerald-500 text-white shadow-md shadow-emerald-500/30 hover:bg-emerald-400"
            >
              <Check className="size-4" /> Mark complete
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleSave("draft")}
              className="border-amber-300/40 bg-amber-400/10 text-amber-200 shadow-sm hover:bg-amber-400/20 hover:text-amber-100"
            >
              <RotateCcw className="size-4" /> Reopen
            </Button>
          )}
        </div>
      </div>
      {isComplete && (prevStep || nextStep) && (
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/10 pt-2">
          {prevStep ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onNavigate(prevStep.id)}
              title={`Kembali ke ${prevStep.name}`}
              className="min-w-0 border-white/25 bg-white/5 text-zinc-100 shadow-sm hover:bg-white/15 hover:text-white"
            >
              <ChevronLeft className="size-4 shrink-0" />
              <span className="max-w-36 truncate">{prevStep.name}</span>
            </Button>
          ) : (
            <span />
          )}
          {nextStep ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onNavigate(nextStep.id)}
              title={`Lanjut ke ${nextStep.name}`}
              className="min-w-0 border-white/25 bg-white/5 text-zinc-100 shadow-sm hover:bg-white/15 hover:text-white"
            >
              <span className="max-w-36 truncate">{nextStep.name}</span>
              <ChevronRight className="size-4 shrink-0" />
            </Button>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );

  const editorCard = (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <span className="text-muted-foreground text-xs">
          {content.trim().length} characters
          {isComplete ? " · Terkunci — Reopen untuk mengedit" : ""}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleFormat}
            disabled={!content.trim() || isComplete}
            className="hover:bg-accent rounded-full border px-3 py-1.5 text-xs disabled:opacity-40"
            title="Rapikan format Markdown (blank line, fence, frontmatter)"
          >
            Format
          </button>
          {viewToggle}
        </div>
      </div>
      <CardContent className="p-0">
        {editorView === "code" ? (
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={`# ${step.name}\n\nStart writing ${step.output}…`}
            className="min-h-[50vh] rounded-none border-0 font-mono text-sm shadow-none focus-visible:ring-0"
            disabled={isComplete}
            readOnly={isComplete}
          />
        ) : (
          <div className="md-preview min-h-[50vh] p-4 text-sm">
            {previewContent.trim() ? (
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                {previewContent}
              </ReactMarkdown>
            ) : (
              <p className="text-muted-foreground">Nothing to preview yet.</p>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 border-t px-4 py-3">
          <Button
            onClick={() => handleSave("draft")}
            disabled={!content.trim() || isComplete || saving}
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? "Menyimpan…" : "Save draft"}
          </Button>
          {draftMode === "manual" && (
            <Button
              variant="ghost"
              onClick={() => setManualView("form")}
              disabled={isComplete}
            >
              <ArrowLeft className="size-4" /> Kembali ke form
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );

  const wizardForm = (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Form {step.name}</CardTitle>
        <CardDescription>
          Jawab pertanyaan di bawah lalu Generate — draft mengikuti template
          yang sama dengan yang dipakai agent.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {tpl ? (
          <div className="space-y-4">
            {tpl.questions.map((q) => (
              <div key={q.id} className="space-y-1.5">
                <Label htmlFor={q.id}>{q.label}</Label>
                {q.help && (
                  <p className="text-muted-foreground text-xs">{q.help}</p>
                )}
                {q.multiline ? (
                  <Textarea
                    id={q.id}
                    value={answers[q.id] ?? ""}
                    placeholder={q.placeholder}
                    onChange={(e) =>
                      setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                    }
                    rows={4}
                    disabled={isComplete}
                  />
                ) : (
                  <Input
                    id={q.id}
                    value={answers[q.id] ?? ""}
                    placeholder={q.placeholder}
                    onChange={(e) =>
                      setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                    }
                    disabled={isComplete}
                  />
                )}
              </div>
            ))}
            <div className="flex flex-col items-start gap-2">
              <Button onClick={handleGenerate} disabled={isComplete}>
                <Wand2 className="size-4" /> Generate {step.output}
              </Button>
              {generated && (
                <details className="text-muted-foreground w-full text-xs">
                  <summary className="cursor-pointer">Preview</summary>
                  <pre className="bg-muted mt-2 max-h-48 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                    {generated}
                  </pre>
                </details>
              )}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            No guided questions for this step — use the editor directly.
          </p>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col gap-4">
      {topHeaderBar}
      {modeToggle}
      {issues.length > 0 && content.trim() && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <p className="mb-1 font-semibold text-amber-700 dark:text-amber-400">
            Validasi format ({issues.length})
          </p>
          <ul className="list-disc space-y-0.5 pl-4 text-amber-700 dark:text-amber-400">
            {issues.map((it, i) => (
              <li key={i}>
                {it.level === "error" ? "⛔ " : "⚠️ "}{it.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {draftMode === "manual" ? (
        manualView === "form" ? (
          <>{wizardForm}</>
        ) : (
          <>{editorCard}</>
        )
      ) : (
        <>
          <p className="text-muted-foreground text-xs">
            Mode agent: klik <strong>Buatkan draft</strong> di card agent
            (kanan) — agent mengelaborasi template draft memakai konteks
            fase-fase sebelumnya. Hasilnya bisa disunting di bawah.
          </p>
          {editorCard}
        </>
      )}
    </div>
  );
}
