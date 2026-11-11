import { notFound } from "next/navigation";
import { storyIdFromSlug } from "@/lib/links";
import { validId } from "@/lib/store";
import Writer from "../../writer";

/** One story at its own address, e.g. /story/the-lost-kite-k3x9a2b7c1d4. */
export default async function StoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const id = storyIdFromSlug((await params).slug);
  if (!validId(id)) notFound();
  return <Writer storyId={id} />;
}
