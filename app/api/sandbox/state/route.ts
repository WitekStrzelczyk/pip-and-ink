import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "@/lib/store";

export const dynamic = "force-dynamic";

/** The sandbox experiment (scene, styles, every picture drawn) lives in data/sandbox/state.json. */
const FILE = path.join(DATA_DIR, "sandbox", "state.json");

export async function GET() {
  try {
    return Response.json(JSON.parse(await readFile(FILE, "utf8")));
  } catch {
    return Response.json(null);
  }
}

export async function PUT(request: Request) {
  const state = await request.json().catch(() => null);
  if (!state || !Array.isArray(state.cards) || JSON.stringify(state).length > 2_000_000) return Response.json({ error: "not a sandbox state" }, { status: 400 });
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(state, null, 2));
  return Response.json({ ok: true });
}
