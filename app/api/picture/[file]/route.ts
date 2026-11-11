import { readFile } from "node:fs/promises";
import path from "node:path";
import { PICTURE_DIR } from "@/lib/store";

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!/^[a-z0-9-]+\.png$/.test(file)) return new Response("not found", { status: 404 });
  try {
    const data = await readFile(path.join(PICTURE_DIR, file));
    return new Response(new Uint8Array(data), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
