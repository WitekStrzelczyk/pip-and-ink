"use client";

import { useEffect } from "react";
import { newStoryId, storyPath } from "@/lib/links";

/** The front door: straight to the story you were writing last, or a fresh one. */
export default function Home() {
  useEffect(() => {
    let id = localStorage.getItem("story-id");
    if (!id) {
      id = newStoryId();
      localStorage.setItem("story-id", id);
    }
    location.replace(storyPath(id, localStorage.getItem("story-title") ?? ""));
  }, []);
  return null;
}
