# Directions

What this project is for, what we are trying to land, and the decisions that got it here.
Read this before changing how Pip behaves or how pictures are made.

## The concept

A nine-year-old sits down to write a story. The page is clean and the type is large.
Beside them is Pip, a listener who is *in* the story: Pip reacts to what just happened,
asks one short question that makes the next sentence richer, scribbles better words above
plain ones, and draws the story as it grows.

The child stays the author. Pip never writes the story, never corrects it, and never
covers it up.

## What we are trying to land

1. **The child keeps writing.** Every reaction, question and picture exists to pull out
   one more sentence.
2. **The writing gets richer by the child's own choice.** Stronger verbs, specific nouns,
   adjectives, sensory detail, feelings, reasons. A hint is only a success if the child
   picks it; a question only if they answer it in the story.
3. **The story becomes a picture book as it is written.** Each part gets an illustration
   that shows what that part says, with the same characters in every picture.
4. **It feels like play.** Handwriting, a peeking creature, photos taped to the page.
   It must never feel like homework or a spell-checker.
5. **It is fast enough to feel alive.** A reaction within a couple of seconds of a
   sentence; a picture within about ten.

## What we are not building

- A grammar or spelling checker. Mistakes are read through and never mentioned.
- A story generator. Pip does not propose plot, sentences or endings.
- A praise machine. "Great job" teaches nothing; Pip reacts to events, not to the writer.
- A quiz. No comprehension questions, no questions the text already answers.
- A product with accounts, sharing or cloud storage. It runs on one trusted computer.

## How it works, and why

### Two speeds of listening

- A **quick reaction** after every sentence: a tiny stateless call, about 2 seconds.
- A **full turn** every couple of sentences, after about 30 new words, or after a
  5-second pause following an edit: word ideas, notebook updates, picture direction.

The full turn is one growing conversation that is only ever appended to and sent back
unchanged, so the provider's prompt cache and preserved thinking apply. The model gets
only what changed, not the whole story each time.

*Why:* one slow, thorough call per sentence felt dead; one fast, shallow call missed
important changes (adding "border collie" to an old sentence must redraw the dog).

### Structured replies through a tool call

The model answers only by calling one tool, so every field arrives as JSON the app can
render: where to pin a reaction, which word a hint belongs to, what to draw.

### Reactions live on the sentence

Pip's reactions are not a chat. A pair of peeking eyes sits on the last word of the
sentence the reaction is about; clicking opens a cloud with the reaction and a question.

- The model returns a short **quote** from the sentence it reacts to, and the app pins
  the reaction there. Before this, reactions landed one sentence early and made no sense.
- A **question must name its subject** and read correctly on its own, because it is
  shown detached from the text ("Was it big or small?" fails).
- Parts written before Pip was listening get reactions later, a few per part.

*Why:* notes in the margin compete with the story; notes on the sentence are found when
the child pauses and looks back, and they do not obscure anything until clicked.

### Word ideas that can be tried on

Synonyms and adjectives are handwritten above the word. Clicking a synonym swaps it
with the child's word; the child's own word stays in reach, marked, so the swap can be
undone or rotated. Ideas must keep the meaning, tense and word class so they drop
straight into the sentence. When ideas would overlap, the nearest to the cursor speaks
and the rest wait as an underline.

*Why:* a child should be able to try a word, hear how it reads, and take it back
without fear.

### Parts, one picture each

A story is split into parts: a blank line starts a new one once the part before it has
about 60 words. Each part has exactly one picture, sketched in pencil first and then
redrawn in colour as details arrive. Scrolling swaps the picture to the part on screen.

*Why:* one picture for a whole story goes stale and gets polluted with later events;
one per paragraph is too many to draw and too small to illustrate.

### The notebook is the source of truth for pictures

The model keeps a small JSON notebook: what the story is about, what each part is
about, and every character and place with the facts the child wrote. It is fed back on
every full turn, shown to the child (click Pip), and logged, so it can be read, diffed
and debugged.

Each character carries one fixed **look**. The model starts from the child's facts,
fills the gaps once (hair, clothes), and may not change it unless the child changes how
the character looks. The image prompt is assembled by the app: the model stages the
scene using names only, and the app appends the look of everyone named.

*Why:* the image model has no memory. Left to describe characters afresh each time, the
girl wore red in one picture and blue in the next.

### Pictures are directed, not listed

The model writes the scene like a film director: the one moment that carries the part,
and for every character where they are, their pose, what they are doing, where they are
looking and at whom, and how they interact. Every gaze has a target. Only the part
being drawn may appear in its picture.

*Why:* a list of contents ("a girl, a dog, turtles") produced a dog staring into space.

### One house style

The style sandbox paints one scene in many styles and step counts. The style picked there
is applied to every colour picture, so a whole story looks like one book. Until one is
picked, the model's own style suggestion is used.

### Nothing is lost

Every version of the text, everything sent to the model and what came back, every
notebook change and every picture is appended to a per-story history and never
rewritten. Old pictures are never deleted. The history page rewinds a story moment by
moment.

*Why:* this is a child's work, and it is also how we debug why a picture or a question
came out the way it did.

## Working principles

### How we build prompts for the language model

The model is capable. A prompt explains the job; it does not walk the model through it.

