import test from "node:test";
import assert from "node:assert/strict";

import { parseAgentBreakdown } from "./tasks";

test("parse jawaban fence json tasks → kandidat berprioritas + tags", () => {
  const raw = [
    "```json tasks",
    '[{"title": "User bisa login", "epic": "Auth", "priority": "high", "tags": ["frontend", "auth"], "detail": "Story: Sebagai user saya bisa login agar masuk\\nAkseptansi:\\n1. Form validasi email\\n2. Session tersimpan"},',
    '{"title": "User bisa logout", "epic": "Auth", "priority": "P3", "tags": "frontend, auth", "detail": "Story: logout"},',
    '{"title": "x", "epic": "Auth"}]',
    "```",
  ].join("\n");
  const out = parseAgentBreakdown(raw);
  assert.equal(out.length, 2);
  assert.equal(out[0]?.title, "User bisa login");
  assert.equal(out[0]?.priority, "high");
  assert.deepEqual(out[0]?.tags, ["frontend", "auth"]);
  assert.equal(out[1]?.priority, "low");
});

test("toleran array longgar di luar fence + trailing comma + dedup", () => {
  const raw = 'Berikut hasilnya: [{"title": "Buat task", "epic": "Board", "priority": "medium", "detail": "Story: buat",}, {"title": "buat TASK", "epic": "Board", "detail": "duplikat"}] selesai.';
  const out = parseAgentBreakdown(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.title, "Buat task");
  assert.equal(out[0]?.priority, "medium");
});

test("lewati blok sprint taskTitles, kembalikan kosong bila tak ada stories", () => {
  const raw = '```json sprint\n{"name": "S1", "goal": "x", "taskTitles": ["A"]}\n```';
  assert.deepEqual(parseAgentBreakdown(raw), []);
  assert.deepEqual(parseAgentBreakdown("tidak ada json sama sekali"), []);
});
