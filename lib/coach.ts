import { askGlm, askPicture, askQuick, askReactions, askWorld, REACTIONS_PROMPT, PICTURE_PROMPT, QUICK_PROMPT, SYSTEM_PROMPT, WORLD_PROMPT, type Reply, type WorldUpdate } from "./glm";
import { paint } from "./painter";
import { trace } from "./trace";
import { record } from "./history";
import { partAt, partStarts } from "./parts";
import { emit, getRuntime, persist, type Idea, type Picture, type Runtime, type Story, type WordIdea, type World } from "./store";

/** The full "director" turn runs after this many new sentences (the very first after one). */
const EVERY_SENTENCES = 2;
/** Young writers forget full stops: this many new words also counts. */
const EVERY_WORDS = 30;
/** After a pause this long, anything GLM has not seen (edits to old sentences, a single new
 *  sentence) gets the full turn too. Without it, going back to add "border collie" never reached GLM. */
const SETTLE_MS = 5000;
/** About 40 000 tokens of conversation; past this the session starts over from the story itself. */
const SESSION_LIMIT = 160_000;

const sentenceList = (text: string) => text.match(/[^.!?\n]+[.!?]+(?=["')\]]*(\s|$))/g) ?? [];
const sentences = (text: string) => sentenceList(text).length;
const words = (text: string) => (text.match(/\S+/g) ?? []).length;

const parts = (text: string) => partStarts(text).length;
const partText = (text: string, part: number) => {
  const starts = partStarts(text);
  return text.slice(starts[part] ?? 0, starts[part + 1]).trim();
};
/** Which part the change is in (0 = the first part). */
function changedPart(before: string, after: string) {
  // New writing at the end is what matters most, also when an earlier part was touched in the same go.
  if (after.trimEnd().slice(-12) !== before.trimEnd().slice(-12)) return parts(after) - 1;
  let at = 0;
  while (at < before.length && at < after.length && before[at] === after[at]) at++;
  while (at < after.length && /\s/.test(after[at])) at++;
  return partAt(after, Math.min(at, Math.max(0, after.trimEnd().length - 1)));
}

/** Folds what GLM learned this turn into the story's world. Returns the changes in plain words. */
export function learn(story: Story, update: WorldUpdate, part: number): string[] {
  const world: World = (story.world ??= { about: "", characters: [], places: [], parts: [] });
  const learned: string[] = [];
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  if (update.about && !same(update.about, world.about)) {
    world.about = update.about;
    learned.push(`The story: ${update.about}`);
  }
  if (update.part_about && !same(update.part_about, world.parts[part] ?? "")) {
    for (let i = world.parts.length; i < part; i++) world.parts[i] = "";
    world.parts[part] = update.part_about;
    learned.push(`Part ${part + 1}: ${update.part_about}`);
  }
  const fold = <T extends { name: string; facts: string[] }>(known: T[], fresh: T[], what: string) => {
    for (const entry of fresh) {
      const old = known.find((other) => same(other.name, entry.name));
      if (!old) {
        known.push(entry);
        learned.push(`New ${what}: ${entry.name}`, ...entry.facts.map((fact) => `${entry.name}: ${fact}`));
        if ((entry as { look?: string }).look) learned.push(`${entry.name} is drawn as: ${(entry as { look?: string }).look}`);
        continue;
      }
      learned.push(...entry.facts.filter((fact) => !old.facts.some((had) => same(had, fact))).map((fact) => `${entry.name}: ${fact}`));
      const gone = old.facts.filter((had) => !entry.facts.some((fact) => same(had, fact)));
      const come = entry.facts.filter((fact) => !old.facts.some((had) => same(had, fact)));
      learned.push(...gone.map((had) => `${entry.name}: no longer "${had}"`));
      // A look is fixed: it only changes together with the facts, never on a whim.
      const before = (old as { look?: string }).look;
      Object.assign(old, entry);
      const now = (entry as { look?: string }).look;
      if (before && (!now || (gone.length === 0 && come.length === 0))) (old as { look?: string }).look = before;
      else if (now && now !== before) learned.push(`${entry.name} is drawn as: ${now}`);
    }
  };
  fold(world.characters, update.characters, "character");
  fold(world.places, update.places, "place");
  return learned;
}

/** Writes the notebook again from the whole story: for stories older than the notebook, or when it has drifted. */
export async function rebuildWorld(id: string) {
  const runtime = await getRuntime(id);
  const { story } = runtime;
  if (!story.text.trim()) return story.world ?? null;
  const starts = partStarts(story.text);
  const started = Date.now();
  const keep = Object.fromEntries((story.world?.characters ?? []).filter((character) => character.look).map((character) => [character.name, character.look!]));
  const { world, sent } = await askWorld(starts.map((start, index) => story.text.slice(start, starts[index + 1])), keep);
  for (const character of world.characters) {
    const kept = Object.entries(keep).find(([name]) => name.toLowerCase() === character.name.toLowerCase());
    if (kept) character.look = kept[1];
  }
  void record(id, { type: "glm", tier: "notes", system: WORLD_PROMPT, sent, reply: world, ms: Date.now() - started });
  story.world = world;
  story.learned = ["The notebook was written again from the whole story"];
  void record(id, { type: "world", learned: story.learned, world: structuredClone(world) });
  if (story.notes) emit(runtime, { type: "notes", notes: story.notes, ideas: story.ideas ?? [], reactions: story.reactions ?? [], world, learned: story.learned });
  await persist(story);
  return world;
}

/** The scene GLM asked for, plus the fixed look of everyone named in it: the same child, the same dog, every time. */
function withCast(story: Story, prompt: string) {
  const escaped = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cast = (story.world?.characters ?? [])
    .filter((character) => character.look && new RegExp(`(?<![\\w'])${escaped(character.name)}(?![\\w])`, "i").test(prompt))
    .map((character) => `${character.name} is ${character.look!.replace(/[.\s]+$/, "")}.`);
  return cast.length ? `${prompt.trim()} ${cast.join(" ")}` : prompt;
}

/** A part nobody has reacted to (it was written before Pip listened, or its bubbles were lost):
 *  ask for a few reactions on it, once per part, so every part has something to click. */
const catchingUp = new Set<string>();
export async function fillReactions(id: string) {
  const runtime = await getRuntime(id);
  const { story } = runtime;
  const starts = partStarts(story.text);
  for (let part = 0; part < starts.length; part++) {
    const from = starts[part];
    const to = starts[part + 1] ?? story.text.length;
    const text = story.text.slice(from, to);
    const key = `${id}/${text.trim().slice(0, 60)}`; // by its opening words: part numbers shift when the story is edited
    const has = (story.reactions ?? []).some((r) => {
      const at = story.text.lastIndexOf(r.anchor);
      return at >= from && at < to;
    });
    if (has || catchingUp.has(key) || sentences(text) < 2) continue;
    catchingUp.add(key);
    try {
      const started = Date.now();
      const { reactions, sent } = await askReactions(text, story.asked ?? []);
      void record(id, { type: "glm", tier: "reactions", system: REACTIONS_PROMPT, sent, reply: reactions, ms: Date.now() - started });
      for (const r of reactions) react_to(story, r.cheer, r.question || undefined, r.quote, story.text);
      remember(story, reactions.map((r) => r.question).filter(Boolean));
      if (story.notes) emit(runtime, { type: "notes", notes: story.notes, ideas: story.ideas ?? [], reactions: story.reactions ?? [] });
      await persist(story);
    } catch (error) {
      console.error("[reactions]", error);
      catchingUp.delete(key);
    }
    return; // one part at a time
  }
}

/** Throws away every reaction and has GLM react to each part again, from the text as it is now. */
export async function regenerateReactions(id: string) {
  const runtime = await getRuntime(id);
  const { story } = runtime;
  const text = story.text; // one snapshot for the whole pass
  if (!text.trim()) return story.reactions ?? [];
  const starts = partStarts(text);
  const fresh: { cheer: string; question: string; quote: string }[] = [];
  const asked: string[] = [];
  for (let part = 0; part < starts.length; part++) {
    const started = Date.now();
    const { reactions, sent } = await askReactions(text.slice(starts[part], starts[part + 1]), asked);
    void record(id, { type: "glm", tier: "reactions", system: REACTIONS_PROMPT, sent, reply: reactions, ms: Date.now() - started });
    fresh.push(...reactions);
    asked.push(...reactions.map((r) => r.question).filter(Boolean));
    catchingUp.add(`${id}/${text.slice(starts[part], starts[part + 1]).trim().slice(0, 60)}`);
  }
  if (!fresh.length) return story.reactions ?? [];
  story.reactions = [];
  for (const r of fresh) react_to(story, r.cheer, r.question || undefined, r.quote, text);
  story.asked = asked.slice(-12);
  if (story.notes) emit(runtime, { type: "notes", notes: story.notes, ideas: story.ideas ?? [], reactions: story.reactions });
  await persist(story);
  return story.reactions;
}

export type Swap = Pick<WordIdea, "id" | "word" | "ideas" | "nth" | "was">;

/** Autosave entry point: store the text, then decide whether it is time to listen. */
export async function saveStory(id: string, title: string, text: string, usedIdeas: string[] = [], swaps: Swap[] = []) {
  const runtime = await getRuntime(id);
  const changed = runtime.story.title !== title || runtime.story.text !== text;
  if (!changed && !usedIdeas.length && !swaps.length) return; // opening a story is not writing in it
  if (changed) {
    runtime.story.updatedAt = Date.now();
    // The history gets the text once typing pauses, not on every keystroke.
    clearTimeout(runtime.textTimer);
    runtime.textTimer = setTimeout(() => void record(id, { type: "text", title: runtime.story.title, text: runtime.story.text }), 4000);
  }
  runtime.story.title = title;
  runtime.story.text = text;
  if (usedIdeas.length) runtime.story.ideas = (runtime.story.ideas ?? []).filter((idea) => !usedIdeas.includes(idea.id));
  // A synonym the writer swapped in: the idea now belongs to the new word, and offers the old one back.
  for (const swap of swaps) {
    const idea = runtime.story.ideas?.find((other) => other.id === swap.id && other.type === "syn");
    if (idea) Object.assign(idea, { word: swap.word, ideas: swap.ideas, nth: swap.nth, was: swap.was });
  }
  await persist(runtime.story);
  clearTimeout(runtime.settleTimer);
  runtime.settleTimer = setTimeout(() => void listen(runtime, true), SETTLE_MS);
  void listen(runtime);
}

/** For the debug view: the numbers the trigger decides on. */
export function triggerState(runtime: Runtime) {
  const { text, seenText } = runtime.story;
  return {
    newSentences: sentences(text) - sentences(seenText),
    newWords: words(text) - words(seenText),
    editedOldText: !text.startsWith(seenText),
    fullTurnDue: dueFull(runtime),
    quickDue: dueQuick(runtime),
    fullTurnDueAfterPause: unseenAfterPause(runtime),
    needs: `${EVERY_SENTENCES} new sentences or ${EVERY_WORDS} new words, or a ${SETTLE_MS / 1000}s pause with unseen changes`,
  };
}

/** Something GLM has not seen and that is worth a full turn once the writer pauses. */
function unseenAfterPause(runtime: Runtime) {
  const { text, seenText, messages } = runtime.story;
  if (messages.length === 0 || text.trim() === seenText.trim()) return false;
  return !text.startsWith(seenText) || sentences(text) > sentences(seenText);
}

/** Enough new material for the full turn: word ideas, guess, picture direction. */
function dueFull(runtime: Runtime) {
  const { text, seenText, messages } = runtime.story;
  if (text === seenText) return false;
  const newSentences = sentences(text) - sentences(seenText);
  const newWords = words(text) - words(seenText);
  if (messages.length === 0) return newSentences >= 1 || newWords >= 12;
  return newSentences >= EVERY_SENTENCES || newWords >= EVERY_WORDS;
}

/** One new sentence: a quick reaction and question, without the full turn. */
function dueQuick(runtime: Runtime) {
  return sentences(runtime.story.text) > sentences(runtime.quickSeenText ?? runtime.story.seenText);
}

/** Two tiers, one call at a time: a quick reaction per sentence, the director every couple of sentences. */
async function listen(runtime: Runtime, paused = false) {
  if (runtime.analyzing) {
    if (paused) runtime.settled = true; // the pause is remembered for when the running call ends
    return;
  }
  if (Date.now() < (runtime.quietUntil ?? 0)) return; // backing off after a failure
  const settled = (paused || runtime.settled === true) && unseenAfterPause(runtime);
  runtime.settled = false;
  const tier = dueFull(runtime) || settled ? "full" : dueQuick(runtime) ? "quick" : null;
  if (!tier) return;
  void trace(runtime.story.id, `trigger ${tier}`, { why: settled && !dueFull(runtime) ? "pause after unseen changes" : "enough new text", ...triggerState(runtime) });
  runtime.analyzing = true;
  let failed = false;
  try {
    emit(runtime, { type: "listening", on: true, tier });
    await (tier === "full" ? direct(runtime) : react(runtime));
    runtime.failures = 0;
  } catch (error) {
    failed = true;
    const message = error instanceof Error ? error.message : String(error);
    console.error("[coach]", error);
    // Wait longer after each failure in a row (15 s, 30 s ... 5 min), and only try again when
    // the writer writes again: a broken key must not keep calling the API from an idle page.
    runtime.failures = (runtime.failures ?? 0) + 1;
    runtime.quietUntil = Date.now() + Math.min(300_000, 15_000 * 2 ** (runtime.failures - 1));
    void trace(runtime.story.id, "ERROR", { message });
    void record(runtime.story.id, { type: "trouble", message });
    // A missed quick reaction is not worth a red note; the next turn makes up for it.
    if (tier === "full" || runtime.failures > 1) emit(runtime, { type: "trouble", message });
  } finally {
    runtime.analyzing = false;
    emit(runtime, { type: "listening", on: false, tier });
    if (!failed) void listen(runtime); // more may have been written while we were away
  }
}

function remember(story: Story, questions: string[]) {
  story.asked = [...(story.asked ?? []), ...questions].slice(-12);
}

/** Ties a reaction to the sentence it is about, so it can be drawn right there in the story. */
function react_to(story: Story, cheer: string, question: string | undefined, quote: string | undefined, text: string) {
  // Pin the reaction to the sentence GLM quoted; without a usable quote, to the last sentence.
  quote = quote?.replace(/[.!?"')\]\s]+$/, ""); // with the full stop included, the search below would run on into the next sentence
  const at = quote && quote.length >= 4 ? text.toLowerCase().lastIndexOf(quote.toLowerCase()) : -1;
  let anchor = (sentenceList(text).at(-1) ?? "").trim().slice(-32);
  if (at >= 0) {
    const rest = text.slice(at + quote!.length);
    const stop = rest.search(/[.!?]+(?=["')\]]*(\s|$))|\n/);
    const end = stop < 0 ? text.length : at + quote!.length + stop + (rest.slice(stop).match(/^[.!?]+/)?.[0].length ?? 0);
    anchor = text.slice(0, end).trimEnd().slice(-32);
  }
  if (!cheer || anchor.length < 4) return;
  story.reactions = [...(story.reactions ?? []).filter((r) => r.anchor !== anchor), { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, text: cheer, question, anchor }].slice(-40);
}

async function react(runtime: Runtime) {
  const { story } = runtime;
  const text = story.text;
  const covered = sentences(runtime.quickSeenText ?? story.seenText);
  const newest = sentenceList(text).slice(covered).join(" ").trim();
  const started = Date.now();
  const { cheer, question, quote, sent } = await askQuick(text.slice(-900), newest, story.asked ?? []);
  runtime.quickSeenText = text;
  void record(story.id, { type: "glm", tier: "quick", system: QUICK_PROMPT, sent, reply: { quote, cheer, question }, ms: Date.now() - started });
  void trace(story.id, "glm quick", { ms: Date.now() - started, newest, cheer, question });
  react_to(story, cheer, question, quote, text);
  const empty = { guess: "", synonyms: [], adjectives: [] };
  story.notes = { ...empty, ...story.notes, at: Date.now(), cheer, questions: question ? [question] : [], quickMs: Date.now() - started };
  remember(story, story.notes.questions);
  emit(runtime, { type: "notes", notes: story.notes, ideas: story.ideas ?? [], reactions: story.reactions ?? [] });
  await persist(story);
}

async function direct(runtime: Runtime) {
  const { story } = runtime;
  const text = story.text; // snapshot: the writer keeps typing meanwhile
  const title = story.title;
  // Quick reactions are not part of the session, so tell the director what was already asked.
  const asked = (story.asked ?? []).length ? `\n\n(You already asked: ${story.asked.join(" | ")})` : "";
  const part = changedPart(story.seenText, text);
  // Every part gets a picture as soon as GLM sees it.
  const bare = !story.pictures.some((p) => (p.section ?? 0) === part) && runtime.pendingPicture?.section !== part && runtime.paintingSection !== part;
  const where =
    (parts(text) > 1
      ? `\n\n(This is in part ${part + 1} of ${parts(text)}. A picture, if you ask for one, shows ONLY part ${part + 1}, which reads in full:\n"${partText(text, part)}"\nNothing from the other parts may be in the picture.)`
      : "") +
    (bare ? `\n\n(Part ${part + 1} has no picture yet. You MUST ask for one now: picture must not be null.)` : "");
  // The notebook goes back to GLM every time, so it builds on it instead of starting over.
  // A story started before the notebook existed has none: ask for all of it at once.
  const blank = !story.world || (!story.world.about && story.world.characters.length === 0);
  const notebook = blank
    ? story.seenText.trim()
      ? "\n\n(Your STORY NOTES are still empty. Fill in \"world\" now from the WHOLE story so far, not just this change: about, part_about, and EVERY character and place you know, each with all their facts.)"
      : ""
    : `\n\nSTORY NOTES (yours, so far):\n${JSON.stringify(story.world)}` +
      (story.world!.characters.some((character) => !character.look)
        ? `\n\n(These characters have no "look" yet. Give each one now, with all their facts: ${story.world!.characters.filter((character) => !character.look).map((character) => character.name).join(", ")}.)`
        : "");
  // The conversation only ever grows. Before it outgrows the model, start a new one that
  // opens with the whole story and the notebook instead of the long trail of changes.
  const restart = JSON.stringify(story.messages).length > SESSION_LIMIT;
  const user = { role: "user", content: describeChange(restart ? "" : story.seenText, text, restart ? "" : story.seenTitle, title) + where + asked + notebook };
  // Always the current instructions, also for stories started under an older prompt.
  const history = [{ role: "system", content: SYSTEM_PROMPT }, ...(restart ? [] : story.messages.slice(1))];
  const started = Date.now();
  const { reply, assistant, toolCallIds } = await askGlm([...history, user]);
  const tookMs = Date.now() - started;
  void trace(story.id, "glm full", { ms: tookMs, told: user.content, reply });
  const thinking = typeof assistant.reasoning_content === "string" ? assistant.reasoning_content : undefined;
  void record(story.id, { type: "glm", tier: "full", system: SYSTEM_PROMPT, sent: user.content, reply, thinking, ms: tookMs });

  // Only ever append: the next request must start with exactly these messages.
  story.messages = [...history, user, assistant];
  // Every tool call needs its answer, or the API refuses the next turn.
  for (const [index, id] of toolCallIds.entries()) {
    story.messages.push({
      role: "tool",
      tool_call_id: id,
      content: index > 0 ? JSON.stringify({ ignored: "call respond once per turn" }) : JSON.stringify({ shown: true, picture: reply.picture ? `${reply.picture.kind} is being drawn` : "none asked" }),
    });
  }
  story.seenText = text;
  story.seenTitle = title;
  runtime.quickSeenText = text;
  story.notes = { at: Date.now(), cheer: reply.cheer, questions: reply.questions, guess: reply.guess, synonyms: reply.synonyms, adjectives: reply.adjectives, tookMs, quickMs: story.notes?.quickMs };
  remember(story, reply.questions);
  rememberIdeas(story, text, "syn", reply.synonyms);
  rememberIdeas(story, text, "adj", reply.adjectives);
  react_to(story, reply.cheer, reply.questions[0], reply.quote, text);
  story.learned = learn(story, reply.world, part);
  if (story.learned.length) void record(story.id, { type: "world", learned: story.learned, world: structuredClone(story.world!) });
  emit(runtime, { type: "notes", notes: story.notes, ideas: story.ideas, reactions: story.reactions ?? [], world: story.world, learned: story.learned });
  void fillReactions(story.id);
  if (reply.picture) {
    reply.picture.section = part;
    if (runtime.painting) runtime.pendingPicture = reply.picture; // drawn as soon as the painter is free
    else void draw(runtime, reply.picture);
  }
  await persist(story);
}

/** Word ideas pile up instead of being replaced: an idea stays until the writer uses it. */
function rememberIdeas(story: Story, text: string, type: "syn" | "adj", fresh: Idea[]) {
  story.ideas ??= []; // stories saved before ideas were kept
  for (const { word, ideas } of fresh) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nth = (text.match(new RegExp(`(?<![\\w'])${escaped}(?![\\w'])`, "gi")) ?? []).length;
    if (!nth) continue; // the word is not in the story (any more)
    const same = (other: { type: string; word: string; nth: number }) =>
      other.type === type && other.word.toLowerCase() === word.toLowerCase() && other.nth === nth;
    story.ideas = story.ideas.filter((other) => !same(other));
    story.ideas.push({ id: `${Date.now().toString(36)}-${type}-${Math.random().toString(36).slice(2, 7)}`, type, word, ideas, nth });
  }
  story.ideas = story.ideas.slice(-40);
}

/** Tells GLM only what changed, so each turn stays small and the prefix stays cached. */
export function describeChange(before: string, after: string, titleBefore: string, titleAfter: string) {
  const title = titleAfter && titleAfter !== titleBefore ? `TITLE: ${titleAfter}\n\n` : "";
  if (!before.trim()) return `${title}THE STORY STARTS:\n${after.trim()}`;
  if (after.startsWith(before)) return `${title}ADDED AT THE END:\n${after.slice(before.length).trim()}`;

  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  // Widen to whole words so the change reads naturally.
  while (start > 0 && /\S/.test(before[start - 1])) start--;
  while (end > 0 && /\S/.test(before[before.length - end])) end--;

  const was = before.slice(start, before.length - end).trim();
  const now = after.slice(start, after.length - end).trim();
  if (was.length + now.length > after.length * 0.6) return `${title}THE STORY WAS REWRITTEN. IT NOW READS:\n${after.trim()}`;
  if (!was) return `${title}ADDED (after "${before.slice(Math.max(0, start - 40), start).trim()}"):\n${now}`;
  if (!now) return `${title}REMOVED:\n${was}`;
  return `${title}CHANGED:\n"${was}"\nNOW READS:\n"${now}"`;
}

/** Runs one paint job and reports it, whatever happens. */
async function painting(runtime: Runtime, picture: Picture, why: "story" | "asked again", replaces: Picture | undefined, job: () => Promise<Picture["sent"]>) {
  const { story } = runtime;
  runtime.painting = true;
  runtime.paintingSection = picture.section ?? 0;
  const started = Date.now();
  try {
    emit(runtime, { type: "picture", picture });
    picture.sent = await job();
    picture.tookMs = Date.now() - started;
    picture.status = "ready";
    void trace(story.id, why === "story" ? "painted" : "redrawn on request", { ms: picture.tookMs, file: picture.file, replacedOld: Boolean(replaces), ...picture.sent });
    story.pictures = [...story.pictures.filter((p) => p !== replaces), picture].sort((a, b) => (a.section ?? 0) - (b.section ?? 0));
    await persist(story);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[painter]", error);
    void trace(story.id, "PAINT ERROR", { message, prompt: picture.prompt });
    picture.status = "failed";
    picture.file = undefined;
    emit(runtime, { type: "trouble", message: `the picture could not be drawn: ${message}` });
  } finally {
    runtime.painting = false;
    runtime.paintingSection = undefined;
    void record(story.id, { type: "picture", why, picture, replaces: picture.status === "ready" ? replaces?.id : undefined });
    emit(runtime, { type: "picture", picture });
    const next = runtime.pendingPicture;
    runtime.pendingPicture = undefined;
    if (next) void draw(runtime, next);
  }
}

/** One picture per part of the story: a new picture for a part replaces that part's old one.
 *  A part is only sketched once, so its second picture is always the colour version. */
async function draw(runtime: Runtime, wanted: NonNullable<Reply["picture"]>) {
  const { story } = runtime;
  const section = wanted.section ?? 0;
  const previous = story.pictures.findLast((p) => p.status === "ready" && (p.section ?? 0) === section);
  const id = Date.now().toString(36);
  const kind = previous ? "color" : wanted.kind;
  const picture: Picture = { id, kind, caption: wanted.caption, prompt: wanted.prompt, style: wanted.style, section, status: "drawing", file: `${story.id}-${id}.png` };
  // The same seed for the whole story keeps its pictures feeling related.
  await painting(runtime, picture, "story", previous, () => paint({ kind, prompt: withCast(story, wanted.prompt), style: wanted.style, seed: seedFor(story.id), file: picture.file! }));
}

/** Draws one picture again: reads its part of the story afresh, then paints with a new seed
 *  and puts the result in the old one's place. Says at once whether it could start. */
export async function redraw(storyId: string, pictureId?: string): Promise<"started" | "busy" | "no picture"> {
  const runtime = await getRuntime(storyId);
  const { story } = runtime;
  const old = pictureId ? story.pictures.find((p) => p.id === pictureId) : story.pictures.at(-1);
  if (!old?.file) return "no picture";
  if (runtime.painting) return "busy";
  const id = Date.now().toString(36);
  const picture: Picture = { ...old, id, status: "drawing", file: `${story.id}-${id}.png`, tookMs: undefined, sent: undefined };
  void painting(runtime, picture, "asked again", old, async () => {
    try {
      const started = Date.now();
      const fresh = await askPicture(partText(story.text, old.section ?? 0), { characters: (story.world?.characters ?? []).map((character) => `${character.name} (${character.kind})`), places: (story.world?.places ?? []).map((place) => place.name) });
      void record(story.id, { type: "glm", tier: "picture", system: PICTURE_PROMPT, sent: fresh.sent, reply: { prompt: fresh.prompt, caption: fresh.caption }, ms: Date.now() - started });
      picture.prompt = fresh.prompt;
      if (fresh.caption) picture.caption = fresh.caption;
    } catch (error) {
      console.error("[redraw] keeping the old prompt:", error);
    }
    return paint({ kind: old.kind, prompt: withCast(story, picture.prompt), style: picture.style || "soft watercolour and coloured pencil", seed: Math.floor(Math.random() * 1_000_000), file: picture.file! });
  });
  return "started";
}

function seedFor(id: string) {
  let hash = 7;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 1_000_000;
}
