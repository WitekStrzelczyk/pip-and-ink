"use client";

import { useEffect, useRef, useState } from "react";

/** Style sandbox: one scene, many illustration styles, side by side. Pick one for the stories. */

const SCENE =
  "Mia, a nine-year-old girl, stands on a sunny sandy beach with Biscuit, a two-year-old tri-colour border collie. Mia has just thrown a stick toward the medium ocean-blue waves and Biscuit races ahead chasing it, tail flying. Surfers bob on the waves in the distance, large birds circle overhead, and a faint whale spout shows far on the horizon under a bright sunny sky.";

const ENDING = "Gentle and friendly, no text, no letters.";

const STARTERS: { name: string; style: string }[] = [
  { name: "Watercolour + pencil", style: "Cheerful watercolour with coloured pencil, bright sunny colours. Children's picture book illustration, warm light, rich detail" },
  { name: "Ink line + wash", style: "Loose scratchy black ink line drawing with quick watercolour washes, lots of white paper showing, lively and wobbly, classic British children's book illustration" },
  { name: "Bold gouache", style: "Bold gouache painting with flat shapes and thick visible brush strokes, strong simple colours, modern children's picture book illustration" },
  { name: "Cut-paper collage", style: "Cut-paper collage illustration made from hand-painted textured tissue paper, simple big shapes, bright colours on white, children's picture book" },
  { name: "Soft pastel", style: "Soft chalk pastel drawing on textured paper, dreamy smudged edges, glowing warm light, tender children's picture book illustration" },
  { name: "Wax crayon", style: "Wax crayon and felt-tip drawing as if made by a talented child, waxy texture, wobbly outlines, joyful bright colours on white paper" },
  { name: "Retro screen print", style: "Mid-century retro children's book illustration, screen print look with a limited palette of four flat colours, simple geometric shapes, grainy texture" },
  { name: "Flat modern", style: "Modern flat digital illustration, clean rounded shapes, soft gradients, limited pastel palette, contemporary picture book style" },
  { name: "Cosy painterly", style: "Cosy painterly digital illustration with soft brush texture, rich warm light and gentle shadows, detailed storybook scene like an animated film background" },
  { name: "Coloured pencil only", style: "Detailed coloured pencil drawing on cream paper, fine hatching, soft layered colours, delicate and realistic, classic nature storybook illustration" },
  { name: "Clay figures", style: "Handmade plasticine clay figures photographed on a miniature set, soft studio light, stop-motion children's animation look" },
  { name: "Comic adventure", style: "Clear-line comic book illustration with clean black outlines and flat bright colours, European adventure comic for children" },
  { name: "1970s comic", style: "1970s American comic book panel, bold black inking, visible halftone dots, slightly off-register four-colour printing on yellowed newsprint, retro and punchy" },
  { name: "Modern comic", style: "Modern comic book illustration, confident dynamic inking, vivid digital colouring with gradients and rim light, dramatic cinematic angle" },
  { name: "Sunday comic strip", style: "Newspaper Sunday comic strip cartoon, simple round characters, thick black outlines, flat cheerful colours, funny and warm" },
  { name: "Graphic novel", style: "Quiet graphic novel illustration, fine ink lines with muted watercolour tones, thoughtful mood, soft limited palette" },
  { name: "Manga (black and white)", style: "Black and white manga page illustration, clean pen lines, screentone shading, expressive big eyes, speed lines in the background" },
  { name: "Manga colour", style: "Colour manga cover illustration, crisp line art, cel shading, bright saturated colours, energetic adventure series look" },
  { name: "Anime film", style: "Hand-painted Japanese animated film still, lush detailed painted background, soft natural light, simple expressive characters, nostalgic and peaceful" },
  { name: "Chibi kawaii", style: "Kawaii chibi illustration, tiny bodies with big heads and sparkling eyes, pastel colours, soft rounded shapes, very cute" },
  { name: "3D animated film", style: "Modern 3D animated family film still, soft rounded characters, subsurface skin glow, cinematic sunny lighting, shallow depth of field" },
  { name: "Low-poly 3D", style: "Low-poly 3D illustration made of flat faceted triangles, bright simple colours, soft ambient light, playful video game look" },
  { name: "Pixel art", style: "16-bit pixel art scene, crisp chunky pixels, limited bright palette, retro adventure video game" },
  { name: "Pop art", style: "Pop art illustration, thick black outlines, Ben-Day dots, flat primary colours, bold and loud" },
  { name: "1950s storybook", style: "Vintage 1950s children's storybook illustration, soft gouache, rosy cheeks, gentle muted colours, slightly faded printed paper" },
  { name: "Art nouveau poster", style: "Art nouveau poster illustration, elegant flowing outlines, decorative border of waves and shells, soft flat colours with gold accents" },
  { name: "Linocut print", style: "Hand-carved linocut print, bold chunky shapes, visible carving marks, three ink colours on cream paper" },
  { name: "Japanese woodblock", style: "Traditional Japanese woodblock print, flat colour areas, fine black outlines, stylised curling waves, soft graded sky" },
  { name: "Risograph", style: "Two-colour risograph print in coral and teal, grainy texture, overlapping misregistered layers, simple modern shapes" },
  { name: "Layered papercut", style: "Layered paper cut diorama, many sheets of coloured card stacked with soft shadows between the layers, handmade craft look" },
  { name: "Felt and wool", style: "Needle-felted wool figures on a felt landscape, fuzzy soft fibres, handmade toy look, warm studio photo" },
  { name: "Stained glass", style: "Stained glass window illustration, thick dark lead lines, glowing jewel-coloured glass pieces, light shining through" },
  { name: "Chalkboard", style: "Coloured chalk drawing on a dark green chalkboard, dusty soft lines, smudges, simple and charming" },
  { name: "Ballpoint doodle", style: "Blue ballpoint pen doodle on lined notebook paper, quick hatching, wobbly lines, a few felt-tip colour accents" },
  { name: "Marker sketch", style: "Alcohol marker sketch, confident loose black fineliner lines, bright marker fills with visible streaks, white paper showing through" },
  { name: "Oil painting", style: "Classic oil painting with thick visible impasto brush strokes, glowing afternoon light, rich colours, like a seaside painting in a museum" },
  { name: "Scandinavian folk", style: "Scandinavian folk art illustration, simple flat figures, decorative patterns, muted mustard, teal and red palette" },
  { name: "Victorian engraving", style: "Victorian storybook engraving, fine black cross-hatching, delicate hand-tinted colour, antique paper" },
];

