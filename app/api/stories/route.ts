import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { partStarts } from "@/lib/parts";
import { DATA_DIR, type Story } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Every saved story that has something in it, newest first: the bookshelf at /stories. */
export async function GET() {
  const dir = path.join(DATA_DIR, "stories");
  const files = (await readdir(dir).catch(() => [])).filter((file) => file.endsWith(".json"));
  const stories = await Promise.all(
    files.map(async (file) => {
      try {
        const story: Story = JSON.parse(await readFile(path.join(dir, file), "utf8"));
        const text = story.text ?? "";
        if (!text.trim() && !story.title?.trim()) return null;
        const pictures = (story.pictures ?? []).filter((picture) => picture.file);
        return {
          id: story.id,
          title: story.title ?? "",
          updatedAt: story.updatedAt ?? 0,
          words: (text.match(/\S+/g) ?? []).length,
          parts: text.trim() ? partStarts(text).length : 0,
          start: text.trim().slice(0, 140),
          cover: pictures.at(-1)?.file ?? null,
          pictures: pictures.map((picture) => picture.file),
          about: story.world?.about ?? "",
          who: (story.world?.characters ?? []).map((character) => character.name).slice(0, 4),
        };
      } catch {
        return null;
      }
    }),
  );
  return Response.json({ stories: stories.filter((story) => story !== null).sort((a, b) => b.updatedAt - a.updatedAt) });
}
