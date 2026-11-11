import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { partAt } from "./parts";

export const DATA_DIR = path.join(process.cwd(), "data");
export const PICTURE_DIR = path.join(DATA_DIR, "pictures");
const STORY_DIR = path.join(DATA_DIR, "stories");

export type Idea = { word: string; ideas: string[] };

/** A word idea that stays scribbled in the story until it is used. */
export type WordIdea = Idea & {
  id: string;
  type: "syn" | "adj";
  /** Which occurrence of the word it belongs to (1 = first in the story). */
  nth: number;
  /** The writer's own word, kept while one of the ideas is swapped in, so it can be put back. */
  was?: string;
};

/** A short reaction, written in the story next to the sentence it reacts to. */
export type Reaction = {
  id: string;
  text: string;
  /** A curious question that goes with it. */
  question?: string;
  /** The end of that sentence, as written, to find the place again after edits. */
  anchor: string;
};

/** What the listener says about the newest part of the story. */
export type Notes = {
  at: number;
  cheer: string;
  questions: string[];
  guess: string;
  synonyms: Idea[];
  adjectives: Idea[];
  /** How long the full GLM answer took. */
  tookMs?: number;
  /** How long the last quick reaction took. */
  quickMs?: number;
};

export type Picture = {
  id: string;
  kind: "sketch" | "color";
  caption: string;
  prompt: string;
  /** Which part of the story (parts are separated by blank lines) it illustrates; 0 = the first. */
  section?: number;
  /** The style GLM suggested, kept so the picture can be drawn again. */
  style?: string;
  status: "drawing" | "ready" | "failed";
  file?: string;
  /** How long the painter took. */
  tookMs?: number;
  /** Exactly what the image model was given: full prompt and settings. */
  sent?: { prompt: string; size: number; steps: number; seed: number };
};

/** What GLM has understood about the story so far. It grows and changes as the story does. */
export type World = {
  /** One line: what the story is about. */
  about: string;
  /** `look` is the one fixed description the painter gets every time, so a character looks the same in every picture. */
  characters: { name: string; kind: string; facts: string[]; look?: string }[];
  places: { name: string; facts: string[] }[];
  /** What each part of the story is about; index 0 = the first part. */
  parts: string[];
};

/** A message exactly as sent to / received from GLM. Stored verbatim so the
 *  next request repeats the same prefix (cache hits, preserved thinking). */
export type ChatMessage = Record<string, unknown> & { role: string };

export type Story = {
  id: string;
  title: string;
  text: string;
  updatedAt: number;
  /** The text GLM has already been told about. */
  seenText: string;
  seenTitle: string;
  messages: ChatMessage[];
  notes: Notes | null;
  /** Every word idea Pip has offered that has not been used yet. */
  ideas: WordIdea[];
  /** Pip's latest reactions, each tied to the sentence it is about. */
  reactions: Reaction[];
  /** Questions Pip asked recently, so they are not repeated. */
  asked: string[];
  pictures: Picture[];
  world?: World;
  /** 2 = pictures are numbered by long parts (lib/parts.ts), no longer by paragraph. */
  partsVersion?: number;
  /** What the last full turn added to the world, in plain words (shown as "new"). */
  learned?: string[];
};

export type StoryEvent =
  | { type: "listening"; on: boolean; tier?: "quick" | "full" }
  | { type: "notes"; notes: Notes; ideas: WordIdea[]; reactions: Reaction[]; world?: World; learned?: string[] }
  | { type: "picture"; picture: Picture }
  | { type: "trouble"; message: string };

