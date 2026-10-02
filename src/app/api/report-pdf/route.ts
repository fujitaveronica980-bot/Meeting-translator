import { NextRequest, NextResponse } from "next/server";
import { renderReportPdf } from "@/lib/report-pdf";
import type { MeetingReport } from "@/lib/types";

/**
 * Turns a report into the downloadable PDF summary. The page posts the
 * report it is showing rather than a session id, so a download still works
 * for a session the server has since forgotten (in-memory store, restart).
 */
export async function POST(req: NextRequest) {
  let report: MeetingReport | undefined;
  let timeZone: string | undefined;
  try {
    const body = await req.json();
    report = body?.report;
    timeZone = typeof body?.timeZone === "string" ? body.timeZone : undefined;
  } catch {
    // fall through to the 400 below
  }
  if (!report?.title?.ja || !report.title.en) {
    return NextResponse.json({ error: "No report to render." }, { status: 400 });
  }

  try {
    const pdf = await renderReportPdf(report, timeZone);
    return new NextResponse(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Length": String(pdf.length) },
    });
  } catch (err) {
    console.error("Failed to render report PDF:", err);
    return NextResponse.json({ error: "Could not create the PDF." }, { status: 500 });
  }
}
