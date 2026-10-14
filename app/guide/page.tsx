import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  Sparkles,
  Wand2,
  PenLine,
  Download,
  Check,
  FolderPlus,
  LayoutDashboard,
  Bot,
  KeyRound,
  Lightbulb,
  Rocket,
  HelpCircle,
  Circle,
  CircleDashed,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { PHASES, stepById } from "@/lib/bmad/roadmap";
import { AGENT_LIST } from "@/lib/bmad/agents";
import type { ProjectScale } from "@/lib/bmad/types";

export const metadata: Metadata = {
  title: "Panduan Pengguna — BMAD Studio",
  description:
    "Panduan lengkap cara menggunakan BMAD Studio untuk membangun software dengan metode BMAD.",
};

const SCALE_INFO: Record<ProjectScale, { label: string; hint: string }> = {
  express: { label: "Express", hint: "Perubahan kecil & jelas — perencanaan minimal, langsung ke Build." },
  light: { label: "Light", hint: "Fitur standar — PRD, arsitektur, epics, lalu build." },
  full: { label: "Full", hint: "Inisiatif besar — semua gate perencanaan termasuk UX dan retrospektif." },
};

function SectionTitle({
  id,
  icon,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="mb-4 scroll-mt-8">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        {icon}
        {children}
      </h2>
      <Separator className="mt-3" />
    </div>
  );
}

function StepListItem({ children }: { children: React.ReactNode }) {
  return <li className="flex gap-2.5">{children}</li>;
}

