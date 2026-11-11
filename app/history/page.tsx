"use client";

import { useEffect, useMemo, useState } from "react";
import type { HistoryEntry } from "@/lib/history";
import { storyPath } from "@/lib/links";
import "./history.css";

/** Rewind a story: pick any moment and see the text, the picture, and what was said to GLM then. */

/** `backfilled` / `timeGuessed` mark entries reconstructed for stories older than the history itself. */
type Entry = HistoryEntry & { backfilled?: boolean; timeGuessed?: boolean };
type Kind = Entry["type"];

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const day = (at: number) => new Date(at).toLocaleDateString([], { day: "numeric", month: "short" });
const words = (text: string) => (text.match(/\S+/g) ?? []).length;

/** What changed between two versions: the shared start and end stay, the middle is old -> new. */
function change(before: string, after: string) {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  return { head: after.slice(0, head), gone: before.slice(head, before.length - tail), come: after.slice(head, after.length - tail), tail: after.slice(after.length - tail) };
}

function label(entry: Entry, previousText: string) {
  if (entry.type === "text") {
    const diff = change(previousText, entry.text);
    const come = diff.come.trim();
    const gone = diff.gone.trim();
    if (come && gone) return `“${gone.slice(0, 18)}” → “${come.slice(0, 22)}”`;
    if (come) return `+ ${come.slice(0, 44)}`;
    if (gone) return `− ${gone.slice(0, 44)}`;
    return "title changed";
  }
  if (entry.type === "glm") {
    const reply = entry.reply as { cheer?: string; picture?: unknown } | null;
    if (entry.tier === "notes") return "Pip rewrote its story notes";
    if (entry.tier === "reactions") return "Pip reacted to a part it had not reacted to";
    if (entry.tier === "picture") return "Pip read the part again for a new picture";
    return `${entry.tier === "full" ? "Pip (full)" : "Pip (quick)"}: ${reply?.cheer ?? ""}${reply?.picture ? " 🎨" : ""}`;
  }
  if (entry.type === "picture") return `${entry.picture.status === "failed" ? "picture failed" : entry.why === "asked again" ? "picture drawn again" : `${entry.picture.kind} picture`}: ${entry.picture.caption}`;
  if (entry.type === "world") return `learned: ${entry.learned.slice(0, 2).join("; ")}${entry.learned.length > 2 ? ` (+${entry.learned.length - 2})` : ""}`;
  return `trouble: ${entry.message}`;
}

