import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, type Picture, type World } from "./store";

/** Everything that ever happened to a story, in order, never rewritten: each version of the
 *  text, each thing sent to GLM and what came back, each picture asked for and drawn.
 *  One line per entry in data/history/<id>.jsonl. Picture files are never deleted, so every
 *  entry can still show its image. Rewind it at /history. */

const HISTORY_DIR = path.join(DATA_DIR, "history");

export type HistoryEntry = { at: number } & (
  | { type: "text"; title: string; text: string }
  /** `system` is only written when the instructions differ from the last ones recorded. */
  | { type: "glm"; tier: "quick" | "full" | "notes" | "picture" | "reactions"; system?: string; sent: string; reply: unknown; thinking?: string; ms: number }
  | { type: "picture"; why: "story" | "asked again"; picture: Picture; replaces?: string }
  /** GLM's notebook after a turn that taught it something, and what was new. */
  | { type: "world"; learned: string[]; world: World }
  | { type: "trouble"; message: string }
);

type Loose<T> = T extends unknown ? Omit<T, "at"> & { at?: number } : never;

const g = globalThis as unknown as { __historySystem?: Map<string, string> };
const lastSystem = (g.__historySystem ??= new Map());

export async function record(id: string, entry: Loose<HistoryEntry>) {
  try {
    if (entry.type === "glm" && entry.system) {
      const key = `${id}/${entry.tier}`;
      if (lastSystem.get(key) === entry.system) entry = { ...entry, system: undefined };
      else lastSystem.set(key, entry.system);
    }
    await mkdir(HISTORY_DIR, { recursive: true });
    await appendFile(path.join(HISTORY_DIR, `${id}.jsonl`), JSON.stringify({ at: Date.now(), ...entry }) + "\n");
  } catch (error) {
    console.error("[history]", error);
  }
}

export async function readHistory(id: string): Promise<HistoryEntry[]> {
  try {
    const lines = (await readFile(path.join(HISTORY_DIR, `${id}.jsonl`), "utf8")).trim().split("\n");
    return lines.filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
