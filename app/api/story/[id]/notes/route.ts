import { rebuildWorld } from "@/lib/coach";
import { validId } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Have GLM write its story notes again from the whole story. Returns the new notes. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validId(id)) return Response.json({ error: "bad id" }, { status: 400 });
  try {
    return Response.json({ world: await rebuildWorld(id) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