type Shot = { file: string; ms: number; prompt: string; size: number; steps: number; seed: number };
type Card = { id: string; name: string; style: string; file?: string; ms?: number; busy?: boolean; error?: string; shots?: Shot[] };

/** Every style is drawn once per step count, to compare quality against speed. */
const STEP_SET = [2, 3, 4, 5];

const fresh = (): Card[] => STARTERS.map((s) => ({ id: `s-${s.name}`, ...s }));

/** Styles added to the starter list later show up in an existing experiment too. */
const withNewStarters = (cards: Card[]): Card[] => [
  ...cards,
  ...STARTERS.filter((s) => !cards.some((c) => c.name === s.name)).map((s) => ({ id: `s-${s.name}`, ...s })),
];

export default function Sandbox() {
  const [scene, setScene] = useState(SCENE);
  const [cards, setCards] = useState<Card[]>(fresh);
  const [size, setSize] = useState(512);
  const [seed, setSeed] = useState(744035);
  const [house, setHouse] = useState("");
  const [running, setRunning] = useState(false);
  const [ready, setReady] = useState(false);
  /** The card under the pointer and the step count its pointer position selects. */
  const [hover, setHover] = useState<{ id: string; steps: number } | null>(null);
  const stop = useRef(false);
  const loaded = useRef(false);
  const latest = useRef<Card[]>(cards);
  latest.current = cards;

  // The experiment is stored on the server (data/sandbox/state.json), pictures in data/pictures.
  useEffect(() => {
    (async () => {
      const saved = await (await fetch("/api/sandbox/state")).json();
      if (saved && Array.isArray(saved.cards)) {
        if (typeof saved.scene === "string") setScene(saved.scene);
        setCards(withNewStarters(saved.cards.map((c: Card) => ({ ...c, busy: false, shots: c.shots ?? [] }))));
        if (Number.isFinite(saved.size)) setSize(saved.size);
        if (Number.isFinite(saved.seed)) setSeed(saved.seed);
      }
      loaded.current = true;
      setReady(true);
    })();
    fetch("/api/sandbox/style").then((r) => r.json()).then((s) => setHouse(s.color));
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    const timer = setTimeout(() => {
      void fetch("/api/sandbox/state", { method: "PUT", body: JSON.stringify({ scene, cards: cards.map((c) => ({ ...c, busy: false })), size, seed }) });
    }, 400);
    return () => clearTimeout(timer);
  }, [scene, cards, size, seed, ready]);

  const patch = (id: string, change: Partial<Card> | ((card: Card) => Partial<Card>)) =>
    setCards((all) => all.map((c) => (c.id === id ? { ...c, ...(typeof change === "function" ? change(c) : change) } : c)));
  const promptFor = (card: Card) => `${scene.trim()} ${card.style.trim().replace(/\.$/, "")}. ${ENDING}`;

  /** The newest picture of this style at the current size and seed with that many steps.
   *  (Pictures recovered from before prompts were recorded have an empty prompt and still count.) */
  const shotAt = (card: Card, steps: number) =>
    card.shots?.findLast((shot) => shot.steps === steps && shot.size === size && shot.seed === seed && (!shot.prompt || shot.prompt === promptFor(card)));

  const drawOne = async (card: Card, steps: number) => {
    patch(card.id, { busy: true, error: undefined });
    try {
      const prompt = promptFor(card);
      const response = await fetch("/api/sandbox", { method: "POST", body: JSON.stringify({ prompt, size, steps, seed }) });
      const body = await response.json();
      if (body.error) patch(card.id, { busy: false, error: body.error });
      // Every picture is kept in the card's history.
      else patch(card.id, (c) => ({ busy: false, shots: [...(c.shots ?? []), { file: body.file, ms: body.ms, prompt, size, steps, seed }] }));
    } catch (error) {
      patch(card.id, { busy: false, error: String(error) });
    }
  };

  /** Draws a style at every step count; with onlyMissing, just the ones it does not have yet. */
  const drawCard = async (id: string, onlyMissing: boolean) => {
    for (const steps of STEP_SET) {
      if (stop.current) return;
      const card = latest.current.find((c) => c.id === id);
      if (!card || !card.style.trim()) return;
      if (onlyMissing && shotAt(card, steps)) continue;
      await drawOne(card, steps); // one at a time: the painter draws a single picture at once
    }
  };

  const drawAll = async (onlyMissing: boolean, only?: string) => {
    setRunning(true);
    stop.current = false;
    for (const id of only ? [only] : cards.map((c) => c.id)) {
      if (stop.current) break;
      await drawCard(id, onlyMissing);
    }
    setRunning(false);
  };

  const useForStories = async (style: string) => {
    const response = await fetch("/api/sandbox/style", { method: "PUT", body: JSON.stringify({ color: style }) });
    setHouse((await response.json()).color);
  };

  /** Left edge of the picture = fewest steps, right edge = most. */
  const stepsUnder = (event: React.PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const zone = Math.floor(((event.clientX - box.left) / box.width) * STEP_SET.length);
    return STEP_SET[Math.min(STEP_SET.length - 1, Math.max(0, zone))];
  };

  const missing = cards.reduce((n, card) => n + (card.style.trim() ? STEP_SET.filter((steps) => !shotAt(card, steps)).length : 0), 0);
  const hovered = hover && cards.find((c) => c.id === hover.id);
  const zoomed = hovered ? shotAt(hovered, hover!.steps) : undefined;

  return (
    <main className="lab">
      <header>
        <h1>Style sandbox</h1>
        <a href="/">back to the story</a>
      </header>

      <label className="lab-field">
        <span>The scene (same for every style)</span>
        <textarea value={scene} onChange={(e) => setScene(e.target.value)} rows={4} />
      </label>

      <div className="lab-bar">
        <label>
          size
          <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
            {[384, 512, 640, 768].map((s) => (
              <option key={s} value={s}>{s}px</option>
            ))}
          </select>
        </label>
        <label>
          seed
          <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
        </label>
        <button type="button" className="lab-go" disabled={running || !missing} onClick={() => drawAll(true)}>
          {running ? "drawing…" : missing ? `Draw ${missing} missing pictures` : "Everything is drawn"}
        </button>
        <button type="button" disabled={running} onClick={() => confirm(`Redraw every style at ${STEP_SET.join(", ")} steps? Old pictures are kept.`) && drawAll(false)}>
          Redraw all
        </button>
        {running && (
          <button type="button" onClick={() => (stop.current = true)}>
            Stop
          </button>
        )}
        <button type="button" onClick={() => setCards((all) => [...all, { id: `c${Date.now()}`, name: "My style", style: "", shots: [] }])}>
          + Add style
        </button>
      </div>

      <p className="lab-house">
        Each style is drawn at {STEP_SET.join(", ")} steps. Move the pointer across a picture, left to right, to compare them at full size.
        <br />
        Stories use: <strong>{house || "whatever style GLM picks for each picture"}</strong>
        {house && (
          <button type="button" onClick={() => useForStories("")}>
            let GLM pick again
          </button>
        )}
      </p>

      <section className="lab-grid">
        {cards.map((card) => {
          const active = hover?.id === card.id ? hover.steps : null;
          // Shown in the card: the step count under the pointer, otherwise the best one drawn.
          const shown = (active && shotAt(card, active)) || [...STEP_SET].reverse().map((steps) => shotAt(card, steps)).find(Boolean) || card.shots?.at(-1);
          return (
            <article key={card.id} className={house && house === card.style ? "chosen" : ""}>
              <div
                className="lab-pic"
                onPointerMove={(e) => {
                  const steps = stepsUnder(e);
                  if (hover?.id !== card.id || hover.steps !== steps) setHover({ id: card.id, steps });
                }}
                onPointerLeave={() => setHover(null)}
              >
                {shown && <img src={`/api/picture/${shown.file}`} alt={card.name} />}
                {card.busy && <span className="lab-busy">drawing…</span>}
                {!shown && !card.busy && <span className="lab-empty">not drawn yet</span>}
                <div className="lab-steps">
                  {STEP_SET.map((steps) => {
                    const shot = shotAt(card, steps);
                    return (
                      <span key={steps} className={`${shot ? "" : "none"} ${active === steps ? "on" : ""}`}>
                        {steps}
                        {shot && shot.ms > 0 && <small>{(shot.ms / 1000).toFixed(1)}s</small>}
                      </span>
                    );
                  })}
                </div>
              </div>
              <input className="lab-name" value={card.name} onChange={(e) => patch(card.id, { name: e.target.value })} aria-label="Style name" />
              <textarea value={card.style} onChange={(e) => patch(card.id, { style: e.target.value })} rows={4} placeholder="Describe the style…" aria-label="Style description" />
              {card.error && <p className="lab-error">{card.error}</p>}
              <div className="lab-actions">
                <button type="button" disabled={card.busy || running || !card.style.trim()} onClick={() => drawAll(false, card.id)}>
                  {shown ? "Redraw" : "Draw"}
                </button>
                <button type="button" disabled={!card.style.trim()} onClick={() => useForStories(card.style)}>
                  {house && house === card.style ? "Used for stories" : "Use for stories"}
                </button>
                <button type="button" onClick={() => confirm(`Remove "${card.name}"? Its pictures stay on disk.`) && setCards((all) => all.filter((c) => c.id !== card.id))} aria-label={`Remove ${card.name}`}>
                  ✕
                </button>
                <small>{card.shots?.length ?? 0} kept</small>
              </div>
            </article>
          );
        })}
      </section>

      {hovered && (
        <div className="lab-zoom" aria-hidden>
          <figure>
            {/* natural size: one picture pixel per CSS pixel */}
            {zoomed ? <img src={`/api/picture/${zoomed.file}`} alt="" /> : <div className="lab-zoom-none" style={{ width: size, height: size }}>not drawn at {hover!.steps} steps yet</div>}
            <figcaption>
              <strong>{hovered.name}</strong>
              {STEP_SET.map((steps) => (
                <span key={steps} className={steps === hover!.steps ? "on" : ""}>
                  {steps} steps
                </span>
              ))}
              {zoomed && zoomed.ms > 0 && <em>{(zoomed.ms / 1000).toFixed(1)}s</em>}
            </figcaption>
          </figure>
        </div>
      )}
    </main>
  );
}
