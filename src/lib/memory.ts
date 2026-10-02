import type { ActionItem, Bilingual, GlossaryTerm, Session } from "@/lib/types";
import type { AnalysisContext } from "@/lib/llm";

/**
 * What the app remembers across recordings. Nothing is stored separately:
 * it is all derived from the saved sessions, so deleting a recording takes
 * its action items, terms and people with it, and there is nothing to keep
 * in sync.
 */

export interface OpenAction {
  sessionId: string;
  /** Index into that session's report.actionItems — what doneActions refers to. */
  index: number;
  meeting: Bilingual;
  recordedAt: string;
  item: ActionItem;
  done: boolean;
}

export interface KnownPerson {
  /** Their name when a recording gave one, else the speaker label of that recording. */
  label: string;
  named: boolean;
  role: Bilingual;
  caresAbout: Bilingual;
  meeting: Bilingual;
  recordedAt: string;
}

export interface Memory {
  actions: OpenAction[];
  glossary: GlossaryTerm[];
  people: KnownPerson[];
}

/** Newest first, so the latest word on a term or a person is the one kept. */
function reports(sessions: Session[]) {
  return sessions
    .filter((s) => s.status === "ready" && s.report)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((s) => ({ session: s, report: s.report! }));
}

export function buildMemory(sessions: Session[]): Memory {
  const actions: OpenAction[] = [];
  const glossary = new Map<string, GlossaryTerm>();
  const people = new Map<string, KnownPerson>();

  for (const { session, report } of reports(sessions)) {
    const done = new Set(session.doneActions ?? []);
    (report.actionItems ?? []).forEach((item, index) => {
      actions.push({
        sessionId: session.id,
        index,
        meeting: report.title,
        recordedAt: report.recordedAt,
        item,
        done: done.has(index),
      });
    });

    for (const term of report.glossary ?? []) {
      if (!glossary.has(term.term)) glossary.set(term.term, term);
    }

    for (const person of report.insights?.people ?? []) {
      // Speaker labels (S1, S2…) mean nothing across recordings, so an
      // unnamed speaker is only ever known within their own meeting.
      const key = person.name || `${session.id}:${person.speaker}`;
      if (people.has(key)) continue;
      people.set(key, {
        label: person.name || person.speaker,
        named: Boolean(person.name),
        role: person.role,
        caresAbout: person.caresAbout,
        meeting: report.title,
        recordedAt: report.recordedAt,
      });
    }
  }

  return { actions, glossary: [...glossary.values()], people: [...people.values()] };
}

// Enough for the analysis to recognise what it has seen before without the
// prompt growing with every meeting ever recorded.
const CONTEXT_ACTIONS = 20;
const CONTEXT_PEOPLE = 15;
const CONTEXT_TERMS = 40;

/** The slice of memory handed to the analysis of a new recording. */
export function memoryContext(sessions: Session[]): AnalysisContext["memory"] {
  const memory = buildMemory(sessions);
  return {
    openActions: memory.actions
      .filter((a) => !a.done)
      .slice(0, CONTEXT_ACTIONS)
      .map((a) => ({
        description: a.item.description.ja,
        owner: a.item.owner ?? "",
        meeting: a.meeting.ja,
      })),
    people: memory.people
      .filter((p) => p.named)
      .slice(0, CONTEXT_PEOPLE)
      .map((p) => ({ name: p.label, role: p.role.ja })),
    terms: memory.glossary.slice(0, CONTEXT_TERMS).map((g) => g.term),
  };
}
