"use client";

import { useMemo, useState } from "react";
import { Wand2, PenLine, Download, Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { TEMPLATES } from "@/lib/bmad/templates";
import type { RoadmapStep } from "@/lib/bmad/roadmap";
import type { Project, ArtifactStatus } from "@/lib/bmad/types";
import { statusLabel } from "@/lib/progress";

interface Props {
  step: RoadmapStep;
  project: Project;
  onSave: (content: string, status: ArtifactStatus) => void;
}

export function ArtifactEditor({ step, project, onSave }: Props) {
  const artifact = project.artifacts[step.id];
  const tpl = TEMPLATES[step.id];
  const [mode, setMode] = useState<"wizard" | "editor">(
    artifact?.content ? "editor" : "wizard"
  );
  const [content, setContent] = useState(artifact?.content ?? "");
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const generated = useMemo(() => {
    if (!tpl) return "";
    return tpl.build(answers, project.name);
  }, [answers, tpl, project.name]);

  function handleGenerate() {
    setContent(generated);
    setMode("editor");
    onSave(generated, "draft");
  }

  function handleSave(status: ArtifactStatus) {
    onSave(content, status);
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

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{step.code}</Badge>
          <span className="text-muted-foreground text-sm">
            {statusLabel(artifact?.status ?? "not-started")} ·{" "}
            <code className="text-xs">{step.output}</code>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={download} disabled={!content}>
            <Download className="size-4" /> Export
          </Button>
          {artifact?.status !== "complete" ? (
            <Button
              size="sm"
              onClick={() => handleSave("complete")}
              disabled={!content.trim()}
            >
              <Check className="size-4" /> Mark complete
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => handleSave("draft")}>
              <RotateCcw className="size-4" /> Reopen
            </Button>
          )}
        </div>
      </div>

      <Tabs value={mode} onValueChange={(v) => setMode(v as "wizard" | "editor")} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="w-fit">
          <TabsTrigger value="wizard">
            <Wand2 className="size-4" /> Guided wizard
          </TabsTrigger>
          <TabsTrigger value="editor">
            <PenLine className="size-4" /> Editor
          </TabsTrigger>
        </TabsList>

        <TabsContent value="wizard" className="min-h-0 flex-1 overflow-auto">
          {tpl ? (
            <div className="space-y-4">
              <p className="text-muted-foreground text-sm">
                Answer the guided questions, then generate a first draft you can
                refine in the editor.
              </p>
              {tpl.questions.map((q) => (
                <div key={q.id} className="space-y-1.5">
                  <Label htmlFor={q.id}>{q.label}</Label>
                  {q.multiline ? (
                    <Textarea
                      id={q.id}
                      value={answers[q.id] ?? ""}
                      placeholder={q.placeholder}
                      onChange={(e) =>
                        setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                      }
                      rows={4}
                    />
                  ) : (
                    <Input
                      id={q.id}
                      value={answers[q.id] ?? ""}
                      placeholder={q.placeholder}
                      onChange={(e) =>
                        setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                      }
                    />
                  )}
                </div>
              ))}
              <div className="flex flex-col items-start gap-2">
                <Button onClick={handleGenerate}>
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
        </TabsContent>

        <TabsContent value="editor" className="flex min-h-0 flex-1 flex-col">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={`# ${step.name}\n\nStart writing ${step.output}…`}
            className="min-h-[50vh] flex-1 font-mono text-sm"
          />
          <div className="mt-3 flex items-center gap-2">
            <Button onClick={() => handleSave("draft")} disabled={!content.trim()}>
              Save draft
            </Button>
            <span className="text-muted-foreground text-xs">
              {content.trim().length} characters
            </span>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
