import { getRuntime, validId, type StoryEvent } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Server-sent events: notes and pictures arrive here as soon as they exist. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validId(id)) return new Response("bad id", { status: 400 });
  const runtime = await getRuntime(id);
  const encoder = new TextEncoder();

  let stop = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: StoryEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      const beat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": still here\n\n"));
        } catch {
          stop();
        }
      }, 20_000);
      stop = () => {
        clearInterval(beat);
        runtime.listeners.delete(send);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      runtime.listeners.add(send);
      send({ type: "listening", on: runtime.analyzing });
      request.signal.addEventListener("abort", stop);
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
