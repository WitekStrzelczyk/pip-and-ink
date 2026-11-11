"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { newStoryId, storyPath } from "@/lib/links";
import { MIN_PART_WORDS, partAt, partStarts as findPartStarts } from "@/lib/parts";
import type { Notes, Picture, Reaction, StoryEvent, WordIdea, World } from "@/lib/store";

type Mark = { key: string; type: "syn" | "adj" | "cheer"; start: number; end: number; ideas: string[]; question?: string; was?: string; /** Too close to another idea: only underlined until the cursor comes by. */ quiet?: boolean };
type Swap = Pick<WordIdea, "id" | "word" | "ideas" | "nth" | "was">;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where in the text every remembered word idea belongs. Newer ideas win when two would collide. */
function findMarks(text: string, ideas: WordIdea[], used: Set<string>, reactions: Reaction[], caret: number): Mark[] {
  const marks: Mark[] = [];
  // Pip's reactions sit at the end of the sentence they are about (zero width, drawn above).
  for (const reaction of reactions) {
    const at = text.lastIndexOf(reaction.anchor);
    if (at < 0) continue; // that sentence was rewritten
    const end = at + reaction.anchor.length;
    marks.push({ key: reaction.id, type: "cheer", start: end, end, ideas: [reaction.text], question: reaction.question });
  }
  const wordMarks: Mark[] = [];
  for (const idea of [...ideas].reverse()) {
    if (used.has(idea.id)) continue;
    const found = [...text.matchAll(new RegExp(`(?<![\\w'])${escape(idea.word)}(?![\\w'])`, "gi"))];
    const match = found[Math.min(idea.nth, found.length) - 1];
    if (match?.index === undefined) continue; // the word is gone from the story
    const start = match.index;
    const end = start + idea.word.length;
    if (wordMarks.some((other) => start < other.end && end > other.start)) continue; // same word twice: newest wins
    wordMarks.push({ key: idea.id, type: idea.type, start, end, ideas: idea.ideas, was: idea.was });
  }
  // Scribbles must not land on top of each other. The word under the cursor speaks first, then the
  // newest ideas; a neighbour that would collide stays quiet (underlined only) until the cursor visits.
  const near = (mark: Mark) => caret >= mark.start && caret <= mark.end;
  const shown: Mark[] = [];
  for (const mark of [...wordMarks].sort((a, b) => Number(near(b)) - Number(near(a)))) {
    const room = (other: Mark) => 5 + 3.5 * (mark.ideas.length + other.ideas.length);
    // Pip's eyes sit on the last word of a sentence: an idea for that word waits for the cursor.
    const underPip = !near(mark) && marks.some((other) => other.type === "cheer" && other.start >= mark.start - 2 && other.start <= mark.end + 9);
    mark.quiet = underPip || shown.some((other) => mark.start < other.end + room(other) && mark.end > other.start - room(other));
    if (!mark.quiet) shown.push(mark);
    if (!mark.quiet || mark.type === "syn") marks.push(mark);
  }
  return marks.sort((a, b) => a.start - b.start);
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** Counts up while something is in progress. */
function useStopwatch(running: boolean) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Date.now() - started), 100);
    return () => clearInterval(timer);
  }, [running]);
  return elapsed;
}

/** Puts the chosen idea into the story, minding capitals and a/an. */
function applyIdea(text: string, mark: Mark, idea: string): { text: string; cursor: number; start: number } {
  const original = text.slice(mark.start, mark.end);
  const capital = /^[A-Z]/.test(original);
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  let before = text.slice(0, mark.start);
  let middle: string;
  if (mark.type === "syn") {
    middle = capital ? cap(idea) : idea;
  } else {
    const startsSentence = capital && /(^|[.!?]\s+|\n)$/.test(before);
    middle = startsSentence ? `${cap(idea)} ${original[0].toLowerCase()}${original.slice(1)}` : `${idea} ${original}`;
  }
  // "a dog" -> "an enormous dog", "an apple" -> "a shiny apple"
  const article = before.match(/\b(a|an)(\s+)$/i);
  if (article) {
    const vowel = /^[aeiou]/i.test(middle);
    const fixed = (vowel ? "an" : "a").replace(/^a/, article[1][0]);
    before = before.slice(0, before.length - article[0].length) + fixed + article[2];
  }
  return { text: before + middle + text.slice(mark.end), cursor: before.length + middle.length, start: before.length };
}