type Runtime = {
  story: Story;
  listeners: Set<(event: StoryEvent) => void>;
  analyzing: boolean;
  painting: boolean;
  /** The text the quick reactions have covered (not saved; starts at seenText). */
  quickSeenText?: string;
  /** Fires the full turn when the writer pauses after an edit. */
  settleTimer?: ReturnType<typeof setTimeout>;
  /** A picture asked for while the painter was busy. The newest request wins. */
  pendingPicture?: { kind: "sketch" | "color"; prompt: string; style: string; caption: string; section?: number };
  /** Which part is being painted right now. */
  paintingSection?: number;
  /** The writer paused after an edit while a call was running: do the full turn next. */
  settled?: boolean;
  /** After failed model calls: how many in a row, and when to try again. */
  failures?: number;
  quietUntil?: number;
  /** Writes the text into the history once typing has paused. */
  textTimer?: ReturnType<typeof setTimeout>;
};

// Survives hot reloads in dev, shared by every route handler.
const g = globalThis as unknown as { __stories?: Map<string, Promise<Runtime>> };
const runtimes = (g.__stories ??= new Map());

export function validId(id: string) {
  return /^[a-z0-9-]{6,40}$/.test(id);
}

export function getRuntime(id: string): Promise<Runtime> {
  let runtime = runtimes.get(id);
  if (!runtime) {
    runtime = load(id);
    runtimes.set(id, runtime);
  }
  return runtime;
}

async function load(id: string): Promise<Runtime> {
  let story: Story = {
    id,
    title: "",
    text: "",
    updatedAt: Date.now(),
    seenText: "",
    seenTitle: "",
    messages: [],
    notes: null,
    ideas: [],
    asked: [],
    reactions: [],
    pictures: [],
  };
  try {
    story = { ...story, ...JSON.parse(await readFile(path.join(STORY_DIR, `${id}.json`), "utf8")) };
    // A picture that was mid-drawing when the server stopped will never finish.
    story.pictures = story.pictures.filter((p) => p.status === "ready");
    // Every reaction needs an id of its own (the page keys its bubbles by it).
    const seen = new Set<string>();
    for (const reaction of story.reactions ?? []) {
      if (seen.has(reaction.id)) reaction.id = `${reaction.id}${Math.random().toString(36).slice(2, 7)}`;
      seen.add(reaction.id);
    }
    if (story.partsVersion !== 2) {
      // Pictures used to belong to paragraphs. Move each to the long part its paragraph is now in.
      const paragraphs = [0, ...[...story.text.matchAll(/\n[ \t]*\n\s*/g)].map((gap) => gap.index + gap[0].length)];
      const kept = new Map<number, Picture>();
      for (const picture of story.pictures) {
        picture.section = partAt(story.text, paragraphs[Math.min(picture.section ?? 0, paragraphs.length - 1)]);
        kept.set(picture.section, picture); // two paragraphs' pictures in one part: the later one stays
      }
      story.pictures = [...kept.values()].sort((a, b) => (a.section ?? 0) - (b.section ?? 0));
      if (story.world) story.world.parts = [];
    }
  } catch (error) {
    // Only a missing file means a new story. A file that cannot be read must not be mistaken
    // for an empty one, or the next autosave would write that emptiness over it.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      runtimes.delete(id);
      throw new Error(`data/stories/${id}.json could not be read: ${error instanceof Error ? error.message : error}`);
    }
  }
  story.partsVersion = 2;
  return { story, listeners: new Set(), analyzing: false, painting: false };
}

/** Saves the story. Many things save the same story (autosave, replies, pictures), so writes
 *  queue up per story, and each lands whole: written beside the file, then moved over it. */
const writing = new Map<string, Promise<void>>();
export function persist(story: Story): Promise<void> {
  const file = path.join(STORY_DIR, `${story.id}.json`);
  const next = (writing.get(story.id) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      await mkdir(STORY_DIR, { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify(story, null, 2));
      await rename(`${file}.tmp`, file);
    });
  writing.set(story.id, next);
  return next;
}

export function emit(runtime: Runtime, event: StoryEvent) {
  for (const listener of [...runtime.listeners]) {
    try {
      listener(event);
    } catch {
      runtime.listeners.delete(listener); // that browser tab is gone
    }
  }
}

export type { Runtime };