1. **Say what the app is and how the reply is used.** Each field is rendered somewhere
   (pinned to a sentence, shown detached in the margin, sent to a painter with no
   memory). Most bad output came from the model not knowing where its words would land.
2. **State the goal as an observable result.** "A turn succeeded if the child adds a
   sentence because of your question" steers better than any list of rules.
3. **State what is not the goal.** Correction, authorship, praise and testing are named
   and excluded, each with the reason. Without this the model drifts into all four.
4. **One dense line per output field.** Limits, source ("copied verbatim from the
   story"), and the constraint the app depends on. No step-by-step coaching.
5. **Give a reason with every constraint.** "The painter has no memory, so..." survives
   edge cases that a bare "always" does not.
6. **One failing and one passing example, only where a rule is easy to misread.**
   Examples are neutral, never taken from a real child's story.
7. **Describe what to produce, not what to avoid**, wherever that is possible.
8. **Give the model its own state back.** The notebook, the questions already asked and
   the text of the part being drawn travel with every turn. The model should never have
   to remember what the app can tell it.
9. **Ask for evidence the app can check.** A quote pins a reaction; a word must appear in
   the text; a look may only change together with a fact. The app verifies and drops
   what does not hold.
10. **When output is wrong, find what the model was not told.** Fix the prompt or the
    data it receives, then regenerate. Results are never patched by hand.
11. **Split by job, not by size.** The conversation carries only the turn that needs
    memory. Reactions, notebook rebuilds and picture prompts are separate stateless
    calls with their own short prompt.

### Working with the language model (z.ai GLM)

- **One growing conversation, append-only.** The system prompt comes first and every
  earlier message is sent back byte for byte, including the model's reasoning, because
  the provider's cache and its preserved thinking both depend on an identical prefix.
  When the conversation gets too long it restarts from the whole story plus the notebook.
- **Thinking stays at the lowest setting the model accepts.** It cannot be turned off on
  this model. Thinking tokens count against the reply limit, so limits are generous.
- **Structured output through one tool call**; the API offers no schema-enforced output,
  so every field is validated and trimmed before use, and a reply that fails is dropped
  rather than half-applied.
- **Failures are told apart.** Overload and network errors are retried with backoff.
  A bad key, an exhausted quota, a cut-off or blocked reply fail at once with a message a
  person can act on. After a failure the app waits longer each time and only tries again
  when the child writes again; an idle page never calls the API.
- **Use the pay-as-you-go endpoint.** The provider's coding subscription is licensed for
  coding tools, not for calls from an app.
- **Nothing identifying is sent beyond the story itself.** No account, no user id. The
  story text does go to the provider; that is a decision for the adult running the app.

### Working with the image model (FLUX.2 klein on MLX)

- **One long-lived worker** keeps the 4-bit model in memory; loading it per picture
  would cost more than painting. Memory is the real speed limit, so the worker frees
  MLX's buffer cache after every picture.
- **Use the model as trained:** 4 steps, guidance 1.0, its default scheduler. Three
  steps is enough for a pencil sketch. More steps or guidance do not help a distilled
  model.
- **Prose, subject first.** The model weighs early words most: the staged scene comes
  first, then each named character's fixed look, then style, then mood.
- **No negative prompts.** The model has none, and naming the unwanted thing can summon
  it. The prompt says what the picture is.
- **The same words give the same character.** Looks are stored once and appended by the
  app, never rewritten by the language model per picture.
- **Image-to-image is not used.** With four steps it keeps a few percent of the source
  image; it cannot "colour in" a sketch. A colour picture is painted fresh.
- **The worker trusts nobody.** It listens on localhost, needs a secret only the app
  knows, writes only PNG files into the pictures folder, and clamps every number.

### Working with the code

- **The story file is the product.** Writes are queued per story and land whole (write
  beside, then rename). A file that cannot be read is an error, never an empty story.
- **History is append-only** and is how we debug: every prompt and reply is in it.
- **The model's reply is untrusted input.** It is parsed, validated, capped and rendered
  as text only.
- **One model call and one paint job at a time per story.** Everything else waits or is
  remembered for when the running one ends.
- **Local by construction.** The server binds to localhost and refuses requests
  addressed to other hosts or coming from other sites, because there is no sign-in.
- **No personal data in the repository.** Stories, pictures and logs live in `data/`,
  which is ignored. Examples in code and prompts are invented.
- **Check with the real thing.** A change to prompts or pictures is tested on a story,
  and the picture is looked at, before it is called done.

## Open questions

- **Reference images for characters.** The image model can take up to four reference
  pictures. One reference per character, reused in every scene, is the likely fix for
  faces that still drift; it needs a trial for speed and memory.
- **Streaming the full turn**, so the reaction and questions show while the long fields
  are still being written.
- **Pictures are tied to a part's number.** Merging or splitting parts by editing can
  leave a picture on the wrong part until it is redrawn.
- Hand-editing a character's look, for when the model's first guess is not the child's.
- Fixed looks for places, not only characters.
- Answering Pip inside the cloud instead of only in the story.
- The margin still repeats the latest reaction that the clouds already carry.
- History files keep whole versions of the text and grow quickly on long stories.
- Pictures at 512 px leave little room for faces; larger sizes are much slower here.