export default function GuidePage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <div className="mb-8 flex items-center gap-3">
        <Link href="/dashboard">
          <Button variant="ghost" size="icon"><ArrowLeft className="size-4" /></Button>
        </Link>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <BookOpen className="size-6" /> Panduan Pengguna
          </h1>
          <p className="text-muted-foreground text-sm">
            Semua yang perlu Anda ketahui untuk membangun software dengan BMAD Studio.
          </p>
        </div>
      </div>

      <nav className="bg-muted/50 mb-10 rounded-lg border p-4">
        <p className="mb-2 text-sm font-semibold">Daftar Isi</p>
        <ol className="text-muted-foreground grid gap-1 text-sm sm:grid-cols-2">
          <li><a className="hover:text-foreground" href="#pengenalan">1. Pengenalan</a></li>
          <li><a className="hover:text-foreground" href="#memulai">2. Membuat Proyek Pertama</a></li>
          <li><a className="hover:text-foreground" href="#workspace">3. Bekerja di Workspace</a></li>
          <li><a className="hover:text-foreground" href="#wizard-editor">4. Wizard &amp; Editor</a></li>
          <li><a className="hover:text-foreground" href="#status-export">5. Status &amp; Ekspor</a></li>
          <li><a className="hover:text-foreground" href="#agen">6. Mengenal Agen BMAD</a></li>
          <li><a className="hover:text-foreground" href="#ai">7. Pengaturan OpenCode</a></li>
          <li><a className="hover:text-foreground" href="#autopilot">8. Rencana &amp; Eksekusi (OpenCode)</a></li>
          <li><a className="hover:text-foreground" href="#faq">9. Tips &amp; FAQ</a></li>
        </ol>
      </nav>

      {/* 1. Pengenalan */}
      <section className="mb-12">
        <SectionTitle id="pengenalan" icon={<Sparkles className="size-5" />}>
          Pengenalan
        </SectionTitle>
        <div className="text-sm leading-relaxed">
          <p className="mb-3">
            <strong>BMAD Studio</strong> adalah studio web terpandu yang membantu Anda membangun
            software menggunakan <strong>BMAD Method</strong> (<em>Agile AI-Driven Development</em>).
            Alih-alih menatap dokumen kosong, Anda dipandu langkah demi langkah melewati fase
            perencanaan hingga implementasi, sambil menghasilkan artefak yang dibutuhkan BMAD.
          </p>
          <p className="mb-3">
            Aplikasi ini <strong>ditenagai oleh OpenCode server lokal Anda</strong>. Semua panduan
            agen dan build dijalankan lewat sesi chat OpenCode — model dan API key provider diatur
            langsung di halaman <Link className="text-primary underline" href="/settings">Pengaturan</Link>.
            Setiap project terhubung ke satu <strong>folder</strong> (sama dengan project di OpenCode)
            dan memakai satu sesi chat untuk panduan maupun build.
          </p>
          <Card className="bg-muted/50">
            <CardContent className="pt-6 text-sm">
              <p className="mb-2 font-semibold">Alur kerja inti</p>
              <div className="flex flex-wrap items-center gap-2">
                {PHASES.filter((p) => p.id !== "anytime").map((phase, i) => (
                  <span key={phase.id} className="flex items-center gap-2">
                    <Badge variant="outline">{phase.icon} {phase.name}</Badge>
                    {i < 2 && <span className="text-muted-foreground">→</span>}
                  </span>
                ))}
              </div>
              <p className="text-muted-foreground mt-2">
                Plus fase <strong>Anytime</strong> — alat bantu yang tersedia kapan saja.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* 2. Membuat Proyek */}
      <section className="mb-12">
        <SectionTitle id="memulai" icon={<FolderPlus className="size-5" />}>
          Membuat Proyek Pertama
        </SectionTitle>
        <div className="text-sm leading-relaxed">
          <p className="mb-3">
            Mulailah dari <Link className="text-primary underline" href="/projects">Projects</Link>.
            Klik tombol <strong>New project</strong>, lalu isi:
          </p>
          <ul className="mb-4 space-y-1.5">
            <StepListItem><span>•</span><span><strong>Nama proyek</strong> — nama singkat untuk pekerjaan Anda (wajib).</span></StepListItem>
            <StepListItem><span>•</span><span><strong>Deskripsi</strong> — satu baris tentang apa yang dibangun (opsional).</span></StepListItem>
            <StepListItem><span>•</span><span><strong>Skala</strong> — seberapa besar proses perencanaan yang Anda butuhkan (lihat di bawah).</span></StepListItem>
            <StepListItem><span>•</span><span><strong>Working directory</strong> — folder di mana project ini berada (wajib). Pilih dari daftar project OpenCode, atau tempel path absolut. Semua chat &amp; build dijalankan di folder ini.</span></StepListItem>
          </ul>
          <p className="mb-3">Setelah dibuat, Anda langsung dibawa ke workspace proyek tersebut.</p>
          <p className="mb-2 font-semibold">Memilih skala proyek</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {(["express", "light", "full"] as ProjectScale[]).map((key) => (
              <Card key={key}>
                <CardHeader>
                  <CardTitle className="text-base">{SCALE_INFO[key].label}</CardTitle>
                  <CardDescription>{SCALE_INFO[key].hint}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
          <p className="text-muted-foreground mt-3">
            Skala menentukan langkah mana yang relevan bagi Anda (mis. <strong>Express</strong>{" "}
            menyederhanakan perencanaan dan langsung ke Build). Anda dapat membuat proyek dengan
            skala berbeda kapan saja.
          </p>
        </div>
      </section>

      {/* 3. Workspace */}
      <section className="mb-12">
        <SectionTitle id="workspace" icon={<LayoutDashboard className="size-5" />}>
          Bekerja di Workspace
        </SectionTitle>
        <div className="text-sm leading-relaxed">
          <p className="mb-3">
            Workspace (halaman <code>/projects/[id]</code>) adalah tempat utama Anda bekerja.
            Layarannya terbagi menjadi tiga kolom:
          </p>
          <ul className="mb-4 space-y-2">
            <StepListItem><span className="mt-0.5">🧭</span><span><strong>Kiri — Roadmap BMAD:</strong> daftar semua langkah yang dikelompokkan per fase. Klik langkah mana pun untuk membukanya. Ikon di samping nama menunjukkan status: lingkaran kosong (belum mulai), lingkaran putus-putus (draft), atau centang hijau (selesai). Ikon gembok menandai langkah wajib (<em>required</em>).</span></StepListItem>
            <StepListItem><span className="mt-0.5">✍️</span><span><strong>Tengah — Editor Langkah:</strong> tempat Anda mengerjakan artefak langkah yang dipilih (lihat bagian berikutnya).</span></StepListItem>
            <StepListItem><span className="mt-0.5">🤖</span><span><strong>Kanan — Agen BMAD:</strong> agen yang memandu langkah ini, lengkap dengan tombol untuk meminta panduan (lihat bagian Agen).</span></StepListItem>
          </ul>
          <p>
            Di bagian atas, proyek menampilkan <strong>progres keseluruhan</strong> (persentase dan
            langkah selesai). Semua perubahan tersimpan otomatis di browser Anda.
          </p>
        </div>
      </section>


      {/* 4. Wizard & Editor */}
      <section className="mb-12">
        <SectionTitle id="wizard-editor" icon={<Wand2 className="size-5" />}>
          Wizard &amp; Editor
        </SectionTitle>
        <div className="text-sm leading-relaxed">
          <p className="mb-3">
            Setiap langkah punya dua tab untuk menghasilkan artefaknya:
          </p>
          <Tabs defaultValue="wizard" className="mb-4">
            <TabsList>
              <TabsTrigger value="wizard"><Wand2 className="size-4" /> Guided Wizard</TabsTrigger>
              <TabsTrigger value="editor"><PenLine className="size-4" /> Editor</TabsTrigger>
            </TabsList>
            <TabsContent value="wizard" className="pt-2">
              <p>
                Jawab beberapa pertanyaan terpandu, lalu klik <strong>Generate</strong>. Aplikasi
                menyusun draf pertama dari template BMAD berdasarkan jawaban Anda. Anda bisa melihat{" "}
                <em>Preview</em> sebelum hasilnya masuk ke editor.
              </p>
            </TabsContent>
            <TabsContent value="editor" className="pt-2">
              <p>
                Editor Markdown bebas. Tulis atau sunting artefak langsung, lalu klik{" "}
                <strong>Save draft</strong>. Jumlah karakter ditampilkan di bawah editor.
              </p>
            </TabsContent>
          </Tabs>
          <p>
            Kedua jalur saling melengkapi: gunakan <strong>Wizard</strong> untuk memulai dengan
            cepat, lalu sempurnakan hasilnya di <strong>Editor</strong>.
          </p>
        </div>
      </section>

      {/* 5. Status & Ekspor */}
      <section className="mb-12">
        <SectionTitle id="status-export" icon={<Download className="size-5" />}>
          Status &amp; Ekspor Artefak
        </SectionTitle>
        <div className="text-sm leading-relaxed">
          <p className="mb-3">Setiap langkah memiliki salah satu dari tiga status:</p>
          <div className="mb-4 grid gap-2">
            <div className="flex items-center gap-2"><Circle className="text-muted-foreground/50 size-4" /> <strong>Not started</strong> — belum ada konten.</div>
            <div className="flex items-center gap-2"><CircleDashed className="size-4 text-amber-500" /> <strong>Draft</strong> — ada konten, masih disempurnakan.</div>
            <div className="flex items-center gap-2"><CheckCircle2 className="size-4 text-emerald-500" /> <strong>Complete</strong> — langkah dianggap selesai.</div>
          </div>
          <p className="mb-3">
            Gunakan tombol <strong>Mark complete</strong> (atau <strong>Reopen</strong> untuk
            membukanya kembali) di kanan atas editor. Menandai selesai akan memperbarui progres di
            roadmap dan halaman Projects.
          </p>
          <p>
            Untuk membawa artefak ke alat coding AI Anda (tepat seperti yang dimaksudkan BMAD),
            klik <strong>Export</strong>. File akan terunduh sesuai nama aslinya (mis.{" "}
            <code>prd.md</code> atau <code>sprint-status.yaml</code>).
          </p>
        </div>
      </section>


      {/* 6. Agen */}
      <section className="mb-12">
        <SectionTitle id="agen" icon={<Bot className="size-5" />}>
          Mengenal Agen BMAD
        </SectionTitle>
        <div className="text-sm leading-relaxed">
          <p className="mb-4">
            Panel di kanan menampilkan <strong>agen pemandu</strong> untuk langkah yang sedang Anda
            kerjakan. Klik <strong>Ask [nama agen] to guide this step</strong> untuk meminta
            panduan yang mencakup tujuan langkah, pertanyaan terpandu, dan konteks dari artefak
            sebelumnya. Anda juga bisa mengganti agen aktif dengan menekan salah satu nama agen.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {AGENT_LIST.map((agent) => (
              <Card key={agent.id}>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="bg-muted flex size-11 items-center justify-center rounded-full text-2xl">
                      {agent.icon}
                    </div>
                    <div>
                      <CardTitle className="text-base">{agent.name}</CardTitle>
                      <Badge variant="secondary" className="text-[10px]">{agent.title}</Badge>
                    </div>
                  </div>
                  <CardDescription className="pt-1">{agent.essence}</CardDescription>
                  <p className="text-muted-foreground pt-1 text-xs italic">
                    Memandu langkah: {agent.ownsSteps.map((s) => stepById(s)?.name ?? s).join(", ")}.
                  </p>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* 7. Pengaturan OpenCode */}
      <section className="mb-12">
        <SectionTitle id="ai" icon={<KeyRound className="size-5" />}>
          Pengaturan OpenCode
        </SectionTitle>
        <div className="text-sm leading-relaxed">
          <p className="mb-3">
            Semua AI di aplikasi ini lewat <strong>OpenCode server lokal Anda</strong>. Di halaman{" "}
            <Link className="text-primary underline" href="/settings">Pengaturan</Link> Anda bisa:
          </p>
          <ul className="mb-4 space-y-1.5">
            <StepListItem><span>•</span><span><strong>Status server</strong> — cek apakah <code>opencode serve</code> sudah jalan. Jika belum, aplikasi mencoba menjalankannya saat pertama dipakai.</span></StepListItem>
            <StepListItem><span>•</span><span><strong>Provider &amp; API key</strong> — daftar provider dari server OpenCode. Masukkan API key provider dan disimpan langsung oleh OpenCode di server (bukan di browser). Provider yang tersambung akan menampilkan modelnya.</span></StepListItem>
            <StepListItem><span>•</span><span><strong>Model default</strong> — model yang dipakai untuk panduan &amp; build, diambil dari daftar model server lokal.</span></StepListItem>
            <StepListItem><span>•</span><span><strong>Agent</strong> — agent untuk panduan (guidance) dan untuk build.</span></StepListItem>
          </ul>
          <Card className="bg-muted/50">
            <CardContent className="pt-6 text-sm">
              <p className="mb-1 font-semibold">Catatan privasi</p>
              <p>
                API key provider <strong>tidak disimpan di browser</strong> — disimpan oleh OpenCode
                di server lokal (folder config OpenCode Anda). Aplikasi ini hanya mengirim perintah ke{" "}
                <code>opencode serve</code>.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>


      {/* 8. Rencana & Eksekusi */}
      <section className="mb-12">
        <SectionTitle id="autopilot" icon={<Rocket className="size-5" />}>
          Rencana &amp; Eksekusi (OpenCode)
        </SectionTitle>
        <div className="text-sm leading-relaxed">
          <p className="mb-3">
            <strong>Rencana &amp; Eksekusi</strong> membagi pekerjaan jadi dua fase terkendali.
            Di tab <strong>Rencana</strong>, kerjakan langkah-langkah BMAD (mulai dari
            <strong> Brainstorming</strong> atau artefak awal lain), lalu klik
            <strong> Elaborasi semua fase</strong> — agen OpenCode menyusun draft artefak BMAD untuk
            setiap langkah, <em>berjenjang dari artefak yang sudah ada</em>. Anda review dan sunting
            artefaknya sesuai kebutuhan. Di tab <strong>Eksekusi</strong>, klik{" "}
            <strong>Jalankan build</strong>. Agen OpenCode
            kemudian mengeksekusi sesuai artefak: menulis kode, menginstal dependensi, menjalankan
            build &amp; tes, dan memperbaiki diri hingga selesai.
          </p>

          <Card className="mb-4 bg-muted/50">
            <CardContent className="pt-6 text-sm">
              <p className="mb-2 font-semibold">Cara kerja</p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Artefak awal (mis. Brainstorming)</Badge>
                <span className="text-muted-foreground">→</span>
                <Badge variant="outline">Elaborasi per fase</Badge>
                <span className="text-muted-foreground">→</span>
                <Badge variant="outline">Jalankan build</Badge>
                <span className="text-muted-foreground">→</span>
                <Badge variant="outline">Verifikasi &amp; selesai</Badge>
              </div>
              <p className="text-muted-foreground mt-2">
                Panduan &amp; build memakai <strong>satu sesi chat OpenCode yang sama</strong> di
                folder working directory proyek Anda.
              </p>
            </CardContent>
          </Card>

          <p className="mb-2 font-semibold">Prasyarat</p>
          <ul className="mb-4 space-y-1.5">
            <StepListItem><span>•</span><span><strong>OpenCode server lokal</strong> berjalan (lihat Pengaturan).</span></StepListItem>
            <StepListItem><span>•</span><span><strong>Provider &amp; model</strong> tersambung di Pengaturan (set API key provider &amp; pilih model).</span></StepListItem>
            <StepListItem><span>•</span><span><strong>Working directory</strong> proyek ter-set dan sesuai folder di OpenCode.</span></StepListItem>
          </ul>

          <p className="mb-2 font-semibold">Langkah menggunakan</p>
          <ol className="mb-4 space-y-1.5">
            <StepListItem><span>1.</span><span>Buka sebuah proyek → tab <strong>Rencana</strong>. Isi artefak awal (mis. langkah <strong>Brainstorming</strong>), atau cukup punya deskripsi proyek sebagai titik mulai.</span></StepListItem>
            <StepListItem><span>2.</span><span>Klik <strong>Elaborasi semua fase</strong>. Draft artefak muncul per langkah — setiap langkah disusun dari artefak sebelumnya; sunting manual atau minta agen menulis ulang per langkah bila perlu.</span></StepListItem>
            <StepListItem><span>3.</span><span>Buka tab <strong>Eksekusi</strong>, klik <strong>Jalankan build</strong>. Pantau <strong>Activity</strong> — log aktivitas agent (tool, edit file, output) real-time.</span></StepListItem>
            <StepListItem><span>4.</span><span>Tekan <strong>Stop build</strong> kapan saja.</span></StepListItem>
          </ol>

          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardContent className="pt-6 text-sm">
              <p className="mb-1 font-semibold">Keamanan &amp; biaya</p>
              <p>
                Build dijalankan <strong>langsung di folder working directory Anda</strong> oleh
                agent OpenCode dengan tools-nya (menulis file, menjalankan shell). Karena kode
                berjalan <strong>di server lokal</strong>, gunakan hanya untuk proyek lokal/pribadi.
                Agen build otomatis menyetujui izin (permission) yang muncul agar berjalan penuh.
                Biaya mengikuti penyedia model masing-masing.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>


      {/* 9. Tips & FAQ */}
      <section className="mb-12">
        <SectionTitle id="faq" icon={<Lightbulb className="size-5" />}>
          Tips &amp; FAQ
        </SectionTitle>
        <div className="space-y-4 text-sm leading-relaxed">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><HelpCircle className="size-4" /> Di mana data saya disimpan?</CardTitle>
              <CardDescription>
                Semua proyek dan artefak disimpan secara lokal di browser Anda (localStorage).
                Membersihkan data browser akan menghapusnya — gunakan <strong>Export</strong> untuk
                menyimpan salinan artefak penting.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><HelpCircle className="size-4" /> Apa itu fase &quot;Anytime&quot;?</CardTitle>
              <CardDescription>
                Fase <strong>Anytime</strong> berisi alat bantu (Party Mode, Advanced Elicitation,
                Review, Correct Course) yang bisa Anda gunakan kapan saja, terlepas dari status
                workflow proyek.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><HelpCircle className="size-4" /> Bagaimana alur terbaik untuk proyek kecil?</CardTitle>
              <CardDescription>
                Untuk perubahan kecil, pilih skala <strong>Express</strong>: luncurkan langsung ke
                langkah <strong>Build</strong> dengan perencanaan minimal. Untuk fitur standar,
                <strong> Light</strong> memandu Anda melalui PRD → Arsitektur → Epics.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>

      <div className="bg-muted/50 rounded-lg border p-6 text-center">
        <p className="mb-3 text-sm">Siap untuk memulai?</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link href="/projects"><Button>Buka Projects <Check className="size-4" /></Button></Link>
          <Link href="/dashboard"><Button variant="outline">Kembali ke Dashboard</Button></Link>
        </div>
      </div>
    </main>
  );
}
