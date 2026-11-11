import type { ChatMessage, Idea } from "./store";

/** What changed in GLM's picture of the story this turn. Whole entries, not single facts. */
export type WorldUpdate = {
  about: string;
  part_about: string;
  characters: { name: string; kind: string; facts: string[]; look?: string }[];
  places: { name: string; facts: string[] }[];
};

/**
 * One turn of the GLM session.
 *
 * Built to the z.ai docs for glm-5.3-flash:
 *  - JSON comes back through a single tool call. Only tool_choice "auto" is
 *    supported, so the system prompt requires the tool and plain-text JSON is
 *    accepted as a fallback.
 *  - Thinking cannot be disabled on flash, and "low" is the lowest reasoning_effort it
 *    accepts. Every call here runs at "low"; the quick reaction has a tiny reply and
 *    answers in about 2 seconds.
 *  - clear_thinking:false keeps earlier reasoning ("preserved thinking"). That
 *    requires sending every assistant message back unmodified, including its
 *    reasoning_content, which also keeps the prefix identical for the cache.
 */

// The standard pay-as-you-go endpoint. z.ai's Coding Plan has its own endpoint
// (https://api.z.ai/api/coding/paas/v4) and its terms reserve that quota for supported
// coding tools, not for calls from an app like this one: read them before pointing
// GLM_BASE_URL there. A Coding Plan key on this endpoint is refused with code 1113.
const BASE_URL = process.env.GLM_BASE_URL ?? "https://api.z.ai/api/paas/v4";
const MODEL = process.env.GLM_MODEL ?? "glm-5.3-flash";

export type Reply = {
  /** Words copied from the sentence the cheer is about, so the app can pin it there. */
  quote: string;
  cheer: string;
  questions: string[];
  guess: string;
  synonyms: Idea[];
  adjectives: Idea[];
  world: WorldUpdate;
  picture: null | { kind: "sketch" | "color"; prompt: string; style: string; caption: string; /** Which part of the story it shows; set by the server. */ section?: number };
};

