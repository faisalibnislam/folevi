import { Placeholder, UndoRedo, Dropcursor, Gapcursor } from "@tiptap/extensions";
import { ALL_MARKS, ALL_NODES, BlockFormat } from "./extensions";
import { NODE_VIEW_EXTENSIONS } from "./NodeViews";
import { BlockDecorations, BlockIdentity, BlockKeymap, MarkdownShortcuts, Triggers, type TriggerState } from "./plugins";
import { BlockSelectionExtension } from "./blockSelection";
import { FindReplace } from "./findReplace";

/**
 * The editor's extensions: every block and mark, their node views, undo, the drop and gap cursors, the
 * placeholders, block identity and keys, block selection, Markdown shortcuts, find and the "/", "[[" and "@"
 * triggers. Shared by the app's editor and the site's editable demo note, so both behave the same.
 */
export function editorExtensions({
  aiHint,
  placeholder,
  onTrigger,
}: {
  /** Whether the empty-line hint mentions ⌘J (read when the placeholder renders). */
  aiHint: { current: boolean };
  /** The hint on an empty page. */
  placeholder?: string;
  onTrigger: (trigger: TriggerState | null) => void;
}) {
  return [
    ...ALL_NODES.filter((n) => !NODE_VIEW_EXTENSIONS.some((v) => v.name === n.name)),
    ...NODE_VIEW_EXTENSIONS,
    ...ALL_MARKS,
    BlockFormat,
    UndoRedo.configure({ depth: 200, newGroupDelay: 600 }),
    Dropcursor.configure({ color: "var(--color-accent)", width: 2 }),
    Gapcursor,
    Placeholder.configure({
      placeholder: ({ node, pos, editor }) => {
        if (node.type.name === "heading") return `Heading ${node.attrs.level}`;
        if (node.type.name === "todo") return "To-do";
        if (["bulleted", "numbered", "quote", "callout", "toggle"].includes(node.type.name)) return "List";
        const ai = aiHint.current ? ", ⌘J for AI" : "";
        return pos === 0 && editor.state.doc.childCount === 1 ? (placeholder ?? `Start writing, or type / for blocks${ai}`) : `Type / for blocks${ai}, [[ to link a page`;
      },
      showOnlyCurrent: true,
      includeChildren: false,
    }),
    BlockIdentity,
    BlockDecorations,
    BlockKeymap,
    BlockSelectionExtension,
    MarkdownShortcuts,
    FindReplace,
    Triggers.configure({ onChange: onTrigger }),
  ];
}
