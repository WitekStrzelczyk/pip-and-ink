# Pip & Ink

A story-writing app for young writers. A child types a story on a clean page; a playful
listener called Pip reacts to what happens in it, asks short questions, offers better
words, and a local image model illustrates each part of the story.

It runs on your own Mac. The story text goes to a language model (z.ai GLM) for Pip's
replies; the pictures are painted locally with FLUX.2 klein on Apple Silicon.

> Working title and first version. Built for one nine-year-old; expect rough edges.

## What it does

- **A page to write on**: large serif type, autosave, nothing else in the way.
- **Pip's reactions**: a pair of peeking eyes sits on a sentence; click it for a short
  reaction and a question that invites one more sentence of detail.
- **Word ideas**: synonyms and adjectives are scribbled above words. Click one to swap it
  in; click the old word to swap it back.
- **Parts and pictures**: a long story is split into parts (a blank line after about 60
  words starts a new one). Each part gets its own picture, first as a pencil sketch and
  then in colour, staged like a film shot: who is where, doing what, looking at whom.
  Pictures swap as you scroll.
- **Pip's notebook**: click Pip to see what the model has understood: what the story is
  about, each part, every character and place. Each character has one fixed "look" that is
  sent with every picture so they stay the same from picture to picture.
- **Bookshelf** (`/stories`): all stories with their pictures as covers, grouped by when
  they were last written in. Every story has its own address, `/story/<title>-<code>`.
- **History** (`/history`): every version of the text, everything sent to the language
  model and what came back, and every picture, with a slider to rewind.
- **Style sandbox** (`/sandbox`): paint one scene in 38 illustration styles at 2 to 5
  steps and pick the house style for all stories.

## Requirements

- macOS on Apple Silicon. The image model runs through [MLX](https://github.com/ml-explore/mlx).
  It was developed on a 24 GB machine; 16 GB is likely tight.
- [Bun](https://bun.sh) 1.4 or newer.
- [mflux](https://github.com/filipstrand/mflux) installed as a uv tool: `uv tool install mflux`.
- A [z.ai](https://z.ai) API key with access to `glm-5.3-flash`.

## Setup

```bash
bun install
```

```bash
cp .env.example .env.local
```

Put your key in `.env.local` as `GLM_API_KEY`. Use a pay-as-you-go key: the app calls the
standard endpoint `https://api.z.ai/api/paas/v4`. z.ai's Coding Plan has a separate
endpoint, but its terms reserve that quota for supported coding tools, not for calls from
your own application.

Save a 4-bit copy of the image model once (about 4 GB on disk; the first run downloads the
full weights from Hugging Face):

```bash
mflux-save --model flux2-klein-4b --quantize 4 --path models/flux2-klein-4b-q4
```

Without this step the app still works, but quantizes the model on every start, which is slow.

## Run

```bash
bun run dev
```

Open http://localhost:3000. The painter process starts on its own the first time a story
is opened and keeps the model in memory. It keeps running after you stop the app, so the
next start is instant; to free the memory:

```bash
pkill -f painter/worker.py
```

Other scripts:

| Script | What it does |
| --- | --- |
| `bun run dev:mock` | Runs without a z.ai key; Pip gives canned replies. |
| `bun run dev:keychain` | Reads the key from [envchain](https://github.com/sorah/envchain); set `GLM_KEYCHAIN` to your namespace. |
| `bun run typecheck` | Type-checks the project. |
| `./gen.sh "a prompt"` | Paints one image from the command line. |

## How it works

| Piece | Where |
| --- | --- |
| Writer page: text area with a mirrored overlay that carries the scribbles | `app/writer.tsx` |
| When to call the model, merging its replies, drawing | `lib/coach.ts` |
| Prompts and calls to GLM | `lib/glm.ts` |
| How a story is split into parts | `lib/parts.ts` |
| Talking to the painter | `lib/painter.ts`, `painter/worker.py` |
| Stories on disk, live events | `lib/store.ts`, `app/api/story/[id]/` |
| Append-only history | `lib/history.ts` |

Two kinds of model call keep it responsive: a quick reaction after each sentence (about
2 seconds) and a fuller turn every couple of sentences that returns word ideas, notebook
updates and picture direction (about 5 to 15 seconds). The fuller turn is one growing
conversation, sent back unchanged each time so the provider's prompt cache applies.

Measured on an M5 with 24 GB: a 512 px picture takes about 7 seconds at 3 steps and 9
seconds at 4 steps with the 4-bit model.

## Your data

Everything the app writes stays in `data/`, which is not committed:

- `data/stories/` one JSON file per story
- `data/pictures/` every picture ever drawn (nothing is deleted)
- `data/history/` the full history of each story
- `data/style.json`, `data/sandbox/` the house style and the style experiments
- `data/trace/`, `data/painter.log` debugging logs

Story text is sent to z.ai to get Pip's replies, under z.ai's terms; decide whether that
is acceptable for the child whose stories these are. Pictures never leave the machine.

There are no accounts and no sign-in. The app therefore listens on `localhost` only and
refuses requests addressed to any other host or coming from another website. To open it
from another device on purpose, start it on that interface yourself and list the address
in `ALLOWED_HOSTS`; anyone who can reach it can then read and edit every story.

## Models and licences

This repository contains no model weights. FLUX.2 klein 4B is published by Black Forest
Labs under Apache 2.0; GLM is used under z.ai's terms. The code here is MIT.
