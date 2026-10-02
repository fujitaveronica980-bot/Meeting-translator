"use client";

import { useState } from "react";
import type { MeetingReport } from "@/lib/types";
import { reportFilename } from "@/lib/reportFilename";

/**
 * The download is a PDF summary laid out for sharing (see lib/report-pdf.ts),
 * rendered server-side — Japanese text needs an embedded font.
 */
async function downloadReport(report: MeetingReport) {
  const res = await fetch("/api/report-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // The reader's time zone, so the date on the PDF is their date.
    body: JSON.stringify({ report, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
  });
  if (!res.ok) throw new Error(`The server could not create the PDF (HTTP ${res.status}).`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = reportFilename(report, "pdf");
  a.click();
  URL.revokeObjectURL(url);
}

function DownloadButton({ report }: { report: MeetingReport }) {
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        disabled={state === "working"}
        onClick={async () => {
          setState("working");
          try {
            await downloadReport(report);
            setState("idle");
          } catch (err) {
            console.error("Failed to download report:", err);
            setState("failed");
          }
        }}
        className="min-h-11 rounded-full border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-subtle disabled:cursor-wait disabled:opacity-60"
      >
        {state === "working" ? "Preparing PDF…" : "Download report (PDF)"}
      </button>
      {state === "failed" && (
        <p className="text-xs text-red-600 dark:text-red-400">Couldn&apos;t create the PDF — try again.</p>
      )}
    </div>
  );
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
  forYou: { color: "#e11d48", icon: "check" },
  decisions: { color: "#0f766e", icon: "list" },
  details: { color: "#0369a1", icon: "book" },
  lines: { color: "#9333ea", icon: "quote" },
  followUp: { color: "#0891b2", icon: "reply" },
  people: { color: "#475569", icon: "bubble" },
  carried: { color: "#b45309", icon: "check" },
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

const DETAIL_LABELS = {
  number: "Number / 数値",
  date: "Date / 日付",
  person: "Person / 人物",
  tool: "Tool / ツール",
  rule: "Rule / ルール",
} as const;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch (err) {
          console.error("Failed to copy:", err);
        }
      }}
      className="min-h-9 self-start rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-subtle"
    >
      {copied ? "Copied" : "Copy Japanese message"}
    </button>
  );
}

function BilingualList({ items, section }: { items: { ja: string; en: string }[]; section: SectionKey }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item, i) => (
        <li
          key={i}
          className="rounded-lg p-3"
          style={{ backgroundColor: `${SECTION_STYLES[section].color}14` }}
        >
          <Bilingual ja={item.ja} en={item.en} />
        </li>
      ))}
    </ul>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{children}</h3>;
}

