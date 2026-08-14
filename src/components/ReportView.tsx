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

/**
 * Each report section gets its own color, echoing the hues already used in
 * the page's hero gradient — gives the report a visual index you can scan
 * instead of every section looking identical.
 */
const SECTION_STYLES = {
  replies: { color: "#0891b2", icon: "reply" },
  summary: { color: "#d97706", icon: "list" },
  topics: { color: "#2563eb", icon: "bubble" },
  actions: { color: "#7c3aed", icon: "check" },
  recommendations: { color: "#059669", icon: "bulb" },
  glossary: { color: "#4f46e5", icon: "book" },
  cultural: { color: "#db2777", icon: "quote" },
  transcript: { color: "#475569", icon: "mic" },
} as const satisfies Record<string, { color: string; icon: keyof typeof ICONS }>;

type SectionKey = keyof typeof SECTION_STYLES;

const ICONS = {
  list: (
    <>
      <circle cx="4" cy="6" r="1.3" />
      <rect x="8" y="5.2" width="12" height="1.6" rx="0.8" />
      <circle cx="4" cy="12" r="1.3" />
      <rect x="8" y="11.2" width="12" height="1.6" rx="0.8" />
      <circle cx="4" cy="18" r="1.3" />
      <rect x="8" y="17.2" width="9" height="1.6" rx="0.8" />
    </>
  ),
  bubble: <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7A2.5 2.5 0 0 1 17.5 15H9l-4 4v-4H6.5A2.5 2.5 0 0 1 4 12.5v-7Z" />,
  check: (
    <>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 12.5l2.5 2.5L16 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  bulb: (
    <>
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.5.4.8 1 .8 1.6v.5a1 1 0 0 0 1 1h3.4a1 1 0 0 0 1-1v-.5c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3Z" />
      <rect x="9.5" y="18.5" width="5" height="1.6" rx="0.8" />
      <rect x="10" y="20.5" width="4" height="1.4" rx="0.7" />
    </>
  ),
  book: (
    <>
      <path d="M3 5.5c2-.8 4.7-.8 7 .5v12c-2.3-1.3-5-1.3-7-.5v-12Z" />
      <path d="M21 5.5c-2-.8-4.7-.8-7 .5v12c2.3-1.3 5-1.3 7-.5v-12Z" />
    </>
  ),
  quote: (
    <>
      <path d="M7 8.5c-1.7 0-3 1.3-3 3v.5c0 1.9 1.4 3.4 3.2 3.5-.2 1.2-1 2.1-2.2 2.5v1.8c2.6-.5 4.5-2.6 4.5-5.5v-2.8c0-1.7-1.1-3-2.5-3Z" />
      <path d="M16.5 8.5c-1.7 0-3 1.3-3 3v.5c0 1.9 1.4 3.4 3.2 3.5-.2 1.2-1 2.1-2.2 2.5v1.8c2.6-.5 4.5-2.6 4.5-5.5v-2.8c0-1.7-1.1-3-2.5-3Z" />
    </>
  ),
  mic: (
    <>
      <rect x="9.5" y="3" width="5" height="10" rx="2.5" />
      <path d="M6.5 11a5.5 5.5 0 0 0 11 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="12" y1="16.5" x2="12" y2="20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="9" y1="20" x2="15" y2="20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  reply: (
    <>
      <path d="M10 5 4 11l6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 11h9a5 5 0 0 1 5 5v2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
} as const;

function Section({
  title,
  section,
  children,
}: {
  title: string;
  section: SectionKey;
  children: React.ReactNode;
}) {
  const { color, icon } = SECTION_STYLES[section];
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: `${color}22`, color }}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
            {ICONS[icon]}
          </svg>
        </span>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">{title}</h2>
      </div>
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

      {report.mode === "casual" && report.suggestedReplies && report.suggestedReplies.length > 0 && (
        <Section title="Suggested Replies / 返信の候補" section="replies">
          <div className="flex flex-col gap-4">
            {report.suggestedReplies.map((group, i) => (
              <div
                key={i}
                className="rounded-lg border-l-4 bg-surface p-3 shadow-sm"
                style={{ borderColor: SECTION_STYLES.replies.color }}
              >
                <p className="mb-2 text-xs text-muted">
                  <span className="font-medium text-foreground">{group.context.ja}</span>
                  {" / "}
                  {group.context.en}
                </p>
                <div className="flex flex-col gap-2">
                  {group.options.map((opt, j) => (
                    <div
                      key={j}
                      className="rounded-lg p-3"
                      style={{ backgroundColor: `${SECTION_STYLES.replies.color}14` }}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="text-base font-medium text-foreground">{opt.japanese}</span>
                        {opt.nuance && (
                          <span
                            className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
                            style={{
                              backgroundColor: `${SECTION_STYLES.replies.color}22`,
                              color: SECTION_STYLES.replies.color,
                            }}
                          >
                            {opt.nuance}
                          </span>
                        )}
                      </div>
                      <p className="text-sm italic text-muted">{opt.romaji}</p>
                      <p className="text-sm text-muted">{opt.english}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Executive Summary / 要約" section="summary">
        <ul className="flex flex-col gap-2">
          {report.executiveSummary.ja.map((ja, i) => (
            <li
              key={i}
              className="rounded-lg p-3"
              style={{ backgroundColor: `${SECTION_STYLES.summary.color}14` }}
            >
              <Bilingual ja={ja} en={report.executiveSummary.en[i] ?? ""} />
            </li>
          ))}
        </ul>
      </Section>

      {report.keyTopics.length > 0 && (
        <Section title="Key Topics / 主なトピック" section="topics">
          <div className="flex flex-col gap-3">
            {report.keyTopics.map((topic, i) => (
              <div
                key={i}
                className="rounded-lg border-l-4 bg-surface p-3 shadow-sm"
                style={{ borderColor: SECTION_STYLES.topics.color }}
              >
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
        <Section title="Action Items / アクションアイテム" section="actions">
          <ul className="flex flex-col gap-2">
            {report.actionItems.map((item, i) => (
              <li
                key={i}
                className="rounded-lg p-3"
                style={{ backgroundColor: `${SECTION_STYLES.actions.color}14` }}
              >
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
        <Section title="Recommendations / 提案" section="recommendations">
          <ul className="flex flex-col gap-2">
            {report.recommendations.map((rec, i) => (
              <li
                key={i}
                className="rounded-lg p-3"
                style={{ backgroundColor: `${SECTION_STYLES.recommendations.color}14` }}
              >
                <Bilingual ja={rec.ja} en={rec.en} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {report.glossary.length > 0 && (
        <Section title="Glossary / 用語集" section="glossary">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead
                className="text-xs uppercase text-muted"
                style={{ backgroundColor: `${SECTION_STYLES.glossary.color}14` }}
              >
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
        <Section title="Cultural Notes / 文化的な補足" section="cultural">
          <ul className="flex flex-col gap-2">
            {report.culturalNotes.map((note, i) => (
              <li
                key={i}
                className="rounded-lg border-l-4 p-3"
                style={{
                  borderColor: SECTION_STYLES.cultural.color,
                  backgroundColor: `${SECTION_STYLES.cultural.color}0d`,
                }}
              >
                <Bilingual ja={note.quote.ja} en={note.quote.en} />
                <p className="mt-1 text-sm text-muted">{note.note}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Transcript / 文字起こし" section="transcript">
        <div className="flex flex-col gap-2">
          {report.transcript.map((line) => (
            <div
              key={line.id}
              className="flex gap-3 rounded-lg p-3"
              style={{ backgroundColor: `${SECTION_STYLES.transcript.color}10` }}
            >
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
