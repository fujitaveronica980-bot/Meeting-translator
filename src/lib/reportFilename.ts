import type { MeetingReport } from "@/lib/types";

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
