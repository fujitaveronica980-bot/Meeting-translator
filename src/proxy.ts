import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, expectedAuthCookieValue } from "@/lib/auth";

export async function proxy(req: NextRequest) {
  const expected = await expectedAuthCookieValue();
  if (!expected) return NextResponse.next(); // no APP_PASSWORD set — gate disabled

  const cookie = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (cookie === expected) return NextResponse.next();

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("redirect", req.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Everything except the login page/API and Next's own static assets goes
  // through the gate — deliberately including /api/sessions. The one other
  // exception is /api/upload: the proxy buffers the whole body of every
  // request it handles, which a recording is far too big for, so that
  // route checks the same cookie itself.
  matcher: ["/((?!login|api/login|api/upload|_next/static|_next/image|favicon.ico).*)"],
};
