import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./store";

/** A plain log of everything the listener and painter did for a story, for debugging.
 *  Read it at /api/story/<id>/debug or in data/trace/<id>.jsonl. */

const TRACE_DIR = path.join(DATA_DIR, "trace");

export type TraceEvent = { at: number; what: string } & Record<string, unknown>;

export async function trace(id: string, what: string, details: Record<string, unknown> = {}) {
  try {
    await mkdir(TRACE_DIR, { recursive: true });
    await appendFile(path.join(TRACE_DIR, `${id}.jsonl`), JSON.stringify({ at: Date.now(), what, ...details }) + "\n");
  } catch (error) {
    console.error("[trace]", error);
  }
}

export async function readTrace(id: string, last = 80): Promise<TraceEvent[]> {
  try {
    const lines = (await readFile(path.join(TRACE_DIR, `${id}.jsonl`), "utf8")).trim().split("\n");
    return lines.slice(-last).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