export function ReportView({ report }: { report: MeetingReport }) {
  // Absent on older reports, casual clips, and when that analysis call failed.
  const insights = report.insights;
  const forYou = insights?.forYou;
  const hasForYou =
    forYou && (forYou.asked.length > 0 || forYou.committed.length > 0 || forYou.questions.length > 0);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold text-foreground">{report.title.ja}</h1>
            <p className="text-lg text-muted">{report.title.en}</p>
          </div>
          <DownloadButton report={report} />
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

      {forYou && hasForYou && (
        <Section title="For You / あなた向け" section="forYou">
          <p className="text-xs text-muted">
            {forYou.speaker && <span className="font-medium text-foreground">{forYou.speaker} · </span>}
            {forYou.basis.ja} / {forYou.basis.en}
          </p>
          {forYou.asked.length > 0 && (
            <>
              <SubHeading>Asked of you / 依頼・期待されたこと</SubHeading>
              <BilingualList items={forYou.asked} section="forYou" />
            </>
          )}
          {forYou.committed.length > 0 && (
            <>
              <SubHeading>You committed to / 自分が約束したこと</SubHeading>
              <BilingualList items={forYou.committed} section="forYou" />
            </>
          )}
          {forYou.questions.length > 0 && (
            <>
              <SubHeading>Questions put to you / 受けた質問</SubHeading>
              <ul className="flex flex-col gap-2">
                {forYou.questions.map((q, i) => (
                  <li
                    key={i}
                    className="rounded-lg p-3"
                    style={{ backgroundColor: `${SECTION_STYLES.forYou.color}14` }}
                  >
                    <Bilingual ja={q.question.ja} en={q.question.en} />
                    <div className="mt-2 border-t border-border/60 pt-2">
                      <Bilingual ja={q.answer.ja} en={q.answer.en} />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      )}

      {insights && forYou && !hasForYou && (
        <p className="rounded-lg border border-border bg-surface p-3 text-xs text-muted">
          {forYou.speaker
            ? "Nothing in this recording was asked of you or promised by you."
            : "No “For you” section: fill in “Who are you in this meeting?” before uploading and the report will pick out what was asked of you."}
        </p>
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

      {insights && (insights.decisions.length > 0 || insights.openQuestions.length > 0) && (
        <Section title="Decisions & Open Questions / 決定事項と未解決事項" section="decisions">
          {insights.decisions.length > 0 && (
            <>
              <SubHeading>Decided / 決定事項</SubHeading>
              <BilingualList items={insights.decisions} section="decisions" />
            </>
          )}
          {insights.openQuestions.length > 0 && (
            <>
              <SubHeading>Still open / 未解決</SubHeading>
              <ul className="flex flex-col gap-2">
                {insights.openQuestions.map((q, i) => (
                  <li
                    key={i}
                    className="rounded-lg border-l-4 p-3"
                    style={{
                      borderColor: SECTION_STYLES.decisions.color,
                      backgroundColor: `${SECTION_STYLES.decisions.color}0d`,
                    }}
                  >
                    <Bilingual ja={q.question.ja} en={q.question.en} />
                    {q.owner && <p className="mt-1 text-xs text-muted">Answer owed by {q.owner}</p>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      )}

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

      {insights && (insights.details.length > 0 || insights.procedures.length > 0) && (
        <Section title="Details Sheet / 詳細メモ" section="details">
          {insights.details.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <tbody>
                  {insights.details.map((d, i) => (
                    <tr key={i} className={i > 0 ? "border-t border-border" : undefined}>
                      <td className="whitespace-nowrap px-3 py-2 align-top text-xs text-muted">
                        {DETAIL_LABELS[d.category] ?? d.category}
                      </td>
                      <td className="px-3 py-2">
                        <Bilingual ja={d.detail.ja} en={d.detail.en} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {insights.procedures.map((p, i) => (
            <div
              key={i}
              className="rounded-lg border-l-4 bg-surface p-3 shadow-sm"
              style={{ borderColor: SECTION_STYLES.details.color }}
            >
              <p className="mb-2 font-medium text-foreground">
                {p.title.ja} <span className="text-muted">/ {p.title.en}</span>
              </p>
              <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
                {p.steps.ja.map((step, j) => (
                  <li key={j}>
                    <Bilingual ja={step} en={p.steps.en[j] ?? ""} />
                  </li>
                ))}
              </ol>
            </div>
          ))}
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

      {insights && insights.betweenTheLines.length > 0 && (
        <Section title="Between the Lines / 行間を読む" section="lines">
          <p className="text-xs text-muted">
            Interpretation, not fact — what was probably meant beyond the literal words.
          </p>
          <ul className="flex flex-col gap-2">
            {insights.betweenTheLines.map((b, i) => (
              <li
                key={i}
                className="rounded-lg border-l-4 p-3"
                style={{
                  borderColor: SECTION_STYLES.lines.color,
                  backgroundColor: `${SECTION_STYLES.lines.color}0d`,
                }}
              >
                {b.quote && <p className="mb-1 text-sm text-muted">「{b.quote}」</p>}
                <Bilingual ja={b.point.ja} en={b.point.en} />
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

      {insights && (insights.followUp.message.japanese || insights.followUp.questions.length > 0) && (
        <Section title="Follow-up Kit / フォローアップ" section="followUp">
          {insights.followUp.message.japanese && (
            <div
              className="flex flex-col gap-2 rounded-lg p-3"
              style={{ backgroundColor: `${SECTION_STYLES.followUp.color}14` }}
            >
              <SubHeading>Recap message to send / 送付用のお礼・確認メッセージ</SubHeading>
              <p className="whitespace-pre-wrap text-foreground">{insights.followUp.message.japanese}</p>
              <p className="whitespace-pre-wrap text-sm text-muted">{insights.followUp.message.english}</p>
              <CopyButton text={insights.followUp.message.japanese} />
            </div>
          )}
          {insights.followUp.questions.length > 0 && (
            <>
              <SubHeading>Questions to ask next time / 次回の質問</SubHeading>
              <ul className="flex flex-col gap-2">
                {insights.followUp.questions.map((q, i) => (
                  <li
                    key={i}
                    className="rounded-lg p-3"
                    style={{ backgroundColor: `${SECTION_STYLES.followUp.color}14` }}
                  >
                    <p className="font-medium text-foreground">{q.japanese}</p>
                    <p className="text-sm italic text-muted">{q.romaji}</p>
                    <p className="text-sm text-muted">{q.english}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      )}

      {insights && insights.carriedOver.length > 0 && (
        <Section title="Since Earlier Meetings / 前回からの進捗" section="carried">
          <ul className="flex flex-col gap-2">
            {insights.carriedOver.map((c, i) => (
              <li
                key={i}
                className="rounded-lg p-3"
                style={{ backgroundColor: `${SECTION_STYLES.carried.color}14` }}
              >
                <Bilingual ja={c.item.ja} en={c.item.en} />
                <div className="mt-2 border-t border-border/60 pt-2">
                  <Bilingual ja={c.status.ja} en={c.status.en} />
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {insights && insights.people.length > 0 && (
        <Section title="People / 参加者" section="people">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <tbody>
                {insights.people.map((p, i) => (
                  <tr key={i} className={i > 0 ? "border-t border-border" : undefined}>
                    <td className="whitespace-nowrap px-3 py-2 align-top font-medium text-foreground">
                      {p.name ? `${p.name} (${p.speaker})` : p.speaker}
                    </td>
                    <td className="px-3 py-2">
                      <Bilingual ja={p.role.ja} en={p.role.en} />
                      <div className="mt-1 text-muted">
                        <Bilingual ja={p.caresAbout.ja} en={p.caresAbout.en} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

      {/* Only present when analysis failed — a normal report has no transcript. */}
      {report.rawTranscript && report.rawTranscript.length > 0 && (
        <Section title="Raw Transcript / 文字起こし" section="transcript">
          <div className="flex flex-col gap-2">
            {report.rawTranscript.map((line, i) => (
              <div
                key={i}
                className="flex gap-3 rounded-lg p-3"
                style={{ backgroundColor: `${SECTION_STYLES.transcript.color}10` }}
              >
                <div className="w-16 shrink-0 text-xs text-muted/70">
                  <div className="font-medium">{line.speaker}</div>
                  <div>{ms(line.startMs)}</div>
                </div>
                <p className="text-foreground">{line.japanese}</p>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
