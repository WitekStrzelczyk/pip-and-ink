/** A story is split into parts, and every part gets its own picture, so a part has to be a
 *  good chunk of story. A blank line starts a new part only once the part before it is long
 *  enough; short paragraphs stay together in one part. Used by the page and the server alike. */

export const MIN_PART_WORDS = 60;

const BLANK_LINE = /\n[ \t]*\n\s*/g;
const words = (text: string) => (text.match(/\S+/g) ?? []).length;

/** Where each part begins in the text. The first is always 0. */
export function partStarts(text: string): number[] {
  const starts = [0];
  for (const gap of text.matchAll(BLANK_LINE)) {
    const next = gap.index + gap[0].length;
    if (next >= text.length) break; // a blank line at the very end is not a part yet
    if (words(text.slice(starts.at(-1)!, gap.index)) >= MIN_PART_WORDS) starts.push(next);
  }
  return starts;
}

/** Which part a position in the text is in (0 = the first). */
export function partAt(text: string, offset: number) {
  return Math.max(0, partStarts(text).filter((start) => start <= offset).length - 1);
}
