"use client";

import { useEffect, useMemo, useState } from "react";
import { newStoryId, storyPath } from "@/lib/links";
import "./stories.css";

/** The bookshelf: every story, grouped by when it was last written in. Start a new one or open any. */

type Shelf = { id: string; title: string; updatedAt: number; words: number; parts: number; start: string; cover: string | null; pictures: string[]; about: string; who: string[] };

const DAY = 86_400_000;
const startOfDay = (at: number) => new Date(new Date(at).setHours(0, 0, 0, 0)).getTime();

function group(at: number, now: number) {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  if (days < 31) return "This month";
  return "A while ago";
}

function ago(at: number, now: number) {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24 && startOfDay(at) === startOfDay(now)) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
  if (days === 1) return "yesterday";
  if (days < 7) return new Date(at).toLocaleDateString([], { weekday: "long" });
  return new Date(at).toLocaleDateString([], { day: "numeric", month: "long" });
}

export default function Stories() {
  const [stories, setStories] = useState<Shelf[] | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [now] = useState(() => Date.now());

  useEffect(() => {
    setMine(localStorage.getItem("story-id"));
    fetch("/api/stories")
      .then((response) => response.json())
      .then((body) => setStories(body.stories ?? []));
  }, []);

  const open = (id: string, title = "") => {
    location.href = storyPath(id, title);
  };

  const groups = useMemo(() => {
    const wanted = find.trim().toLowerCase();
    const out: { name: string; stories: Shelf[] }[] = [];
    for (const story of stories ?? []) {
      if (wanted && !`${story.title} ${story.start} ${story.about} ${story.who.join(" ")}`.toLowerCase().includes(wanted)) continue;
      const name = group(story.updatedAt, now);
      const last = out.at(-1);
      if (last?.name === name) last.stories.push(story);
      else out.push({ name, stories: [story] });
    }
    return out;
  }, [stories, find, now]);

  const total = stories?.length ?? 0;
  const words = (stories ?? []).reduce((sum, story) => sum + story.words, 0);

  const newCard = (
        <button type="button" className="sh-new" onClick={() => open(newStoryId())}>
          <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M24 6c11 0 18 7 18 17s-8 18-18 18S6 34 6 23 13 6 24 6Z" />
            <path d="M17 20v3M31 20v3M16 29c4 5 12 5 16 0M12 9 9 3M36 9l3-6" />
          </svg>
          <strong>Start a new story</strong>
          <span>Once upon a time…</span>
        </button>
  );

  return (
    <main className="sh">
      <header className="sh-head">
        <div>
          <h1>My stories</h1>
          <p>
            {stories === null ? "Looking on the shelf…" : total === 0 ? "No stories yet. The first one is waiting!" : `${total} ${total === 1 ? "story" : "stories"} · ${words.toLocaleString()} words written so far`}
          </p>
        </div>
        {total > 5 && <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="find a story…" aria-label="Find a story" />}
        {mine && <a href="/">back to my story</a>}
      </header>

      {groups.length === 0 && <section className="sh-row">{newCard}</section>}

      {groups.map((shelf, first) => (
        <section key={shelf.name}>
          <h2>{shelf.name}</h2>
          <div className="sh-row">
            {first === 0 && newCard}
            {shelf.stories.map((story, index) => (
              <button type="button" key={story.id} className={`sh-book ${story.id === mine ? "mine" : ""}`} style={{ "--tilt": `${((index * 37) % 5) - 2}deg` } as React.CSSProperties} onClick={() => open(story.id, story.title)}>
                <span className="sh-cover">
                  {story.cover ? <img src={`/api/picture/${story.cover}`} alt="" /> : <span className="sh-blank">{story.start || "…"}</span>}
                  {story.pictures.length > 1 && (
                    <span className="sh-more">
                      {story.pictures.slice(0, -1).slice(-3).map((file) => (
                        <img key={file} src={`/api/picture/${file}`} alt="" />
                      ))}
                    </span>
                  )}
                  {story.id === mine && <span className="sh-mine">writing this one</span>}
                </span>
                <strong>{story.title || `${story.start.split(/\s+/).slice(0, 5).join(" ")}…`}</strong>
                {story.about && <span className="sh-about">{story.about}</span>}
                <span className="sh-facts">
                  {ago(story.updatedAt, now)} · {story.words} words{story.parts > 1 ? ` · ${story.parts} parts` : ""}
                </span>
                {story.who.length > 0 && <span className="sh-who">with {story.who.join(", ")}</span>}
              </button>
            ))}
          </div>
        </section>
      ))}

      {stories !== null && total > 0 && groups.length === 0 && <p className="sh-none">No story matches “{find}”.</p>}
    </main>
  );
}
