import { fillReactions, saveStory, type Swap } from "@/lib/coach";
import { ensurePainter } from "@/lib/painter";
import { getRuntime, validId } from "@/lib/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!validId(id)) return Response.json({ error: "bad id" }, { status: 400 });
  // Warm the image model while the writer is still thinking of a first line.
  ensurePainter().catch((error) => console.error("[painter]", error.message));
  const { story } = await getRuntime(id);
  // Parts with no reactions yet get some shortly after the story is opened.
  void fillReactions(id).catch((error) => console.error("[reactions]", error));
  return Response.json({ title: story.title, text: story.text, notes: story.notes, ideas: story.ideas, reactions: story.reactions ?? [], pictures: story.pictures, world: story.world ?? null, learned: story.learned ?? [] });
}

export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  if (!validId(id)) return Response.json({ error: "bad id" }, { status: 400 });
  const body = await request.json();
  await saveStory(id, String(body.title ?? "").slice(0, 200), String(body.text ?? "").slice(0, 200_000), Array.isArray(body.usedIdeas) ? body.usedIdeas.map(String) : [], swapsFrom(body.swaps));
  return Response.json({ ok: true });
}

function swapsFrom(value: unknown): Swap[] {
  if (!Array.isArray(value)) return [];
  const word = (v: unknown) => String(v ?? "").slice(0, 60);
  return value.slice(0, 40).map((swap) => ({
    id: String(swap?.id ?? ""),
    word: word(swap?.word),
    ideas: Array.isArray(swap?.ideas) ? swap.ideas.slice(0, 6).map(word) : [],
    nth: Math.max(1, Number(swap?.nth) || 1),
    was: swap?.was ? word(swap.was) : undefined,
  })).filter((swap) => swap.word && swap.ideas.length);
}
