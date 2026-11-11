import { NextResponse, type NextRequest } from "next/server";

/** The app has no sign-in: it is meant for one trusted computer. This keeps it that way.
 *  Requests must be addressed to localhost (stops DNS rebinding and LAN access), and the
 *  API only answers this app's own pages (stops other websites from calling it).
 *  To use it from another device on purpose, list its address in ALLOWED_HOSTS. */

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const EXTRA = (process.env.ALLOWED_HOSTS ?? "").split(",").map((host) => host.trim()).filter(Boolean);

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!LOCAL.test(host) && !EXTRA.includes(host)) return new NextResponse("This app only answers on localhost.", { status: 403 });
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const origin = request.headers.get("origin");
    const crossSite = request.headers.get("sec-fetch-site") === "cross-site";
    let foreign = false;
    try {
      foreign = Boolean(origin) && new URL(origin!).host !== host;
    } catch {
      foreign = true;
    }
    if (foreign || crossSite) return new NextResponse("Cross-site requests are not allowed.", { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
