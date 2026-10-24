import { createContext, useContext, useMemo } from "react";
import { Paged, Project } from "../../core/types";
import { NoteRow, TitleIndex, fetchAllNotes, titleIndex } from "../../core/vault";
import { Store } from "../../core/connection";
import { useApp } from "../../ui/Context";
import { useLoad } from "../../ui/hooks";

export interface Vault {
  notes: NoteRow[];
  loading: boolean;
  error: string | null;
  tags: { tag: string; count: number }[];
  projects: Project[];
  index: TitleIndex;
  projectName: (id: string | null | undefined) => string;
  reload: () => Promise<void>;
}
export const VaultContext = createContext<Vault | null>(null);
export const useVault = (): Vault => {
  const v = useContext(VaultContext);
  if (!v) throw new Error("VaultContext missing");
  return v;
};

/** Loads the whole (personal-scale) vault once for the Knowledge screen and keeps it fresh. */
export function useVaultProvider(): Vault {
  const { client } = useApp();
  const notes = useLoad(() => fetchAllNotes(client), [client], 25000);
  const tags = useLoad(() => client.get<{ items: { tag: string; count: number }[] }>("/memories/tags").then((r) => r.items), [client], 25000);
  const projects = useLoad(() => client.get<Paged<Project>>("/projects", { query: { limit: 100 } }).then((r) => r.items), [client]);
  const index = useMemo(() => titleIndex(notes.data ?? []), [notes.data]);
  const byId = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p.name])), [projects.data]);
  return {
    notes: notes.data ?? [], loading: notes.loading && !notes.data, error: notes.error, tags: tags.data ?? [], projects: projects.data ?? [], index,
    projectName: (id) => (id ? byId.get(id) ?? "Unknown project" : "Unassigned"),
    reload: async () => { await Promise.all([notes.reload(), tags.reload()]); },
  };
}

/** Heading to scroll to after a wiki link like [[Note#Heading]] opens its target. */
export const pendingAnchor = new Store<string | null>(null);
/** Title handed to the "new note" form when a ghost wiki link is clicked. */
export const newNoteTitle = new Store<string>("");
