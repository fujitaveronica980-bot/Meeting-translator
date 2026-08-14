import type { MeetingReport } from "@/lib/types";

function ms(msTotal: number): string {
  const totalSec = Math.round(msTotal / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Renders a MeetingReport as a single self-contained Markdown document. */
export function reportToMarkdown(report: MeetingReport): string {
  const lines: string[] = [];

  lines.push(`# ${report.title.ja}`, `## ${report.title.en}`, "");
  lines.push(
    `_${report.mode} · ${ms(report.durationMs)} · ${report.participants.join(", ")} · ${new Date(report.recordedAt).toLocaleString()}_`,
    ""
  );

  if (report.mode === "casual" && report.suggestedReplies && report.suggestedReplies.length > 0) {
    lines.push("## Suggested Replies / 返信の候補", "");
    for (const group of report.suggestedReplies) {
      lines.push(`**${group.context.ja} / ${group.context.en}**`, "");
      for (const opt of group.options) {
        const nuance = opt.nuance ? ` _(${opt.nuance})_` : "";
        lines.push(`- ${opt.japanese} — _${opt.romaji}_ — ${opt.english}${nuance}`);
      }
      lines.push("");
    }
  }

  lines.push("## Executive Summary / 要約", "");
  report.executiveSummary.ja.forEach((ja, i) => {
    lines.push(`- ${ja}`, `  - ${report.executiveSummary.en[i] ?? ""}`);
  });
  lines.push("");

  if (report.keyTopics.length > 0) {
    lines.push("## Key Topics / 主なトピック", "");
    for (const topic of report.keyTopics) {
      lines.push(
        `### ${topic.title.ja} / ${topic.title.en} (${ms(topic.startMs)}–${ms(topic.endMs)})`,
        "",
        topic.summary.ja,
        "",
        topic.summary.en,
        "",
        `_Speakers: ${topic.speakers.join(", ")}_`,
        ""
      );
    }
  }

  if (report.actionItems.length > 0) {
    lines.push("## Action Items / アクションアイテム", "");
    for (const item of report.actionItems) {
      const meta = [item.owner, item.dueHint].filter(Boolean).join(" · ");
      lines.push(`- [ ] ${item.description.ja} / ${item.description.en}${meta ? ` (${meta})` : ""}`);
    }
    lines.push("");
  }

  if (report.recommendations.length > 0) {
    lines.push("## Recommendations / 提案", "");
    for (const rec of report.recommendations) {
      lines.push(`- ${rec.ja} / ${rec.en}`);
    }
    lines.push("");
  }

  if (report.glossary.length > 0) {
    lines.push("## Glossary / 用語集", "");
    lines.push("| Term | Reading | Translation | Note |", "|---|---|---|---|");
    for (const g of report.glossary) {
      lines.push(`| ${g.term} | ${g.reading} | ${g.translation} | ${g.note ?? ""} |`);
    }
    lines.push("");
  }

  if (report.culturalNotes.length > 0) {
    lines.push("## Cultural Notes / 文化的な補足", "");
    for (const note of report.culturalNotes) {
      lines.push(`> ${note.quote.ja} / ${note.quote.en}`, "", note.note, "");
    }
  }

  lines.push("## Transcript / 文字起こし", "");
  for (const line of report.transcript) {
    lines.push(`**${line.speaker}** [${ms(line.startMs)}] ${line.japanese}`, "", line.english, "");
  }

  return lines.join("\n");
}

/** Slugifies a report title for use as a filename. */
export function reportFilename(report: MeetingReport, ext: string): string {
  const date = new Date(report.recordedAt).toISOString().slice(0, 10);
  const slug =
    (report.title.en || report.title.ja)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "meeting-report";
  return `${date}-${slug}.${ext}`;
}