export default function History() {
  const [id, setId] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [at, setAt] = useState(0);
  const [show, setShow] = useState<Record<Kind, boolean>>({ text: true, glm: true, picture: true, world: true, trouble: true });

  useEffect(() => {
    const story = new URLSearchParams(location.search).get("story") ?? localStorage.getItem("story-id");
    setId(story);
    if (!story) return setEntries([]);
    fetch(`/api/story/${story}/history`)
      .then((response) => response.json())
      .then((body) => {
        const list: Entry[] = body.entries ?? [];
        setEntries(list);
        setAt(Math.max(0, list.length - 1));
      });
  }, []);

  // What the story looked like at each entry: the text and picture in force at that moment.
  const moments = useMemo(() => {
    let text = "";
    let title = "";
    let before = "";
    let picture: Extract<Entry, { type: "picture" }> | null = null;
    return (entries ?? []).map((entry) => {
      const previous = text;
      if (entry.type === "text") {
        before = text;
        text = entry.text;
        title = entry.title;
      }
      if (entry.type === "picture" && entry.picture.file) picture = entry;
      return { text, title, before, picture, label: label(entry, previous) };
    });
  }, [entries]);

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") setAt((n) => Math.max(0, n - 1));
      if (event.key === "ArrowRight") setAt((n) => Math.min((entries?.length ?? 1) - 1, n + 1));
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [entries]);

  if (!entries) return <main className="hx"><p className="hx-empty">Opening the history…</p></main>;
  if (!entries.length) return <main className="hx"><p className="hx-empty">No history yet for this story. It is written as you type. <a href="/">Back to the story</a></p></main>;

  const entry = entries[at];
  const moment = moments[at];
  const diff = entry.type === "text" ? change(moment.before, moment.text) : null;
  const allPictures = entries.map((e, index) => ({ e, index })).filter(({ e }) => e.type === "picture" && e.picture.file) as { e: Extract<Entry, { type: "picture" }>; index: number }[];

  return (
    <main className="hx">
      <aside className="hx-side">
        <h1>
          Story history <a href={id ? storyPath(id, moments.at(-1)?.title) : "/"}>back to story</a>
        </h1>
        <p>
          {id} · {entries.length} moments · {words(moments.at(-1)!.text)} words now
        </p>
        <div className="hx-filters">
          {(["text", "glm", "picture", "world", "trouble"] as Kind[]).map((kind) => (
            <button key={kind} type="button" className={show[kind] ? "on" : ""} onClick={() => setShow({ ...show, [kind]: !show[kind] })}>
              {kind === "glm" ? "Pip (GLM)" : kind === "text" ? "writing" : kind === "world" ? "story notes" : `${kind}s`} {entries.filter((e) => e.type === kind).length}
            </button>
          ))}
        </div>
        <ol className="hx-list">
          {entries.map((e, index) =>
            show[e.type] || index === at ? (
              <li key={index}>
                <button type="button" className={`${e.type} ${index === at ? "at" : index > at ? "later" : ""}`} onClick={() => setAt(index)} ref={index === at ? (node) => node?.scrollIntoView({ block: "nearest" }) : undefined}>
                  <time title={new Date(e.at).toLocaleString()}>{e.timeGuessed ? "?" : clock(e.at)}</time>
                  <i />
                  <span>{moments[index].label}</span>
                </button>
              </li>
            ) : null,
          )}
        </ol>
      </aside>

      <section className="hx-main">
        <div className="hx-scrub">
          <button type="button" onClick={() => setAt(Math.max(0, at - 1))} aria-label="One step back">←</button>
          <input type="range" min={0} max={entries.length - 1} value={at} onChange={(e) => setAt(Number(e.target.value))} aria-label="Rewind the story" />
          <button type="button" onClick={() => setAt(Math.min(entries.length - 1, at + 1))} aria-label="One step forward">→</button>
          <span>
            {at + 1} / {entries.length} · {day(entry.at)} {entry.timeGuessed ? "(time not recorded)" : clock(entry.at)}
          </span>
        </div>

        <div className="hx-then">
          <div>
            <h2>{moment.title || "(no title)"}</h2>
            {diff ? (
              <p className="hx-story">
                {diff.head}
                {diff.gone && <del>{diff.gone}</del>}
                {diff.come && <ins>{diff.come}</ins>}
                {diff.tail}
              </p>
            ) : (
              <p className="hx-story">{moment.text || <span className="hx-empty">{entries.some((e) => e.type === "text" && e.backfilled) ? "(the text at this point was not kept; history started recording later)" : "(nothing written yet at this point)"}</span>}</p>
            )}
          </div>
          <div>
            {moment.picture ? (
              <figure className="hx-pic">
                <img src={`/api/picture/${moment.picture.picture.file}`} alt={moment.picture.picture.caption} />
                <figcaption>
                  {moment.picture.picture.kind} · {moment.picture.picture.caption || "picture at this moment"}
                </figcaption>
              </figure>
            ) : (
              <p className="hx-empty">No picture yet at this point.</p>
            )}
            {allPictures.length > 1 && (
              <div className="hx-shelf">
                {allPictures.map(({ e, index }) => (
                  <button key={index} type="button" className={moment.picture === e ? "at" : ""} onClick={() => setAt(index)} title={`${clock(e.at)} · ${e.picture.caption}`}>
                    <img src={`/api/picture/${e.picture.file}`} alt="" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="hx-detail">
          {entry.type === "text" && (
            <h3>
              The writer wrote <small>{words(entry.text)} words{entry.backfilled ? " · recovered: earlier versions were not kept" : ""}</small>
            </h3>
          )}
          {entry.type === "world" && (
            <>
              <h3>
                GLM&apos;s story notes changed <small>{entry.learned.length} new</small>
              </h3>
              <h4>new this time</h4>
              <pre>{entry.learned.map((line) => `+ ${line}`).join("\n")}</pre>
              <h4>the notes after this</h4>
              <pre>{JSON.stringify(entry.world, null, 2)}</pre>
            </>
          )}
          {entry.type === "trouble" && (
            <>
              <h3>Something went wrong</h3>
              <pre>{entry.message}</pre>
            </>
          )}
          {entry.type === "glm" && (
            <>
              <h3>
                {entry.tier === "full" ? "Full turn" : entry.tier === "notes" ? "Story notes rewritten" : entry.tier === "picture" ? "New picture prompt for one part" : "Quick reaction"} with GLM <small>{entry.ms ? `${(entry.ms / 1000).toFixed(1)}s` : "time not recorded"}</small>
              </h3>
              <h4>sent to GLM</h4>
              <pre>{entry.sent}</pre>
              <h4>GLM answered</h4>
              <pre>{JSON.stringify(entry.reply, null, 2)}</pre>
              {entry.thinking && (
                <details>
                  <summary>GLM&apos;s thinking</summary>
                  <pre>{entry.thinking}</pre>
                </details>
              )}
              {entry.system && (
                <details>
                  <summary>Instructions in force from here on</summary>
                  <pre>{entry.system}</pre>
                </details>
              )}
            </>
          )}
          {entry.type === "picture" && (
            <>
              <h3>
                {entry.why === "asked again" ? "Picture drawn again on request" : "Picture drawn for the story"}
                <small>
                  {entry.picture.status}
                  {entry.picture.tookMs ? ` · ${(entry.picture.tookMs / 1000).toFixed(1)}s` : ""}
                  {entry.replaces ? " · replaced the previous one" : ""}
                </small>
              </h3>
              <h4>what GLM asked for</h4>
              <pre>{entry.picture.prompt}{entry.picture.style ? `\n\nstyle: ${entry.picture.style}` : ""}</pre>
              {entry.picture.sent && (
                <>
                  <h4>sent to the painter</h4>
                  <pre>{entry.picture.sent.prompt}{`\n\n${entry.picture.sent.size}px · ${entry.picture.sent.steps} steps · seed ${entry.picture.sent.seed}`}</pre>
                </>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