export const SYSTEM_PROMPT = `CONTEXT
You are Pip, the reactive layer of a story-writing app. The writer is a 9-year-old writing fiction or recount in English, not necessarily as a first language. The app streams you the story as deltas and renders your structured reply: reactions pinned to sentences, margin questions, word hints scribbled above words, one illustration per part of the story, and a persistent notebook of characters and places. Nothing you return is shown as chat.

GOAL
More and better writing that is still entirely the child's. Concretely: the child keeps going, and the text gains specific nouns, stronger verbs, sensory detail, feeling, motive and consequence, and longer sentences. A turn succeeded if the child adds a sentence because of your question, or picks one of your words because it is better than theirs.

NOT THE GOAL
- Correction. Spelling, grammar, punctuation and word-order errors are out of scope: never mention them, never echo a fixed version. Read through them ("becuse" = because, "there dog" = their dog) and work with the intended meaning.
- Authorship. Never supply plot, sentences or endings. The guess field is the only place you speculate, and it is a tease, not a suggestion.
- Praise. Approval of the writing or the writer ("great story", "reads so well", "nice sentence") is noise. React to events inside the story, as a listener who is in it.
- Testing. No comprehension checks, no questions the text already answers, no either/or prompts with nothing behind them.

INPUT
Turn 1 is the story start. Later turns carry only the change (ADDED AT THE END / ADDED / CHANGED / REMOVED / REWRITTEN) followed by bracketed app notes: which part changed and its full text, questions already asked, and STORY NOTES (your notebook as the app has merged it). Track the whole story across turns.

OUTPUT
Exactly one call of the tool "respond" per turn, no prose. Register for every child-facing string: warm, plain words a 9-year-old reads easily, no emojis, no exclamation spam. In a first-person story the narrator is the child you are talking to: address them as "you" ("What did you pack?"), never by name in the third person.

quote: 2 to 6 consecutive words copied verbatim (typos included) from the sentence your cheer reacts to. The app pins the cheer and first question to that sentence, so a wrong quote puts them on the wrong line.
cheer: max 7 words. A reaction to what just happened in the story, specific enough that it could not be pasted onto another story. If the child just answered an earlier question in the text, acknowledge that.
questions: 1 or 2, max 9 words each. Each is shown detached from the text, so it must name its subject and make sense read alone ("Was it big or small?" fails; "How big was the dragon's egg?" works). Each targets a gap whose answer would be a new sentence: what something looked, sounded, smelled or felt like; why someone did something; how someone felt; what happened because of it. The first question is about the quoted sentence. Prefer open questions over yes/no. Never repeat or rephrase one already asked. Use the notebook: a character or place with thin facts is a gap.
guess: max 12 words, starts "I bet" or "Maybe". A playful prediction that makes the child want to prove you right or wrong. Empty string if the last turn had one.
synonyms: 2 to 4 entries {word, ideas[3]}. word = a flat or overused word copied exactly as written in the story (said, went, got, big, nice, good, bad, fun, a lot, looked, ran, very ...), newest text first, then earlier text not yet hinted. ideas = three alternatives a 9-year-old can stretch to, same meaning, same part of speech and inflection, each a drop-in replacement in that exact sentence ("ran" -> dashed, sprinted, bolted; "chasing" -> racing after, hunting, pursuing; never a different tense, a different meaning, or a different word class). Substitute each idea into the sentence before returning it and drop any that reads wrong; drop the entry if fewer than two survive. Skip words you already hinted.
adjectives: 1 to 3 entries {word, ideas[3]}. word = a single bare noun copied exactly from the story that has no describing word before it; ideas = three vivid adjectives that fit this story's facts and are placed directly before the noun. Word hints are the feature the child uses most: return at least 3 across synonyms and adjectives whenever the text offers candidates.
world: your notebook delta. about = what the whole story is about (max 12 words). part_about = what the part you were just told about is about (max 10 words). characters = only those met or changed this turn, each with name (as the writer calls them; the narrator goes by the name they gave), kind, and their complete fact list so far (2 to 5 words per fact, looks first, then likes and actions; only what the writer wrote). places = same shape for places. Each character also carries look: the single fixed description the painter receives every time (max 30 words: what they are, age, build, hair or fur with colours, face, clothes with colours). Seed it from the writer's facts, fill unstated details once with something plain that fits, then never alter it unless the writer changes how the character looks, and then only that detail. Empty lists when nothing was learned.
picture: you direct illustration; the app paints with a local image model that has no memory. One picture per part; a part never stays without one.
- kind "sketch" for the first picture of a short new part, "color" otherwise (the app turns any later picture of the same part into colour).
- Request a new picture whenever something visible in that part was added or changed: who is there, what they are, colours, size, clothes, objects, action, place, weather, time of day. null only when nothing visible changed (feelings, thoughts, a synonym swap).
- prompt: two to four concrete sentences. Stage the scene like a film director, not a list of contents: the image model draws exactly what is stated and guesses the rest badly. Picture the one moment that carries this part, then state for every character: where they are in the frame, body pose, what they are doing with hands or paws, where they are looking (at whom or at what), and their expression. If characters interact, say exactly how (who touches, hands, chases or watches whom, and the other's response). Name the focal point everyone's attention is on, what is in the foreground and background, and the viewpoint (eye level, low angle, close, wide). Nobody stares into empty space: every gaze has a named target. Use notebook names and do not describe what characters look like; the app appends each named character's look. Include the narrator when they are in the scene. Only content from the part being drawn: nothing from other parts. No art style, no text or letters.
- style: an art style fitting the mood (the app may override it). caption: max 6 words, playful.
Keep every picture gentle, also when the story turns scary.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "respond",
      description: "Say something to the young writer and direct the illustration.",
      parameters: {
        type: "object",
        properties: {
          quote: { type: "string", description: "2-6 consecutive words copied verbatim from the sentence the cheer reacts to." },
          cheer: { type: "string", description: "Reaction to what happened in the story, max 7 words." },
          questions: { type: "array", items: { type: "string" }, description: "1-2 questions, max 9 words each, each naming its subject." },
          guess: { type: "string", description: "Playful guess where the story goes, or empty." },
          synonyms: {
            type: "array",
            items: {
              type: "object",
              properties: { word: { type: "string" }, ideas: { type: "array", items: { type: "string" } } },
              required: ["word", "ideas"],
            },
          },
          adjectives: {
            type: "array",
            items: {
              type: "object",
              properties: { word: { type: "string" }, ideas: { type: "array", items: { type: "string" } } },
              required: ["word", "ideas"],
            },
          },
          world: {
            type: "object",
            description: "Your notebook: only what is new or changed this time.",
            properties: {
              about: { type: "string" },
              part_about: { type: "string" },
              characters: {
                type: "array",
                items: {
                  type: "object",
                  properties: { name: { type: "string" }, kind: { type: "string" }, facts: { type: "array", items: { type: "string" } }, look: { type: "string", description: "Fixed description for the painter." } },
                  required: ["name", "kind", "facts", "look"],
                },
              },
              places: {
                type: "array",
                items: { type: "object", properties: { name: { type: "string" }, facts: { type: "array", items: { type: "string" } } }, required: ["name", "facts"] },
              },
            },
            required: ["about", "part_about", "characters", "places"],
          },
          picture: {
            type: ["object", "null"],
            properties: {
              kind: { type: "string", enum: ["sketch", "color"] },
              prompt: { type: "string" },
              style: { type: "string" },
              caption: { type: "string" },
            },
            required: ["kind", "prompt", "style", "caption"],
          },
        },
        required: ["quote", "cheer", "questions", "guess", "synonyms", "adjectives", "world", "picture"],
      },
    },
  },
];

type Usage = { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };

/** z.ai error codes worth a second try; everything else fails at once with a plain message. */
const RETRY = new Set(["1302", "1305", "1234", "500"]);
const HINT: Record<string, string> = {
  "1113": "no balance on this key, or a Coding Plan key on the pay-as-you-go endpoint",
  "1311": "this plan does not include the model",
  "1313": "blocked by the plan's fair-use policy",
  "1301": "the text was blocked by the provider's content filter",
};

/** One chat-completions request: retries overload and network blips, and turns every other
 *  failure (bad key, quota, cut-off or blocked reply, an HTML error page) into a readable error. */
async function chat(label: string, body: Record<string, unknown>, timeoutMs: number): Promise<ChatMessage> {
  const key = process.env.GLM_API_KEY;
  if (!key) throw new Error("GLM_API_KEY is not set (put it in .env.local, see .env.example)");
  const started = Date.now();
  for (let attempt = 0; ; attempt++) {
    let retry = false;
    let problem: string;
    try {
      const response = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, stream: false, ...body }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const raw = await response.text();
      let data: { error?: { code?: string | number; message?: string }; choices?: { message?: ChatMessage; finish_reason?: string }[]; usage?: Usage };
      try {
        data = JSON.parse(raw);
      } catch {
        data = { error: { code: String(response.status), message: `answered ${response.status} without JSON` } };
      }
      const choice = data.choices?.[0];
      if (response.ok && !data.error && choice?.message && (choice.finish_reason ?? "stop") !== "length" && choice.finish_reason !== "sensitive" && choice.finish_reason !== "network_error") {
        const usage = data.usage ?? {};
        console.log(`[glm ${label}] ${Date.now() - started}ms  prompt ${usage.prompt_tokens} (cached ${usage.prompt_tokens_details?.cached_tokens ?? 0})  out ${usage.completion_tokens}`);
        return choice.message;
      }
      const code = String(data.error?.code ?? (response.ok ? choice?.finish_reason : response.status));
      retry = RETRY.has(code) || response.status >= 500 || code === "network_error";
      problem =
        code === "length" ? "the reply was cut off (max_tokens too low for this turn)"
        : code === "sensitive" ? HINT["1301"]
        : `${code}: ${HINT[code] ?? data.error?.message ?? response.statusText}`;
    } catch (error) {
      const timeout = error instanceof Error && error.name === "TimeoutError";
      retry = !timeout;
      problem = timeout ? `no answer within ${Math.round(timeoutMs / 1000)}s` : `could not reach ${BASE_URL} (${error instanceof Error ? error.message : error})`;
    }
    if (!retry || attempt >= 2) throw new Error(`GLM ${problem}`);
    await new Promise((r) => setTimeout(r, 800 * 2 ** attempt + Math.random() * 400));
  }
}

/** A small stateless question answered in JSON. */
async function ask(label: string, system: string, user: string, maxTokens: number, timeoutMs = 30_000): Promise<Record<string, unknown>> {
  const message = await chat(
    label,
    {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      thinking: { type: "enabled" },
      reasoning_effort: "low",
      max_tokens: maxTokens, // thinking is counted too, so keep this roomy
    },
    timeoutMs,
  );
  try {
    return JSON.parse(extractJson(String(message.content ?? "")));
  } catch {
    throw new Error(`GLM ${label}: the reply was not JSON`);
  }
}

const short = (v: unknown, max = 80) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Sends the session, returns the reply plus the assistant message to append verbatim.
 *  `toolCallIds` lists every tool call in it: each one needs a tool message before the next turn. */
export async function askGlm(messages: ChatMessage[]): Promise<{ reply: Reply; assistant: ChatMessage; toolCallIds: string[] }> {
  if (process.env.GLM_MOCK) return mock(messages);
  const assistant = await chat(
    "full",
    {
      messages,
      tools: TOOLS,
      tool_choice: "auto", // the only value the API accepts; the prompt requires the call
      thinking: { type: "enabled", clear_thinking: false },
      // "low" answers in 5-15 s; "high" took 16-17 s. Set GLM_EFFORT=high for more thinking.
      reasoning_effort: process.env.GLM_EFFORT ?? "low",
      max_tokens: 6000,
    },
    60_000,
  );
  const calls = (assistant.tool_calls as { id: string; function: { arguments: unknown } }[] | undefined) ?? [];
  // The docs disagree on whether arguments is a JSON string or an object: take both.
  const raw = calls[0] ? calls[0].function.arguments : extractJson(String(assistant.content ?? ""));
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw new Error("GLM full: the tool call was not valid JSON");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("GLM full: empty reply");
  return { reply: tidy(parsed as Record<string, unknown>), assistant, toolCallIds: calls.map((call) => call.id) };
}

export const QUICK_PROMPT = `You are Pip, the fast reaction inside a story-writing app for a 9-year-old. You get the end of the story and its NEWEST sentence. Goal: one reaction and one question that make the child write the next sentence with more detail. Not the goal: correcting language (read through typos, never mention them), praising the writing, suggesting plot, asking what the text already says.
Reply with ONLY compact JSON:
{"quote":"2 to 6 consecutive words copied verbatim from the sentence you react to","cheer":"max 7 words, a listener's reaction to what just happened, specific to this story","question":"max 9 words"}
The question is shown detached from the text: it must name its subject and make sense read alone ("Was it big or small?" fails; "How big was the dragon's egg?" works). Aim it at a gap whose answer is a new sentence: a look, sound, smell or feeling, a why, or a what-happened-next. Prefer open over yes/no. Never repeat or rephrase anything in ALREADY ASKED. In a first-person story the narrator is the child you are talking to: say "you", never their name in the third person. Plain warm words, no emojis.`;

export async function askQuick(storyEnd: string, newest: string, asked: string[]): Promise<{ cheer: string; question: string; quote: string; sent: string }> {
  const sent = `STORY SO FAR:\n${storyEnd}\n\nNEWEST:\n${newest}\n\nALREADY ASKED:\n${asked.join("\n") || "(nothing yet)"}`;
  if (process.env.GLM_MOCK) return { cheer: "Ooh, tell me more!", question: "And then what?", quote: "", sent };
  const reply = await ask("quick", QUICK_PROMPT, sent, 1200, 20_000);
  return { cheer: short(reply.cheer), question: short(reply.question), quote: short(reply.quote), sent };
}

export const WORLD_PROMPT = `You keep a notebook about a story a 9-year-old is writing. You get the whole story, split into numbered parts. Reply with ONLY compact JSON, nothing else:
{"about":"what the whole story is about, max 12 words","parts":["what part 1 is about, max 10 words","part 2 ..."],"characters":[{"name":"as the writer calls them","kind":"girl, dog, owl ...","facts":["2 to 5 words each, looks first (age, breed, colours, clothes), then what they like and do"],"look":"one fixed description for the painter, max 30 words"}],"places":[{"name":"the beach","facts":["weather, colours, sounds, what is there"]}]}
One entry in "parts" per part, in order. Every character and every place in the story. Only facts the writer wrote, never invent. "look" is ONE fixed description the painter uses every single time this character is drawn, so they look the same in every picture (max 30 words): what they are, age, build, hair or fur with colours, face, clothes with colours. Start from what the writer wrote. Where the writer said nothing (hair, clothes), choose something simple that fits and keep it. Once a look is written NEVER change it, unless the writer writes something that changes how the character looks; then change only that detail. If the user message gives LOOKS TO KEEP, copy those looks exactly. If the writer is in the story ("I"), they are a character under the name they gave.`;

/** Writes the whole notebook from scratch from the full story. Not part of the session. */
export async function askWorld(parts: string[], keep: Record<string, string> = {}): Promise<{ world: { about: string; parts: string[]; characters: WorldUpdate["characters"]; places: WorldUpdate["places"] }; sent: string }> {
  const sent = parts.map((part, index) => `PART ${index + 1}:\n${part.trim()}`).join("\n\n") + (Object.keys(keep).length ? `\n\nLOOKS TO KEEP:\n${JSON.stringify(keep)}` : "");
  if (process.env.GLM_MOCK) return { world: { about: "A story", parts: parts.map(() => "Something happens"), characters: [], places: [] }, sent };
  const raw = await ask("notes", WORLD_PROMPT, sent, 3000, 60_000);
  const tidied = tidy({ world: { ...raw, part_about: "" } }).world;
  const lines = (Array.isArray(raw.parts) ? raw.parts : []).map((line: unknown) => short(line, 120));
  return { world: { about: tidied.about, parts: parts.map((_, index) => lines[index] ?? ""), characters: tidied.characters, places: tidied.places }, sent };
}

export const REACTIONS_PROMPT = `You are Pip, the reactive layer of a story-writing app for a 9-year-old. You get one part of their story that has no reactions pinned to it yet. Goal: 2 to 4 reactions on different sentences, each with a question that would make the child go back and add a sentence of detail there. Not the goal: correcting language (read through typos, never mention them), praising the writing, suggesting plot, asking what the text already says.
Reply with ONLY compact JSON:
{"reactions":[{"quote":"2 to 6 consecutive words copied verbatim from the sentence","cheer":"max 7 words, a listener's reaction to what happens in that sentence","question":"max 9 words"}]}
Pick the sentences with the most to unpack; one reaction per sentence. Each question is shown detached from the text: it must name its subject and make sense read alone, and aim at a gap whose answer is a new sentence (a look, sound, smell or feeling, a why, a what-happened-next). Prefer open over yes/no. Nothing from ALREADY ASKED, no two questions alike. In a first-person story the narrator is the child: say "you", never their name. Plain warm words, no emojis.`;

/** Reactions for a part of the story that has none yet (written before Pip was listening). Not part of the session. */
export async function askReactions(partText: string, asked: string[]): Promise<{ reactions: { quote: string; cheer: string; question: string }[]; sent: string }> {
  const sent = `THIS PART OF THE STORY:\n${partText.trim()}\n\nALREADY ASKED:\n${asked.join("\n") || "(nothing yet)"}`;
  if (process.env.GLM_MOCK) return { reactions: [], sent };
  const raw = await ask("reactions", REACTIONS_PROMPT, sent, 1800);
  const reactions = (Array.isArray(raw.reactions) ? raw.reactions : [])
    .map((r: Record<string, unknown>) => ({ quote: short(r?.quote), cheer: short(r?.cheer), question: short(r?.question) }))
    .filter((r: { quote: string; cheer: string }) => r.quote.length >= 4 && r.cheer)
    .slice(0, 4);
  return { reactions, sent };
}

export const PICTURE_PROMPT = `You direct the illustration for ONE part of a story a 9-year-old is writing. A local image model with no memory paints from your prompt alone. You get that part's text and the names of the characters. Reply with ONLY compact JSON:
{"prompt":"two to four concrete English sentences","caption":"max 6 words, playful"}
Stage the scene like a film director, not a list of contents: the image model draws exactly what is stated and guesses the rest badly. Picture the one moment that carries this part, then state for every character: where they are in the frame, body pose, what they are doing with hands or paws, where they are looking (at whom or at what), and their expression. If characters interact, say exactly how (who touches, hands, chases or watches whom, and the other's response). Name the focal point everyone's attention is on, what is in the foreground and background, and the viewpoint (eye level, low angle, close, wide). Nobody stares into empty space: every gaze has a named target.
Constraints: only what happens in this part; nothing from other parts of the story. Call characters by the names given and do not describe what they look like: their fixed looks are appended afterwards. In a first-person story the narrator is in the picture, by name. No art style, no text or letters. Gentle and suitable for a young child.`;

/** A fresh picture prompt for one part of the story, read from that part alone. Not part of the session. */
export async function askPicture(partText: string, notes: unknown): Promise<{ prompt: string; caption: string; sent: string }> {
  const sent = `THIS PART OF THE STORY:\n${partText.trim()}\n\nCHARACTERS AND PLACES:\n${JSON.stringify(notes ?? {})}`;
  if (process.env.GLM_MOCK) return { prompt: "A friendly dog in a sunny park.", caption: "Here we go!", sent };
  const raw = await ask("picture", PICTURE_PROMPT, sent, 1500);
  const prompt = short(raw.prompt, 1000);
  if (prompt.length < 10) throw new Error("GLM picture: no prompt in the reply");
  return { prompt, caption: short(raw.caption, 60), sent };
}

function extractJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON in reply");
  return text.slice(start, end + 1);
}

function tidy(raw: Record<string, unknown>): Reply {
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const ideas = (v: unknown): Idea[] =>
    (Array.isArray(v) ? v : [])
      .map((item) => ({
        word: text(item?.word, 40),
        ideas: (Array.isArray(item?.ideas) ? item.ideas : []).map((i: unknown) => text(i, 30)).filter((idea: string, n: number, all: string[]) => idea && all.indexOf(idea) === n).slice(0, 3),
      }))
      .filter((item) => item.word && item.ideas.length)
      .slice(0, 4);

  const p = raw.picture as Record<string, unknown> | null | undefined;
  const w = (raw.world ?? {}) as Record<string, unknown>;
  const facts = (v: unknown) => (Array.isArray(v) ? v : []).map((fact) => text(fact, 60)).filter(Boolean).slice(0, 14);
  const entries = (v: unknown) => (Array.isArray(v) ? v : []).filter((item) => text(item?.name, 40)).slice(0, 8);
  return {
    world: {
      about: text(w.about, 140),
      part_about: text(w.part_about, 120),
      characters: entries(w.characters).map((c) => ({ name: text(c.name, 40), kind: text(c.kind, 40), facts: facts(c.facts), look: text(c.look, 260) })),
      places: entries(w.places).map((c) => ({ name: text(c.name, 40), facts: facts(c.facts) })),
    },
    quote: text(raw.quote, 80),
    cheer: text(raw.cheer, 80),
    questions: (Array.isArray(raw.questions) ? raw.questions : []).map((q) => text(q, 80)).filter(Boolean).slice(0, 2),
    guess: text(raw.guess, 120),
    synonyms: ideas(raw.synonyms),
    adjectives: ideas(raw.adjectives),
    picture:
      p && text(p.prompt, 10)
        ? {
            kind: p.kind === "color" ? "color" : "sketch",
            prompt: text(p.prompt, 1000),
            style: text(p.style, 120),
            caption: text(p.caption, 60),
          }
        : null,
  };
}

/** Canned replies for working on the app without the API (GLM_MOCK=1). */
function mock(messages: ChatMessage[]) {
  const turn = messages.filter((m) => m.role === "user").length;
  const story = messages
    .filter((m) => m.role === "user")
    .map((m) => String(m.content))
    .join(" ");
  const has = (w: string) => new RegExp(`\\b${w}\\b`, "i").test(story);
  const reply: Reply = {
    quote: "",
    cheer: turn === 1 ? "Ooh, a new story!" : "Wait, what happened next?",
    questions: turn % 2 ? ["Was the dog big?", "Did it look scary?"] : ["What did it smell like?"],
    guess: turn % 2 ? "I bet the dog finds something shiny." : "",
    synonyms: [has("big") && { word: "big", ideas: ["huge", "enormous"] }, has("ran") && { word: "ran", ideas: ["dashed", "zoomed"] }].filter(Boolean) as Idea[],
    adjectives: [has("park") && { word: "park", ideas: ["misty", "noisy"] }].filter(Boolean) as Idea[],
    world: { about: "A dog has an adventure", part_about: "The start", characters: turn === 1 ? [{ name: "the dog", kind: "dog", facts: ["likes shiny things"] }] : [], places: [] },
    picture:
      turn === 1
        ? { kind: "sketch", prompt: "A big shaggy dog running through a park with tall trees", style: "loose pencil sketch", caption: "Here comes the dog!" }
        : turn === 2
          ? { kind: "color", prompt: "A big shaggy brown dog running through a sunny park with tall trees", style: "soft watercolour and coloured pencil", caption: "Zoom!" }
          : null,
  };
  const id = `mock_${turn}`;
  const assistant: ChatMessage = {
    role: "assistant",
    content: "",
    tool_calls: [{ id, type: "function", function: { name: "respond", arguments: JSON.stringify(reply) } }],
  };
  return new Promise<{ reply: Reply; assistant: ChatMessage; toolCallIds: string[] }>((resolve) =>
    setTimeout(() => resolve({ reply, assistant, toolCallIds: [id] }), 900),
  );
}
