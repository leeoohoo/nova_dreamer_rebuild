# __PLUGIN_NAME__ (Markdown Notes)

This app exposes MCP tools to manage local Markdown notes (folders + tags):

- `init`: initialize storage (data dir, index, notes root)
- `list_folders`: list folders (categories)
- `create_folder`: create a folder (supports nested paths)
- `rename_folder`: rename/move a folder
- `delete_folder`: delete a folder (optionally recursive)
- `list_notes`: list notes filtered by folder/tags/title
- `create_note`: create a note (folder/title/content/tags)
- `read_note`: read a note (metadata + markdown content)
- `update_note`: update a note (title/content/tags/move folder)
- `delete_note`: delete a note
- `list_tags`: list tags with counts
- `search_notes`: search by keyword (optional content search + folder/tags filters)

Guidelines:

1) If you don't know the structure, start with `list_folders` + `list_notes`/`list_tags` before making changes.
2) Ask for confirmation before destructive operations (especially `delete_folder` with `recursive=true`).
3) For quick lookup by folder + tags, prefer `list_notes` (folder+tags) or `search_notes` with filters, instead of scanning everything.
