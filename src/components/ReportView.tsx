import type { MeetingReport } from "@/lib/types";

function ms(msTotal: number): string {
  const totalSec = Math.round(msTotal / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function Bilingual({ ja, en }: { ja: string; en: string }) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 sm:gap-4">
      <p className="text-zinc-900 dark:text-zinc-100">{ja}</p>
      <p className="text-zinc-500 dark:text-zinc-400">{en}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ReportView({ report }: { report: MeetingReport }) {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          {report.title.ja}
        </h1>
        <p className="text-lg text-zinc-500 dark:text-zinc-400">{report.title.en}</p>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          {report.mode} · {ms(report.durationMs)} · {report.participants.join(", ")}
        </p>
      </header>

      <Section title="Executive Summary / 要約">
        <ul className="flex flex-col gap-2">
          {report.executiveSummary.ja.map((ja, i) => (
            <li key={i} className="rounded-lg bg-zinc-100 p-3 dark:bg-zinc-900">
              <Bilingual ja={ja} en={report.executiveSummary.en[i] ?? ""} />
            </li>
          ))}
        </ul>
      </Section>

      {report.keyTopics.length > 0 && (
        <Section title="Key Topics / 主なトピック">
          <div className="flex flex-col gap-3">
            {report.keyTopics.map((topic, i) => (
              <div key={i} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    {topic.title.ja} <span className="text-zinc-500 dark:text-zinc-400">/ {topic.title.en}</span>
                  </span>
                  <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                    {ms(topic.startMs)}–{ms(topic.endMs)}
                  </span>
                </div>
                <Bilingual ja={topic.summary.ja} en={topic.summary.en} />
                <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                  {topic.speakers.join(", ")}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {report.actionItems.length > 0 && (
        <Section title="Action Items / アクションアイテム">
          <ul className="flex flex-col gap-2">
            {report.actionItems.map((item, i) => (
              <li key={i} className="rounded-lg bg-zinc-100 p-3 dark:bg-zinc-900">
                <Bilingual ja={item.description.ja} en={item.description.en} />
                {(item.owner || item.dueHint) && (
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
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
              <li key={i} className="rounded-lg bg-zinc-100 p-3 dark:bg-zinc-900">
                <Bilingual ja={rec.ja} en={rec.en} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {report.glossary.length > 0 && (
        <Section title="Glossary / 用語集">
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-100 text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="px-3 py-2">Term</th>
                  <th className="px-3 py-2">Reading</th>
                  <th className="px-3 py-2">Translation</th>
                  <th className="px-3 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {report.glossary.map((g, i) => (
                  <tr key={i} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">{g.term}</td>
                    <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">{g.reading}</td>
                    <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">{g.translation}</td>
                    <td className="px-3 py-2 text-zinc-400 dark:text-zinc-500">{g.note ?? ""}</td>
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
              <li key={i} className="rounded-lg border-l-2 border-zinc-300 pl-3 dark:border-zinc-700">
                <Bilingual ja={note.quote.ja} en={note.quote.en} />
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{note.note}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Transcript / 文字起こし">
        <div className="flex flex-col gap-2">
          {report.transcript.map((line) => (
            <div key={line.id} className="flex gap-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-950">
              <div className="w-16 shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
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
