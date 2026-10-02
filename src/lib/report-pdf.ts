import path from "node:path";
import pdfmake from "pdfmake";
import type { Content, ContentTable, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import type { MeetingReport, SessionMode } from "@/lib/types";

/**
 * Renders a MeetingReport as the downloadable PDF summary.
 *
 * Laid out for someone who wasn't in the room: a Japanese summary first,
 * then the same summary in English (each readable on its own — overview,
 * key points, what was covered, action items, recommendations, plus the
 * insights layer when the report has one: what was asked of the reader,
 * decisions, the details sheet, reading between the lines, the follow-up
 * kit), then a shared table of key terms. Deliberately not the on-screen
 * report dumped to paper: no side-by-side JA/EN lines, no cultural notes.
 *
 * Generated server-side because Japanese text needs an embedded font, and
 * the font files are far too big to ship to a phone for every download.
 */

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
const REGULAR = path.join(FONT_DIR, "NotoSansJP-Regular.otf");
const BOLD = path.join(FONT_DIR, "NotoSansJP-Bold.otf");

// Noto Sans JP has no italic; map those slots to upright so nothing falls
// back to a font without Japanese glyphs.
pdfmake.setFonts({ NotoSansJP: { normal: REGULAR, bold: BOLD, italics: REGULAR, bolditalics: BOLD } });

// The document is built only from text, so it never needs to load anything
// beyond its own fonts — say so explicitly rather than leave it open.
const access = pdfmake as unknown as {
  setUrlAccessPolicy(allow: (url: string) => boolean): void;
  setLocalAccessPolicy(allow: (file: string) => boolean): void;
};
access.setUrlAccessPolicy(() => false);
access.setLocalAccessPolicy((file) => path.resolve(file).startsWith(FONT_DIR + path.sep));

type Lang = "ja" | "en";

const KANA_ONLY = /^[\u3040-\u30ff\s]+$/;

const INK = "#1c1b1a";
const MUTED = "#6b6862";
const RULE = "#dcd9d2";
const HEADER_FILL = "#f3f1ec";

const KIND: Record<SessionMode, Record<Lang, string>> = {
  meeting: { ja: "会議", en: "meeting" },
  seminar: { ja: "セミナー", en: "seminar" },
  casual: { ja: "会話", en: "conversation" },
};

const LABELS = {
  ja: {
    summary: "日本語サマリー",
    overview: "概要",
    keyPoints: "要点",
    topics: "議題ごとの内容",
    topicColumns: ["時間", "議題", "内容"],
    actions: "アクションアイテム",
    action: "内容",
    owner: "担当",
    due: "期限",
    recommendations: "提案",
    forYou: "あなた向け",
    asked: "依頼・期待されたこと",
    committed: "自分が約束したこと",
    questionsToYou: "受けた質問",
    questionColumns: ["質問", "回答"],
    decisions: "決定事項と未解決事項",
    decided: "決定事項",
    open: "未解決事項",
    openColumns: ["内容", "回答する人"],
    details: "詳細メモ",
    detailColumns: ["種別", "内容"],
    categories: { number: "数値", date: "日付", person: "人物", tool: "ツール", rule: "ルール" },
    lines: "行間を読む",
    linesNote: "※ 発言の文字どおりの意味ではなく、推測を含む解釈です。",
    followUp: "フォローアップ",
    message: "送付用メッセージ",
    nextQuestions: "次回の質問",
    people: "参加者",
    peopleColumns: ["話者", "役割", "重視していること"],
    carried: "前回からの進捗",
    carriedColumns: ["項目", "現状"],
  },
  en: {
    summary: "English summary",
    overview: "Overview",
    keyPoints: "Key points",
    topics: "What was covered",
    topicColumns: ["Time", "Topic", "Content"],
    actions: "Action items",
    action: "Action",
    owner: "Owner",
    due: "Due",
    recommendations: "Recommendations",
    forYou: "For you",
    asked: "Asked of you",
    committed: "You committed to",
    questionsToYou: "Questions put to you",
    questionColumns: ["Question", "Your answer"],
    decisions: "Decisions and open questions",
    decided: "Decided",
    open: "Still open",
    openColumns: ["Question", "Answer owed by"],
    details: "Details sheet",
    detailColumns: ["Type", "Detail"],
    categories: { number: "Number", date: "Date", person: "Person", tool: "Tool", rule: "Rule" },
    lines: "Reading between the lines",
    linesNote: "Interpretation, not fact: what was probably meant beyond the literal words.",
    followUp: "Follow-up kit",
    message: "Recap message to send",
    nextQuestions: "Questions to ask next time",
    people: "People",
    peopleColumns: ["Speaker", "Role", "Cares most about"],
    carried: "Since earlier meetings",
    carriedColumns: ["Item", "Where it stands"],
  },
} as const;

function clock(msTotal: number): string {
  const totalSec = Math.round(msTotal / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function durationText(ms: number, lang: Lang): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) {
    const seconds = Math.max(1, Math.round(ms / 1000));
    return lang === "ja" ? `${seconds}秒` : `${seconds} seconds`;
  }
  return lang === "ja" ? `${minutes}分` : `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

function dateText(iso: string, lang: Lang, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const format = (tz?: string) =>
    new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", {
      year: "numeric",
      month: lang === "ja" ? "long" : "short",
      day: "numeric",
      timeZone: tz,
    }).format(date);
  try {
    return format(timeZone);
  } catch {
    return format(); // unknown time zone name from the client
  }
}

const h2 = (text: string, pageBreak = false): Content => ({
  text,
  style: "h2",
  headlineLevel: 2,
  ...(pageBreak ? { pageBreak: "before" as const } : {}),
});
const h3 = (text: string): Content => ({ text, style: "h3", headlineLevel: 3 });
const h4 = (text: string): Content => ({ text, style: "h4", headlineLevel: 4 });

function table(headers: readonly string[], rows: TableCell[][], widths: (string | number)[]): ContentTable {
  return {
    table: {
      headerRows: 1,
      keepWithHeaderRows: 1,
      dontBreakRows: true,
      widths,
      // Headers never wrap: a narrow column would otherwise stack a
      // two-character Japanese header one character per line.
      body: [headers.map((text): TableCell => ({ text, style: "th", noWrap: true })), ...rows],
    },
    layout: {
      hLineWidth: () => 0.6,
      vLineWidth: () => 0.6,
      hLineColor: () => RULE,
      vLineColor: () => RULE,
      fillColor: (rowIndex: number) => (rowIndex === 0 ? HEADER_FILL : null),
      paddingLeft: () => 7,
      paddingRight: () => 7,
      paddingTop: () => 5,
      paddingBottom: () => 5,
    },
    margin: [0, 2, 0, 4],
  };
}

/** Older reports carry one deadline string for both languages, often "日本語 / English". */
function dueText(item: MeetingReport["actionItems"][number], lang: Lang): string {
  if (item.due?.[lang]) return item.due[lang];
  const parts = (item.dueHint ?? "").split(" / ");
  return (lang === "ja" ? parts[0] : parts[parts.length - 1]).trim();
}

function languageSection(report: MeetingReport, lang: Lang, pageBreak: boolean): Content[] {
  const L = LABELS[lang];
  const out: Content[] = [h2(L.summary, pageBreak)];

  if (report.overview?.[lang]) {
    out.push(h3(L.overview), { text: report.overview[lang], style: "body" });
  }

  const keyPoints = report.keyPoints ?? [];
  const summaryBullets = report.executiveSummary?.[lang] ?? [];
  if (keyPoints.length > 0) {
    out.push(h3(L.keyPoints), {
      ul: keyPoints.map((p) => ({
        text: [{ text: `${p.headline[lang]} `, bold: true }, p.detail[lang]],
      })),
      style: "list",
    });
  } else if (summaryBullets.length > 0) {
    out.push(h3(L.keyPoints), { ul: [...summaryBullets], style: "list" });
  }

  const insights = report.insights;

  const forYou = insights?.forYou;
  if (forYou && (forYou.asked.length > 0 || forYou.committed.length > 0 || forYou.questions.length > 0)) {
    out.push(h3(L.forYou), {
      text: [forYou.speaker ? `${forYou.speaker} — ` : "", forYou.basis[lang]].join(""),
      style: "aside",
    });
    if (forYou.asked.length > 0) {
      out.push(h4(L.asked), { ul: forYou.asked.map((a) => a[lang]), style: "list" });
    }
    if (forYou.committed.length > 0) {
      out.push(h4(L.committed), { ul: forYou.committed.map((c) => c[lang]), style: "list" });
    }
    if (forYou.questions.length > 0) {
      out.push(
        h4(L.questionsToYou),
        table(
          L.questionColumns,
          forYou.questions.map((q) => [q.question[lang], q.answer[lang]]),
          ["*", "*"]
        )
      );
    }
  }

  if (insights && (insights.decisions.length > 0 || insights.openQuestions.length > 0)) {
    out.push(h3(L.decisions));
    if (insights.decisions.length > 0) {
      out.push(h4(L.decided), { ul: insights.decisions.map((d) => d[lang]), style: "list" });
    }
    if (insights.openQuestions.length > 0) {
      out.push(
        h4(L.open),
        table(
          L.openColumns,
          insights.openQuestions.map((q) => [q.question[lang], { text: q.owner || "—", noWrap: true }]),
          ["*", "auto"]
        )
      );
    }
  }

  const topics = report.keyTopics ?? [];
  if (topics.length > 0) {
    out.push(
      h3(L.topics),
      table(
        L.topicColumns,
        topics.map((t) => [
          { text: `${clock(t.startMs)}–${clock(t.endMs)}`, noWrap: true },
          t.title[lang],
          t.summary[lang],
        ]),
        ["auto", 150, "*"]
      )
    );
  }

  if (insights && (insights.details.length > 0 || insights.procedures.length > 0)) {
    out.push(h3(L.details));
    if (insights.details.length > 0) {
      out.push(
        table(
          L.detailColumns,
          insights.details.map((d) => [
            { text: L.categories[d.category] ?? d.category, noWrap: true },
            d.detail[lang],
          ]),
          ["auto", "*"]
        )
      );
    }
    for (const procedure of insights.procedures) {
      out.push(h4(procedure.title[lang]), { ol: [...(procedure.steps[lang] ?? [])], style: "list" });
    }
  }

  const actions = report.actionItems ?? [];
  if (actions.length > 0) {
    // Owner and deadline only when something in the recording gave one —
    // an empty column reads as missing information.
    const showOwner = actions.some((a) => a.owner);
    const showDue = actions.some((a) => dueText(a, lang));
    out.push(
      h3(L.actions),
      table(
        [L.action, ...(showOwner ? [L.owner] : []), ...(showDue ? [L.due] : [])],
        actions.map((a) => [
          a.description[lang],
          ...(showOwner ? [{ text: a.owner ?? "", noWrap: true }] : []),
          ...(showDue ? [dueText(a, lang)] : []),
        ]),
        ["*", ...(showOwner ? ["auto"] : []), ...(showDue ? [120] : [])]
      )
    );
  }

  if (insights && insights.betweenTheLines.length > 0) {
    out.push(h3(L.lines), { text: L.linesNote, style: "aside" }, {
      ul: insights.betweenTheLines.map((b) => ({
        text: [b.point[lang], ...(b.quote ? [{ text: `  「${b.quote}」`, color: MUTED }] : [])],
      })),
      style: "list",
    });
  }

  const recommendations = report.recommendations ?? [];
  if (recommendations.length > 0) {
    out.push(h3(L.recommendations), { ul: recommendations.map((r) => r[lang]), style: "list" });
  }

  const followUp = insights?.followUp;
  if (followUp && (followUp.message.japanese || followUp.questions.length > 0)) {
    out.push(h3(L.followUp));
    const message = lang === "ja" ? followUp.message.japanese : followUp.message.english;
    if (message) out.push(h4(L.message), { text: message, style: "message" });
    if (followUp.questions.length > 0) {
      out.push(
        h4(L.nextQuestions),
        // The English reader gets the Japanese and its pronunciation too:
        // the questions are there to be said out loud.
        lang === "ja"
          ? { ul: followUp.questions.map((q) => q.japanese), style: "list" }
          : table(
              ["Japanese", "Romaji", "English"],
              followUp.questions.map((q) => [q.japanese, q.romaji, q.english]),
              ["*", "*", "*"]
            )
      );
    }
  }

  if (insights && insights.carriedOver.length > 0) {
    out.push(
      h3(L.carried),
      table(
        L.carriedColumns,
        insights.carriedOver.map((c) => [c.item[lang], c.status[lang]]),
        ["*", "*"]
      )
    );
  }

  if (insights && insights.people.length > 0) {
    out.push(
      h3(L.people),
      table(
        L.peopleColumns,
        insights.people.map((p) => [
          { text: p.name ? `${p.name} (${p.speaker})` : p.speaker, noWrap: true },
          p.role[lang],
          p.caresAbout[lang],
        ]),
        ["auto", "*", "*"]
      )
    );
  }

  return out;
}

function suggestedReplies(report: MeetingReport): Content[] {
  const groups = report.mode === "casual" ? (report.suggestedReplies ?? []) : [];
  if (groups.length === 0) return [];
  return [
    h2("返信の候補 / Suggested replies"),
    ...groups.flatMap((group): Content[] => [
      { text: `${group.context.ja} / ${group.context.en}`, style: "h3", headlineLevel: 3 },
      table(
        ["日本語", "Romaji", "English"],
        group.options.map((o) => [
          o.japanese,
          o.romaji,
          o.nuance ? `${o.english} (${o.nuance})` : o.english,
        ]),
        ["*", "*", "*"]
      ),
    ]),
  ];
}

function keyTerms(report: MeetingReport): Content[] {
  const glossary = report.glossary ?? [];
  if (glossary.length === 0) return [];
  // Older reports have no Japanese definitions; drop that column for them.
  const hasJapanese = glossary.some((g) => g.meaning?.ja);
  const english = (g: (typeof glossary)[number]) =>
    g.meaning?.en || [g.translation, g.note].filter(Boolean).join(" — ");
  return [
    h2("用語 / Key terms"),
    table(
      ["用語 / Term", ...(hasJapanese ? ["日本語での意味"] : []), "Meaning in English"],
      glossary.map((g) => [
        // A reading helps for kanji or Latin terms; for a term already in
        // kana it would just repeat the term.
        g.reading && g.reading !== g.term && !KANA_ONLY.test(g.term)
          ? `${g.term}（${g.reading}）`
          : g.term,
        ...(hasJapanese ? [g.meaning?.ja ?? ""] : []),
        english(g),
      ]),
      [110, ...(hasJapanese ? ["*"] : []), "*"]
    ),
  ];
}

/** Only present when analysis failed — a normal report has no transcript. */
function rawTranscript(report: MeetingReport): Content[] {
  const lines = report.rawTranscript ?? [];
  if (lines.length === 0) return [];
  return [
    h2("文字起こし / Raw transcript"),
    ...lines.map(
      (line): Content => ({
        text: [{ text: `${line.speaker}  ${clock(line.startMs)}  `, color: MUTED }, line.japanese],
        style: "body",
      })
    ),
  ];
}

export function buildReportDocument(report: MeetingReport, timeZone?: string): TDocumentDefinitions {
  const kind = KIND[report.mode] ?? KIND.meeting;
  const people = report.participants?.length ?? 0;
  const facts = {
    ja: [durationText(report.durationMs, "ja"), ...(people ? [`参加者${people}名`] : [])].join("・"),
    en: [
      durationText(report.durationMs, "en"),
      ...(people ? [`${people} ${people === 1 ? "participant" : "participants"}`] : []),
    ].join(", "),
  };
  const kindTitle = kind.en.charAt(0).toUpperCase() + kind.en.slice(1);

  return {
    pageSize: "A4",
    pageMargins: [50, 54, 50, 56],
    info: { title: report.title.en || report.title.ja },
    defaultStyle: { font: "NotoSansJP", fontSize: 10, lineHeight: 1.35, color: INK },
    styles: {
      title: { fontSize: 19, bold: true, lineHeight: 1.25 },
      subtitle: { fontSize: 11.5, color: MUTED, margin: [0, 4, 0, 0] },
      byline: { fontSize: 9, color: MUTED, margin: [0, 10, 0, 12] },
      body: { margin: [0, 0, 0, 6] },
      h2: { fontSize: 14.5, bold: true, margin: [0, 18, 0, 2] },
      h3: { fontSize: 11, bold: true, margin: [0, 11, 0, 5] },
      h4: { fontSize: 9.5, bold: true, color: MUTED, margin: [0, 6, 0, 4] },
      aside: { fontSize: 8.5, color: MUTED, margin: [0, 0, 0, 5] },
      message: { margin: [10, 2, 10, 6] },
      th: { bold: true, fontSize: 9.5, color: MUTED },
      list: { margin: [0, 0, 0, 2] },
      note: { fontSize: 8.5, color: MUTED, margin: [0, 16, 0, 0] },
    },
    footer: (currentPage: number, pageCount: number): Content => ({
      text: `${currentPage} / ${pageCount}`,
      alignment: "center",
      fontSize: 8,
      color: MUTED,
      margin: [0, 22, 0, 0],
    }),
    // Never leave a heading stranded at the foot of a page, away from the
    // table or list it introduces. Each node is only asked once, so a
    // heading can't wait to see whether what follows it gets moved: the
    // bigger the heading, the more room it is assumed to need beneath it.
    pageBreakBefore: (node, queries) =>
      Boolean(node.headlineLevel) &&
      (queries.getFollowingNodesOnPage().length === 0 ||
        (node.startPosition?.verticalRatio ?? 0) > (node.headlineLevel === 4 ? 0.86 : 0.76)),
    content: [
      { text: `${report.title.ja} — ${kind.ja}サマリー`, style: "title" },
      { text: `${report.title.en} — ${kindTitle} summary`, style: "subtitle" },
      {
        text: [dateText(report.recordedAt, "ja", timeZone), dateText(report.recordedAt, "en", timeZone)]
          .filter(Boolean)
          .join("  ·  "),
        style: "byline",
      },
      {
        text: `${kind.ja}（${facts.ja}）の要約です。日本語版に続いて英語版を掲載しています。`,
        style: "body",
      },
      {
        text: `Summary of a ${kind.en} (${facts.en}). The Japanese version comes first, followed by the English version.`,
        style: "body",
      },
      ...languageSection(report, "ja", false),
      ...languageSection(report, "en", true),
      ...suggestedReplies(report),
      ...keyTerms(report),
      ...rawTranscript(report),
      {
        // Kept together, so one of the two never ends up alone on a last page.
        unbreakable: true,
        stack: [
          {
            text: "※ 本サマリーは録音の自動文字起こしをもとに作成しています。人名などの固有名詞の表記はご確認ください。",
            style: "note",
          },
          {
            text: "Note: this summary is based on an automatic transcription of the recording. Please check the spelling of personal names.",
            style: "note",
            margin: [0, 3, 0, 0],
          },
        ],
      },
    ],
  };
}

export async function renderReportPdf(report: MeetingReport, timeZone?: string): Promise<Buffer> {
  return pdfmake.createPdf(buildReportDocument(report, timeZone)).getBuffer();
}
