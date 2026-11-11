import { describeChange, triggerState } from "@/lib/coach";
import { getRuntime, validId } from "@/lib/store";
import { readTrace } from "@/lib/trace";

export const dynamic = "force-dynamic";

/** Plain-text view of what the listener knows and did. Open /api/story/<id>/debug */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validId(id)) return new Response("bad id", { status: 400 });
  const runtime = await getRuntime(id);
  const { story } = runtime;
  const time = (at: number) => new Date(at).toLocaleTimeString("en-GB");
  const indent = (text: unknown) => String(text).split("\n").map((line) => `      ${line}`).join("\n");

  const out: string[] = [
    `STORY ${id}  "${story.title}"`,
    "",
    "== TEXT NOW ==",
    story.text,
    "",
    "== WHAT GLM HAS NOT SEEN YET ==",
    story.text === story.seenText ? "(nothing, GLM is up to date)" : describeChange(story.seenText, story.text, story.seenTitle, story.title),
    "",
    "== TRIGGER STATE ==",
    JSON.stringify({ ...triggerState(runtime), analyzing: runtime.analyzing, painting: runtime.painting, pictureQueued: Boolean(runtime.pendingPicture) }, null, 1),
    "",
    "== PICTURES ==",
    ...story.pictures.map((p) => `${p.kind}  ${p.file}  ${p.tookMs ?? "?"}ms\n${indent(p.sent?.prompt ?? p.prompt)}`),
    "",
    "== TIMELINE (oldest first) ==",
  ];
  for (const { at, what, ...details } of await readTrace(id)) {
    out.push(`${time(at)}  ${what}`);
    for (const [key, value] of Object.entries(details)) {
      out.push(`   ${key}:`, indent(typeof value === "string" ? value : JSON.stringify(value, null, 1)));
    }
  }
  return new Response(out.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
