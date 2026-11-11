import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DATA_DIR, PICTURE_DIR } from "./store";

/** Talks to painter/worker.py, which keeps FLUX.2 klein loaded. Starts it on demand.
 *  The worker keeps running after the app stops, so the next start is instant;
 *  stop it with `pkill -f painter/worker.py`. */

const home = (file: string) => (file.startsWith("~/") ? path.join(os.homedir(), file.slice(2)) : file);
const PORT = process.env.PAINTER_PORT ?? "7861";
const URL = `http://127.0.0.1:${PORT}`;
const PYTHON = home(process.env.MFLUX_PYTHON ?? "~/.local/share/uv/tools/mflux/bin/python");
const MODEL = path.resolve(home(process.env.PAINTER_MODEL ?? "models/flux2-klein-4b-q4"));
// Measured on an M5 with 24 GB: 4-bit weights at 512 px paint in 7-9 s; 768 px takes 18 s or more.
const SIZE = Math.min(1024, Math.max(256, Number(process.env.PAINTER_SIZE) || 512));
/** The distilled model is trained for 4 steps; 3 is enough for a loose pencil sketch. */
const STEPS = { sketch: 3, color: 4 };

const g = globalThis as unknown as { __painter?: Promise<void> };

/** A secret shared with the worker, so only this app can ask it to paint. Kept in a file
 *  because the worker outlives the app and must still recognise it after a restart. */
function token() {
  const file = path.join(DATA_DIR, "painter.token");
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    mkdirSync(DATA_DIR, { recursive: true });
    const fresh = randomBytes(24).toString("hex");
    writeFileSync(file, fresh, { mode: 0o600 });
    return fresh;
  }
}

async function healthy() {
  try {
    return (await fetch(`${URL}/health`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

/** Resolves once the worker answers. Safe to call often; starts at most one worker. */
export function ensurePainter(): Promise<void> {
  g.__painter ??= (async () => {
    if (await healthy()) return;
    if (!existsSync(PYTHON)) throw new Error(`mflux is not installed (${PYTHON} missing)`);
    mkdirSync(PICTURE_DIR, { recursive: true });
    const log = openSync(path.join(DATA_DIR, "painter.log"), "a");
    const child = spawn(PYTHON, [path.join(process.cwd(), "painter/worker.py")], {
      env: { ...process.env, PAINTER_PORT: PORT, PAINTER_MODEL: MODEL, PAINTER_DIR: PICTURE_DIR, PAINTER_TOKEN: token() },
      stdio: ["ignore", log, log],
      detached: true,
    });
    child.unref();
    for (let i = 0; i < 180; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await healthy()) return;
    }
    throw new Error("the painter did not start, see data/painter.log");
  })().catch((error) => {
    g.__painter = undefined; // allow a retry next time
    throw error;
  });
  return g.__painter;
}

type Job = { prompt: string; size: number; steps: number; seed: number; file: string };

async function send(job: Job) {
  const request = () =>
    fetch(`${URL}/paint`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Painter-Token": token() },
      body: JSON.stringify({ prompt: job.prompt, output: job.file, width: job.size, height: job.size, steps: job.steps, seed: job.seed }),
      signal: AbortSignal.timeout(300_000),
    });
  await ensurePainter();
  let response: Response;
  try {
    response = await request();
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") throw new Error("the painter took longer than 5 minutes");
    g.__painter = undefined; // the worker went away: start it again and try once more
    await ensurePainter();
    response = await request();
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) throw new Error(body.error ?? `painting failed (${response.status})`);
}

/** The illustration style chosen in /sandbox. When set, every colour picture uses it
 *  instead of the style GLM suggests, so a whole book looks like one book. */
const HOUSE_STYLE_FILE = path.join(DATA_DIR, "style.json");

export function houseStyle(): string {
  try {
    return String(JSON.parse(readFileSync(HOUSE_STYLE_FILE, "utf8")).color ?? "");
  } catch {
    return "";
  }
}

export function setHouseStyle(color: string) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(HOUSE_STYLE_FILE, JSON.stringify({ color }, null, 2));
}

/** Paints exactly the given prompt, nothing added. Used by the style sandbox. */
export async function paintRaw(job: Job) {
  await send(job);
}

const STYLE = {
  sketch: "Loose pencil sketch on cream paper, graphite lines, light shading, unfinished edges, children's storybook drawing",
  color: "Children's picture book illustration, warm light, rich detail",
};
/** FLUX.2 has no negative prompts ("no text" can summon text), so the ending says what the picture is. */
const ENDING = "Gentle, friendly mood. The whole image is artwork only.";

/** Scene first (the model weighs early words most), then the style, then the mood. */
export async function paint(options: { kind: "sketch" | "color"; prompt: string; style: string; seed: number; file: string }) {
  const sketch = options.kind === "sketch";
  const look = sketch ? STYLE.sketch : houseStyle() || `${options.style}. ${STYLE.color}`;
  const sent = {
    prompt: `${options.prompt.trim()} Style: ${look.replace(/[.\s]+$/, "")}. ${ENDING}`,
    size: SIZE,
    steps: sketch ? STEPS.sketch : STEPS.color,
    seed: options.seed,
  };
  await send({ ...sent, file: options.file });
  return sent;
}
