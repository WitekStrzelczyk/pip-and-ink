import { redraw } from "@/lib/coach";
import { validId } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Draw a picture again. Answers at once with whether it started; the result arrives as a picture event. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validId(id)) return Response.json({ error: "bad id" }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  const state = await redraw(id, body?.picture ? String(body.picture) : undefined);
  return Response.json({ ok: state === "started", state }, { status: state === "started" ? 200 : 409 });
}
