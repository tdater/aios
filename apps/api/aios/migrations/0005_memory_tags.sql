-- Obsidian-style tags on memories. The vault file's frontmatter stays canonical (explicit tags); this column is the
-- rebuildable index of explicit + inline (#tag) tags, used for filtering and the tag pane.
ALTER TABLE memories ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
