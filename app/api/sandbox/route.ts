import { paintRaw } from "@/lib/painter";

export const dynamic = "force-dynamic";

/** Style sandbox: paint one prompt exactly as given. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) ?? {};
  const prompt = String(body.prompt ?? "").slice(0, 2000);
  if (!prompt.trim()) return Response.json({ error: "empty prompt" }, { status: 400 });
  const size = [384, 512, 640, 768].includes(body.size) ? body.size : 512;
  const steps = Math.min(8, Math.max(1, Number(body.steps) || 4));
  const seed = Number.isInteger(body.seed) && body.seed >= 0 && body.seed < 2 ** 31 ? body.seed : 744035;
  const file = `sandbox-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.png`;
  const started = Date.now();
  try {
    await paintRaw({ prompt, size, steps, seed, file });
    return Response.json({ file, ms: Date.now() - started });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
