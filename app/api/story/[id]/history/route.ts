import { readHistory } from "@/lib/history";
import { validId } from "@/lib/store";

export const dynamic = "force-dynamic";

/** The whole life of a story, oldest first. Shown at /history. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validId(id)) return Response.json({ error: "bad id" }, { status: 400 });
  return Response.json({ entries: await readHistory(id) });
}
