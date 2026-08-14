import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, isGateEnabled, sha256Hex } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = String(form.get("password") || "");
  const redirectTo = String(form.get("redirect") || "/");
  // Only ever redirect within this app — never follow a redirect target an
  // untrusted request supplied that points somewhere else.
  const safeRedirect = redirectTo.startsWith("/") ? redirectTo : "/";

  if (!isGateEnabled()) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (password !== process.env.APP_PASSWORD) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("error", "1");
    loginUrl.searchParams.set("redirect", safeRedirect);
    return NextResponse.redirect(loginUrl);
  }

  const res = NextResponse.redirect(new URL(safeRedirect, req.url));
  res.cookies.set(AUTH_COOKIE_NAME, await sha256Hex(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });
  return res;
}
