"use client";

import type { Memory } from "@/lib/memory";

/**
 * What the app has learned across every saved recording: action items
 * still open, the vocabulary that keeps coming up, and who people are.
 * Derived from the recordings themselves (see lib/memory.ts).
 */
export function MemoryView({
  memory,
  onToggleAction,
}: {
  memory: Memory;
  onToggleAction: (sessionId: string, index: number, done: boolean) => void;
}) {
  const open = memory.actions.filter((a) => !a.done);
  const done = memory.actions.filter((a) => a.done);
  const named = memory.people.filter((p) => p.named);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">Across meetings</h1>
        <p className="text-sm text-muted">
          Built from every recording in your list — delete a recording and its items leave here too.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
          Open action items / 未完了のアクション ({open.length})
        </h2>
        {memory.actions.length === 0 ? (
          <p className="text-sm text-muted/80">No action items yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {[...open, ...done].map((a) => (
              <li key={`${a.sessionId}:${a.index}`} className="rounded-lg border border-border bg-surface">
                <label className="flex min-h-11 cursor-pointer items-start gap-3 p-3">
                  <input
                    type="checkbox"
                    checked={a.done}
                    onChange={(e) => onToggleAction(a.sessionId, a.index, e.target.checked)}
                    className="mt-1 h-4 w-4 shrink-0"
                  />
                  <span className={`flex flex-col gap-0.5 text-sm ${a.done ? "opacity-50" : ""}`}>
                    <span className={`text-foreground ${a.done ? "line-through" : ""}`}>
                      {a.item.description.ja}
                    </span>
                    <span className="text-muted">{a.item.description.en}</span>
                    <span className="text-xs text-muted/80">
                      {[
                        a.item.owner,
                        a.item.due?.en || a.item.dueHint,
                        a.meeting.en,
                        new Date(a.recordedAt).toLocaleDateString(),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      {named.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
            People / 人物 ({named.length})
          </h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <tbody>
                {named.map((p, i) => (
                  <tr key={p.label} className={i > 0 ? "border-t border-border" : undefined}>
                    <td className="whitespace-nowrap px-3 py-2 align-top font-medium text-foreground">
                      {p.label}
                    </td>
                    <td className="px-3 py-2">
                      <p className="text-foreground">{p.role.ja}</p>
                      <p className="text-muted">{p.role.en}</p>
                      <p className="mt-1 text-muted">{p.caresAbout.en}</p>
                      <p className="mt-1 text-xs text-muted/80">Last seen: {p.meeting.en}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {memory.glossary.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
            Company glossary / 用語集 ({memory.glossary.length})
          </h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-subtle text-xs uppercase text-muted">
                <tr>
                  <th className="px-3 py-2">Term</th>
                  <th className="px-3 py-2">Reading</th>
                  <th className="px-3 py-2">Meaning</th>
                </tr>
              </thead>
              <tbody>
                {memory.glossary.map((g) => (
                  <tr key={g.term} className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-foreground">{g.term}</td>
                    <td className="px-3 py-2 text-muted">{g.reading}</td>
                    <td className="px-3 py-2 text-muted">
                      {g.meaning?.en || [g.translation, g.note].filter(Boolean).join(" — ")}
                      {g.meaning?.ja && <p className="text-foreground">{g.meaning.ja}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
