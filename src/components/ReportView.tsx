import type { MeetingReport } from "@/lib/types";
import { reportFilename, reportToMarkdown } from "@/lib/reportToMarkdown";

function downloadReport(report: MeetingReport) {
  const blob = new Blob([reportToMarkdown(report)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = reportFilename(report, "md");
  a.click();
  URL.revokeObjectURL(url);
}

function ms(msTotal: number): string {
  const totalSec = Math.round(msTotal / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function Bilingual({ ja, en }: { ja: string; en: string }) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 sm:gap-4">
      <p className="text-foreground">{ja}</p>
      <p className="text-muted">{en}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </section>
  );
}

export function ReportView({ report }: { report: MeetingReport }) {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold text-foreground">{report.title.ja}</h1>
            <p className="text-lg text-muted">{report.title.en}</p>
          </div>
          <button
            type="button"
            onClick={() => downloadReport(report)}
            className="shrink-0 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-subtle"
          >
            Download report
          </button>
        </div>
        <p className="mt-2 text-sm text-muted">
          {report.mode} · {ms(report.durationMs)} · {report.participants.join(", ")}
        </p>
      </header>

      <Section title="Executive Summary / 要約">
        <ul className="flex flex-col gap-2">
          {report.executiveSummary.ja.map((ja, i) => (
            <li key={i} className="rounded-lg bg-subtle p-3">
              <Bilingual ja={ja} en={report.executiveSummary.en[i] ?? ""} />
            </li>
          ))}
        </ul>
      </Section>

      {report.keyTopics.length > 0 && (
        <Section title="Key Topics / 主なトピック">
          <div className="flex flex-col gap-3">
            {report.keyTopics.map((topic, i) => (
              <div key={i} className="rounded-lg border border-border p-3">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="font-medium text-foreground">
                    {topic.title.ja} <span className="text-muted">/ {topic.title.en}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {ms(topic.startMs)}–{ms(topic.endMs)}
                  </span>
                </div>
                <Bilingual ja={topic.summary.ja} en={topic.summary.en} />
                <p className="mt-1 text-xs text-muted/70">{topic.speakers.join(", ")}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {report.actionItems.length > 0 && (
        <Section title="Action Items / アクションアイテム">
          <ul className="flex flex-col gap-2">
            {report.actionItems.map((item, i) => (
              <li key={i} className="rounded-lg bg-subtle p-3">
                <Bilingual ja={item.description.ja} en={item.description.en} />
                {(item.owner || item.dueHint) && (
                  <p className="mt-1 text-xs text-muted">
                    {[item.owner, item.dueHint].filter(Boolean).join(" · ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {report.recommendations.length > 0 && (
        <Section title="Recommendations / 提案">
          <ul className="flex flex-col gap-2">
            {report.recommendations.map((rec, i) => (
              <li key={i} className="rounded-lg bg-subtle p-3">
                <Bilingual ja={rec.ja} en={rec.en} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {report.glossary.length > 0 && (
        <Section title="Glossary / 用語集">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-subtle text-xs uppercase text-muted">
                <tr>
                  <th className="px-3 py-2">Term</th>
                  <th className="px-3 py-2">Reading</th>
                  <th className="px-3 py-2">Translation</th>
                  <th className="px-3 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {report.glossary.map((g, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-foreground">{g.term}</td>
                    <td className="px-3 py-2 text-muted">{g.reading}</td>
                    <td className="px-3 py-2 text-muted">{g.translation}</td>
                    <td className="px-3 py-2 text-muted/70">{g.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {report.culturalNotes.length > 0 && (
        <Section title="Cultural Notes / 文化的な補足">
          <ul className="flex flex-col gap-2">
            {report.culturalNotes.map((note, i) => (
              <li key={i} className="rounded-lg border-l-2 border-accent/40 pl-3">
                <Bilingual ja={note.quote.ja} en={note.quote.en} />
                <p className="mt-1 text-sm text-muted">{note.note}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Transcript / 文字起こし">
        <div className="flex flex-col gap-2">
          {report.transcript.map((line) => (
            <div key={line.id} className="flex gap-3 rounded-lg bg-subtle p-3">
              <div className="w-16 shrink-0 text-xs text-muted/70">
                <div className="font-medium">{line.speaker}</div>
                <div>{ms(line.startMs)}</div>
              </div>
              <Bilingual ja={line.japanese} en={line.english} />
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
