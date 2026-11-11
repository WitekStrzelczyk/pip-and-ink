/** Every story has its own address: /story/<title-in-words>-<code>, e.g. /story/the-lost-kite-k3x9a2b7c1d4.
 *  Only the code at the end counts, so the link keeps working when the title changes. */

export function storyPath(id: string, title = "") {
  const code = id.replace(/^story-/, "");
  const words = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `/story/${words ? `${words}-` : ""}${code}`;
}

export function storyIdFromSlug(slug: string) {
  return `story-${slug.split("-").at(-1) ?? ""}`;
}

export const newStoryId = () => `story-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