export default function Writer({ storyId }: { storyId: string }) {
  const [id, setId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [notes, setNotes] = useState<Notes | null>(null);
  const [ideas, setIdeas] = useState<WordIdea[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [openCloud, setOpenCloud] = useState<string | null>(null);
  const [world, setWorld] = useState<World | null>(null);
  const [learned, setLearned] = useState<string[]>([]);
  const [recipe, setRecipe] = useState(false);
  const [zoom, setZoom] = useState(false);
  /** Pip's notebook overlay: what GLM has understood about the story. */
  const [notebook, setNotebook] = useState<false | "nice" | "json">(false);
  const [rewriting, setRewriting] = useState(false);
  const rewriteNotes = useCallback(async () => {
    if (!id) return;
    setRewriting(true);
    try {
      const [body, again] = await Promise.all([
        fetch(`/api/story/${id}/notes`, { method: "POST" }).then((response) => response.json()),
        fetch(`/api/story/${id}/reactions`, { method: "POST" }).then((response) => response.json()),
      ]);
      if (body.world) {
        setWorld(body.world);
        setLearned(["The notebook was written again from the whole story"]);
      }
      if (again.reactions) setReactions(again.reactions);
      const problem = body.error ?? again.error;
      if (problem) setTrouble(problem);
    } catch (error) {
      setTrouble(error instanceof Error ? error.message : String(error));
    } finally {
      setRewriting(false);
    }
  }, [id]);
  // Opening an empty notebook fills it in (stories from before the notebook have none).
  useEffect(() => {
    if (notebook && !rewriting && text.trim() && (!world || (!world.about && world.characters.length === 0))) void rewriteNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebook]);
  useEffect(() => {
    if (!notebook) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setNotebook(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [notebook]);
  const [pictureMs, setPictureMs] = useState<number | null>(null);
  const [pictures, setPictures] = useState<Picture[]>([]);
  const [shown, setShown] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<Picture | null>(null);
  const [listening, setListening] = useState<false | "quick" | "full">(false);
  const [trouble, setTrouble] = useState("");
  const [used, setUsed] = useState<Set<string>>(new Set());
  // Synonyms swapped in here; laid over what the server sends until it has caught up.
  const [swaps, setSwaps] = useState<Map<string, Swap>>(new Map());
  const [saved, setSaved] = useState(true);
  const words = useRef<HTMLTextAreaElement>(null);
  /** Where the cursor is, and so which part of the story it is in. */
  const [caret, setCaret] = useState<number | null>(null);
  const part = caret === null ? null : partAt(text, caret);

  useEffect(() => {
    localStorage.setItem("story-id", storyId);
    setId(storyId);
  }, [storyId]);

  // The address carries the title (/story/beach-…), and the tab is named after the story.
  useEffect(() => {
    if (!id || !loaded) return;
    localStorage.setItem("story-title", title);
    document.title = title.trim() || "My Story";
    const path = storyPath(id, title);
    if (location.pathname !== path) history.replaceState(null, "", path);
  }, [id, loaded, title]);

  const loadPictures = useCallback(async (storyId: string, announce: boolean) => {
    const story = await (await fetch(`/api/story/${storyId}`)).json();
    const list: Picture[] = story.pictures ?? [];
    setPictures(list);
    const last = list.at(-1)?.id ?? null;
    setShown(last);
    if (announce) setFresh(last);
    return story;
  }, []);

  // Load the story, then listen for Pip.
  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoaded(false);
    loadPictures(id, false).then((story) => {
      if (!alive) return;
      setTitle(story.title ?? "");
      setText(story.text ?? "");
      setNotes(story.notes ?? null);
      setIdeas(story.ideas ?? []);
      setReactions(story.reactions ?? []);
      setWorld(story.world ?? null);
      setLearned(story.learned ?? []);
      setUsed(new Set());
      setSwaps(new Map());
      setPictureMs((story.pictures ?? []).at(-1)?.tookMs ?? null);
      setLoaded(true);
    });
    const events = new EventSource(`/api/story/${id}/events`);
    events.onmessage = (message) => {
      const event: StoryEvent = JSON.parse(message.data);
      if (event.type === "listening") setListening(event.on ? (event.tier ?? "full") : false);
      if (event.type === "notes") {
        setNotes(event.notes);
        setIdeas(event.ideas);
        setReactions(event.reactions);
        if (event.world) {
          setWorld(event.world);
          setLearned(event.learned ?? []);
        }
        setTrouble("");
      }
      if (event.type === "trouble") setTrouble(event.message);
      if (event.type === "picture") {
        if (event.picture.status === "drawing") setDrawing(event.picture);
        else {
          setDrawing(null);
          if (event.picture.status === "ready") {
            setPictureMs(event.picture.tookMs ?? null);
            const drawn = event.picture.id;
            void loadPictures(id, true).then(() => {
              setShown(drawn);
              setFresh(drawn);
            });
          }
        }
      }
    };
    return () => {
      alive = false;
      events.close();
    };
  }, [id, loadPictures]);

  // Autosave a moment after the last keystroke. The server decides when to listen.
  const lastSaved = useRef("");
  const unsaved = useRef<{ id: string; body: string } | null>(null);
  const [saveTrouble, setSaveTrouble] = useState(false);
  useEffect(() => {
    if (!id || !loaded) return;
    const body = JSON.stringify({ title, text, usedIdeas: [...used], swaps: [...swaps.values()] });
    if (!lastSaved.current) lastSaved.current = body; // what was just loaded is already saved
    if (body === lastSaved.current) return;
    unsaved.current = { id, body };
    setSaved(false);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/story/${id}`, { method: "PUT", body });
        if (!response.ok) throw new Error(String(response.status));
        lastSaved.current = body;
        if (unsaved.current?.body === body) unsaved.current = null;
        setSaveTrouble(false);
        setSaved(true);
      } catch {
        setSaveTrouble(true);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [id, loaded, title, text, used, swaps]);
  // Leaving the page within that moment must not lose the last words.
  useEffect(() => {
    const flush = () => {
      const waiting = unsaved.current;
      if (!waiting) return;
      unsaved.current = null;
      void fetch(`/api/story/${waiting.id}`, { method: "PUT", body: waiting.body, keepalive: true });
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  const marks = useMemo(
    () => findMarks(text, ideas.map((idea) => ({ ...idea, ...swaps.get(idea.id) })), used, reactions, caret ?? -1),
    [text, ideas, swaps, used, reactions, caret],
  );
  const newestBubble = marks.findLast((mark) => mark.type === "cheer" && mark.key === reactions.at(-1)?.id)?.key;

  // The open cloud is centred over its bubble; nudge it back when that would leave the page.
  const sheet = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const cloud = sheet.current?.querySelector<HTMLElement>(".cloud");
    if (!cloud || !sheet.current) return;
    cloud.style.setProperty("--nudge", "0px");
    const page = sheet.current.getBoundingClientRect();
    const box = cloud.getBoundingClientRect();
    const nudge = box.left < page.left ? page.left - box.left : box.right > page.right ? page.right - box.right : 0;
    cloud.style.setProperty("--nudge", `${nudge}px`);
  });

  // Click anywhere else to put the cloud away.
  useEffect(() => {
    if (!openCloud) return;
    const close = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest(".spot")) setOpenCloud(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [openCloud]);
  const thinkingFor = useStopwatch(listening !== false);
  const drawingFor = useStopwatch(drawing !== null);

  const pick = (mark: Mark, idea: string) => {
    const next = applyIdea(text, mark, idea);
    setText(next.text);
    if (mark.type === "syn") {
      // The two words trade places: the old one waits above, ready to be put back.
      const old = text.slice(mark.start, mark.end).toLowerCase();
      const earlier = [...next.text.slice(0, next.start).matchAll(new RegExp(`(?<![\\w'])${escape(idea)}(?![\\w'])`, "gi"))].length;
      const original = mark.was ?? old;
      const swap: Swap = {
        id: mark.key,
        word: idea,
        ideas: mark.ideas.map((other) => (other === idea ? old : other)),
        nth: earlier + 1,
        was: idea.toLowerCase() === original.toLowerCase() ? undefined : original,
      };
      setSwaps((all) => new Map(all).set(mark.key, swap));
    } else setUsed((old) => new Set(old).add(mark.key));
    requestAnimationFrame(() => {
      words.current?.focus();
      words.current?.setSelectionRange(next.cursor, next.cursor);
    });
  };

  // The part in view: the one the cursor moved into, or the one scrolled to. Its picture is shown.
  const [viewPart, setViewPart] = useState<number | null>(null);
  useEffect(() => {
    if (part !== null) setViewPart(part);
  }, [part]);
  useEffect(() => {
    const mine = viewPart === null ? null : pictures.find((p) => (p.section ?? 0) === viewPart);
    if (mine) setShown(mine.id);
    // only when the part in view changes, not when pictures arrive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewPart]);

  useEffect(() => {
    let waiting = 0;
    const look = () => {
      waiting = 0;
      const room = document.documentElement.scrollHeight - window.innerHeight;
      if (room < 40) return; // the whole story fits on screen: nothing to scroll to
      // The reading line moves down the window as you scroll: near the top of the page it sits high,
      // at the very bottom it reaches the bottom edge, so the last part always gets its turn.
      const line = window.innerHeight * (0.3 + 0.7 * Math.min(1, window.scrollY / room));
      let on = 0;
      for (const marker of sheet.current?.querySelectorAll<HTMLElement>(".part-start") ?? []) {
        if (marker.getBoundingClientRect().top <= line) on = Number(marker.dataset.part);
      }
      setViewPart(on);
    };
    const onScroll = () => {
      waiting ||= window.setTimeout(look, 60);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      clearTimeout(waiting);
    };
  }, []);

  const partStarts = useMemo(() => findPartStarts(text), [text]);
  const lastPart = text.slice(partStarts.at(-1));
  const longPart = (lastPart.match(/\S+/g) ?? []).length >= MIN_PART_WORDS && /[.!?]["')\]]*\s*$/.test(text) && !/\n\s*$/.test(text);
  const newPart = () => {
    const next = `${text.trimEnd()}\n\n`;
    setText(next);
    requestAnimationFrame(() => {
      words.current?.focus();
      words.current?.setSelectionRange(next.length, next.length);
    });
  };

  const drawAgain = (picture: Picture) => {
    if (!id || drawing) return;
    setDrawing({ ...picture, status: "drawing" });
    fetch(`/api/story/${id}/redraw`, { method: "POST", body: JSON.stringify({ picture: picture.id }) })
      .then((response) => {
        if (!response.ok) setDrawing(null); // the painter is busy with another picture
      })
      .catch(() => setDrawing(null));
  };

  const startOver = () => {
    if (text.trim() && !confirm("Start a brand new story? This one stays saved.")) return;
    location.href = storyPath(newStoryId());
  };

  // The story text again, invisible, carrying the scribbles exactly above their words.
  const mirror: React.ReactNode[] = [];
  // Where each part starts, so scrolling can tell which part is on screen.
  const write = (from: number, to: number, tail = "", markerOnly = false) => {
    let at = from;
    partStarts.forEach((start, index) => {
      if (start < from || start >= to) return;
      mirror.push(
        text.slice(at, start),
        <span className={`part-start ${partStarts.length > 1 ? "named" : ""} ${index === (viewPart ?? partStarts.length - 1) ? "on" : ""}`} data-part={index} key={`part-${index}`}>
          {partStarts.length > 1 && (
            <button type="button" onClick={() => setViewPart(index)} title="Show this part's picture">
              part {index + 1}
            </button>
          )}
        </span>,
      );
      at = start;
    });
    if (!markerOnly) mirror.push(text.slice(at, to) + tail);
  };
  let position = 0;
  for (const mark of marks) {
    write(position, mark.start);
    if (mark.type === "cheer") {
      mirror.push(
        <span className="mark spot" key={mark.key}>
          <button
            type="button"
            className={`bubble ${mark.key === newestBubble ? "new" : ""}`}
            onClick={() => setOpenCloud(openCloud === mark.key ? null : mark.key)}
            aria-label="What Pip said about this sentence"
            aria-expanded={openCloud === mark.key}
          >
            <Bubble />
          </button>
          {openCloud === mark.key && (
            <span className="cloud" role="status">
              <span className="cloud-cheer">{mark.ideas[0]}</span>
              {mark.question && <span className="cloud-ask">{mark.question}</span>}
            </span>
          )}
        </span>,
      );
      position = mark.start;
      continue;
    }
    const ideas = (
      <span className="row">
        {mark.ideas.map((idea, i) => (
          <span key={idea}>
            {i > 0 && <span className="or">or </span>}
            <button
              type="button"
              className={mark.was?.toLowerCase() === idea.toLowerCase() ? "mine" : ""}
              onClick={() => pick(mark, idea)}
              title={mark.type !== "syn" ? "Add this word" : mark.was?.toLowerCase() === idea.toLowerCase() ? "Put my word back" : "Swap the word"}
            >
              {idea}
            </button>
          </span>
        ))}
      </span>
    );
    if (mark.type === "syn") {
      if (mark.start > 0 && partStarts.includes(mark.start)) write(mark.start, mark.start + 1, "", true);
      mirror.push(
        <span className={`mark syn ${mark.was ? "tried" : ""} ${mark.quiet ? "quiet" : ""}`} key={mark.key}>
          {text.slice(mark.start, mark.end)}
          {!mark.quiet && <span className="scribble">{ideas}</span>}
        </span>,
      );
      position = mark.end;
    } else {
      mirror.push(
        <span className="mark adj" key={mark.key}>
          <span className="scribble">
            {ideas}
            <svg className="caret" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1.5 1.5 6.8 8.5 12.5 1" />
            </svg>
          </span>
        </span>,
      );
      position = mark.start;
    }
  }
  write(position, text.length, "​");
  if (longPart) {
    mirror.push(
      <span className="mark next" key="next-part">
        <button type="button" onClick={newPart} title="Start the next part of the story. It gets its own picture.">
          new part? <Turn />
        </button>
      </span>,
    );
  }

  const current = pictures.find((p) => p.id === shown) ?? pictures.at(-1);

  // Changing to another part's picture: the old one slides away while the new one slides in.
  const before = useRef<Picture | undefined>(undefined);
  const [leaving, setLeaving] = useState<{ file: string; way: "down" | "up" } | null>(null);
  useEffect(() => {
    const old = before.current;
    before.current = current;
    if (!old?.file || !current?.file || old.id === current.id || current.id === fresh) return;
    setLeaving({ file: old.file, way: (current.section ?? 0) >= (old.section ?? 0) ? "down" : "up" });
    const timer = setTimeout(() => setLeaving(null), 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);
  const wordCount = (text.match(/\S+/g) ?? []).length;

  return (
    <>
      <main className="desk">
        <section>
          <input className="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="My story" aria-label="Story title" spellCheck />
          <div className="sheet" ref={sheet}>
            <div className="mirror" aria-hidden>
              {mirror}
            </div>
            <textarea
              ref={words}
              className="words"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
              placeholder="Once upon a time…"
              aria-label="Your story"
              spellCheck
              autoFocus
            />
          </div>
        </section>

        <aside className="margin" aria-live="polite">
          <div className={`pip ${listening ? "busy" : ""}`}>
            <button type="button" className="pip-face" onClick={() => setNotebook("nice")} title="See what Pip knows about the story" aria-label="See what Pip knows about the story">
              <Pip />
            </button>
            {listening ? (
              <span className="dots">
                thinking<span>.</span><span>.</span><span>.</span>
              </span>
            ) : (
              <span>Pip is listening</span>
            )}
          </div>

          <p className="clock">
            <span className={listening === "quick" ? "live" : ""}>
              quick {listening === "quick" ? seconds(thinkingFor) : notes?.quickMs ? seconds(notes.quickMs) : "–"}
            </span>
            <span className={listening === "full" ? "live" : ""}>
              full {listening === "full" ? seconds(thinkingFor) : notes?.tookMs ? seconds(notes.tookMs) : "–"}
            </span>
            <span className={drawing ? "live" : ""}>
              drawing {drawing ? seconds(drawingFor) : pictureMs ? seconds(pictureMs) : "–"}
            </span>
          </p>

          {(current || drawing) && (
            <figure className="frame">
              <div className="canvas" onMouseEnter={() => setZoom(true)} onMouseLeave={() => setZoom(false)}>
                {leaving && <img key={`leaving-${leaving.file}`} className={`leaving ${leaving.way}`} src={`/api/picture/${leaving.file}`} alt="" />}
                {current?.file && <img key={current.id} className={current.id === fresh ? "fresh" : leaving ? `arriving ${leaving.way}` : ""} src={`/api/picture/${current.file}`} alt={current.caption} />}
                {current?.file && recipe && (
                  <div className="recipe" aria-label="What the painter was asked to draw">
                    <p>{current.sent?.prompt ?? current.prompt}</p>
                    <small>
                      {current.kind}
                      {current.sent && ` · ${current.sent.size}px · ${current.sent.steps} steps · seed ${current.sent.seed}`}
                      {current.tookMs ? ` · ${seconds(current.tookMs)}` : ""}
                    </small>
                  </div>
                )}
                {current?.file && (
                  <button type="button" className={`again info ${recipe ? "on" : ""}`} onClick={() => setRecipe(!recipe)} title="What the painter was asked to draw" aria-label="What the painter was asked to draw" aria-pressed={recipe}>
                    <span aria-hidden>i</span>
                  </button>
                )}
                {current?.file && !drawing && (
                  <button type="button" className="again" onClick={() => drawAgain(current)} title="Draw this picture again" aria-label="Draw this picture again">
                    <Again />
                  </button>
                )}
                {drawing && (
                  <div className={`drawing ${current ? "over" : ""}`}>
                    <Pencil />
                    <span>{current ? "drawing more" : "drawing…"}</span>
                  </div>
                )}
              </div>
              <figcaption className="caption" key={current?.id ?? "drawing"}>
                {pictures.length > 1 && current && <small>part {(current.section ?? 0) + 1} · </small>}
                {current?.caption ?? drawing?.caption}
              </figcaption>
            </figure>
          )}

          {pictures.length > 1 && (
            <div className="shelf">
              {pictures.map((p) => (
                <button key={p.id} type="button" className={p.id === current?.id ? "on" : ""} onClick={() => setShown(p.id)} aria-label={`Show the picture for part ${(p.section ?? 0) + 1}: ${p.caption}`}>
                  <img src={`/api/picture/${p.file}`} alt="" />
                  <b>{(p.section ?? 0) + 1}</b>
                </button>
              ))}
            </div>
          )}

          {notes ? (
            <div key={notes.at}>
              {notes.cheer && <p className="note cheer">{notes.cheer}</p>}
              {notes.questions.map((question, i) => (
                <p className="note ask" key={question} style={{ animationDelay: `${0.25 + i * 0.25}s` }}>
                  <Arrow />
                  {question}
                </p>
              ))}
              {notes.guess && (
                <p className="note guess" style={{ animationDelay: "0.8s" }}>
                  {notes.guess}
                </p>
              )}
            </div>
          ) : (
            <p className="note hello">Write your first sentence. I can&apos;t wait to hear it!</p>
          )}

          {world && (world.characters.length > 0 || world.places.length > 0) && (
            <section className="world" aria-label="What Pip knows about the story">
              {world.about && <p className="world-about">{world.about}</p>}
              {[...world.characters.map((c) => ({ ...c, place: false })), ...world.places.map((c) => ({ ...c, kind: "place", place: true }))].map((entry) => (
                <div className={`who ${entry.place ? "place" : ""}`} key={`${entry.place}-${entry.name}`}>
                  <strong>{entry.name}</strong>
                  {!entry.place && entry.kind && <em>{entry.kind}</em>}
                  <span className="facts">
                    {entry.facts.map((fact) => (
                      <span key={fact} className={learned.includes(`${entry.name}: ${fact}`) ? "new" : ""}>{fact}</span>
                    ))}
                  </span>
                </div>
              ))}
            </section>
          )}

          {trouble && <p className="note trouble">Pip can&apos;t hear right now ({trouble})</p>}
        </aside>
      </main>

      {zoom && !recipe && current?.file && (
        <div className="zoom" aria-hidden>
          <img src={`/api/picture/${current.file}`} alt="" />
        </div>
      )}

      {notebook && (
        <div className="book-back" onClick={() => setNotebook(false)}>
          <section className="book" role="dialog" aria-label="What Pip knows about the story" onClick={(event) => event.stopPropagation()}>
            <header>
              <h2>Pip&apos;s notebook</h2>
              <div className="book-tabs">
                <button type="button" className={notebook === "nice" ? "on" : ""} onClick={() => setNotebook("nice")}>notes</button>
                <button type="button" className={notebook === "json" ? "on" : ""} onClick={() => setNotebook("json")}>json</button>
                <button type="button" onClick={rewriteNotes} disabled={rewriting} title="Have GLM read the whole story again: new notes and new reactions on every part">
                  {rewriting ? "reading…" : "regenerate"}
                </button>
                <button type="button" onClick={() => setNotebook(false)} aria-label="Close">✕</button>
              </div>
            </header>
            {rewriting && (!world || !world.about) ? (
              <p className="book-empty">Pip is reading the whole story and writing its notes…</p>
            ) : !world ? (
              <p className="book-empty">Nothing yet. Pip writes its first notes after the next full turn (two new sentences, or a pause after a change).</p>
            ) : notebook === "json" ? (
              <pre>{JSON.stringify(world, null, 2)}</pre>
            ) : (
              <div className="book-pages">
                <div>
                  <h3>the story</h3>
                  <p className="book-about">{world.about || "…"}</p>
                  {world.parts.some(Boolean) && (
                    <ol>
                      {world.parts.map((about, index) => (
                        <li key={index} className={learned.includes(`Part ${index + 1}: ${about}`) ? "new" : ""}>
                          <b>part {index + 1}</b> {about || "…"}
                        </li>
                      ))}
                    </ol>
                  )}
                  {learned.length > 0 && (
                    <>
                      <h3>new last time</h3>
                      <ul className="book-new">
                        {learned.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
                <div>
                  <h3>who</h3>
                  {world.characters.length === 0 && <p className="book-empty">nobody yet</p>}
                  {world.characters.map((entry) => (
                    <div className="who" key={entry.name}>
                      <strong>{entry.name}</strong>
                      {entry.kind && <em>{entry.kind}</em>}
                      {entry.look && (
                        <p className="look">
                          <b>always drawn as</b> {entry.look}
                        </p>
                      )}
                      <span className="facts">
                        {entry.facts.map((fact) => (
                          <span key={fact} className={learned.includes(`${entry.name}: ${fact}`) ? "new" : ""}>{fact}</span>
                        ))}
                      </span>
                    </div>
                  ))}
                  <h3>where</h3>
                  {world.places.length === 0 && <p className="book-empty">nowhere yet</p>}
                  {world.places.map((entry) => (
                    <div className="who place" key={entry.name}>
                      <strong>{entry.name}</strong>
                      <span className="facts">
                        {entry.facts.map((fact) => (
                          <span key={fact} className={learned.includes(`${entry.name}: ${fact}`) ? "new" : ""}>{fact}</span>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <footer>
              This is what GLM gets back as STORY NOTES on every full turn. Each change is also kept in the <a href={id ? `/history?story=${id}` : "/history"}>history</a>.
            </footer>
          </section>
        </div>
      )}

      <footer className="foot">
        <span>
          {wordCount} {wordCount === 1 ? "word" : "words"}
        </span>
        <span>{saveTrouble ? "not saved! is the app still running?" : saved ? "saved" : "saving…"}</span>
        <a href="/stories">my stories</a>
        <a href={id ? `/history?story=${id}` : "/history"}>history</a>
        <button type="button" onClick={startOver}>
          new story
        </button>
      </footer>
    </>
  );
}

function Pip() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="#ffd23f" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M24 6c11 0 18 7 18 17s-8 18-18 18S6 34 6 23 13 6 24 6Z" />
      <path d="M17 20v3M31 20v3" />
      <path d="M16 29c4 5 12 5 16 0" />
      <path d="M12 9 9 3M36 9l3-6" />
    </svg>
  );
}

function Bubble() {
  // Pip hiding behind the words, peeking over them
  return (
    <svg viewBox="0 0 48 26" aria-hidden>
      <path d="M2 26C2 12 10 3 24 3s22 9 22 23z" fill="currentColor" />
      <g className="blink">
        <circle cx="16" cy="16" r="6" fill="#fff" />
        <circle cx="32" cy="16" r="6" fill="#fff" />
        <circle cx="17.5" cy="18" r="3" fill="#17324a" />
        <circle cx="33.5" cy="18" r="3" fill="#17324a" />
      </g>
    </svg>
  );
}

function Again() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 12a8 8 0 1 1-2.6-5.900" />
      <path d="M20 4v5h-5" />
    </svg>
  );
}

function Turn() {
  return (
    <svg viewBox="0 0 24 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 2v6a4 4 0 0 1-4 4H4" />
      <path d="M9 7l-5 5 5 5" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 40 28" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M38 6C28 2 14 6 4 18" />
      <path d="M3 8l1 10 10-2" />
    </svg>
  );
}

function Pencil() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 40l4-12L32 8l8 8-20 20-12 4Z" />
      <path d="M28 12l8 8M12 28l8 8" />
    </svg>
  );
}
