import { useEffect } from "react";
import { hrefFor } from "../core/workspace";
import { useApp } from "./Context";
import { useRoute } from "./hooks";

/** Screens report the human title of the document they show so its tab is readable. */
export function useTabTitle(title: string | null | undefined): void {
  const { workspace } = useApp();
  const route = useRoute();
  const href = hrefFor(route);
  useEffect(() => {
    if (title) workspace.setTitle(href, title);
  }, [title, href, workspace]);
}
