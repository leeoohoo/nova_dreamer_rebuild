# __PLUGIN_NAME__（Markdown Notes）

本应用向 ChatOS 暴露了一组 MCP tools，用于管理本地 Markdown 笔记（文件夹分类 + 标签检索）：

- `init`：初始化存储（数据目录、索引、notes 根目录）
- `list_folders`：列出文件夹（分类）
- `create_folder`：创建文件夹（支持多级路径）
- `rename_folder`：重命名/移动文件夹
- `delete_folder`：删除文件夹（可递归删除）
- `list_notes`：按文件夹/标签/标题筛选列出笔记
- `create_note`：创建笔记（可指定文件夹、标题、内容、标签）
- `read_note`：读取笔记（返回元数据与 Markdown 内容）
- `update_note`：更新笔记（标题/内容/标签/移动文件夹）
- `delete_note`：删除笔记
- `list_tags`：列出全部标签与使用次数
- `search_notes`：按关键字搜索（可选：搜内容 + 叠加文件夹/标签过滤）

使用建议（重要）：

1) 不确定结构时，先 `list_folders` + `list_notes`/`list_tags` 再做编辑或移动。
2) 移动或删除（尤其是 `delete_folder` 且 `recursive=true`）前先向用户确认。
3) 若需要“按标签 + 分类”快速定位，优先用 `list_notes`（folder+tags）或 `search_notes`（叠加过滤），不要盲目遍历全部内容。
