"use client";
// A Vault note's editor (docs/VAULT_PLAN.md §5): the app's own text blocks and marks (headings, lists, to-dos, quotes,
// code, dividers, bold and the rest, Markdown shortcuts, undo), and nothing that reaches outside the Vault: no Foli AI,
// no page links or mentions, no uploads, embeds or comments. The document is sealed whole when saved.
import "@/components/editor/editor.css";
import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import { Placeholder, UndoRedo } from "@tiptap/extensions";
import { Bold, CheckSquare, Code2, Heading2, Italic, List, ListOrdered, Minus, Quote, Strikethrough } from "lucide-react";
import { ALL_MARKS, Bulleted, Code, Divider, Doc, HardBreak, Heading, Numbered, Paragraph, Quote as QuoteBlock, Text, Todo } from "@/components/editor/extensions";
import { BlockIdentity, BlockKeymap, MarkdownShortcuts } from "@/components/editor/plugins";
import { IconButton } from "@/components/ui/Button";

export const NOTE_EXTENSIONS = [
  Doc,
  Text,
  HardBreak,
  Paragraph,
  Heading,
  Bulleted,
  Numbered,
  Todo,
  QuoteBlock,
  Code,
  Divider,
  // Marks, less links: a Vault note never fetches or previews anything.
  ...ALL_MARKS.filter((m) => m.name !== "link"),
  UndoRedo.configure({ depth: 200, newGroupDelay: 600 }),
  Placeholder.configure({ placeholder: "Write here. It's end-to-end encrypted.", showOnlyCurrent: true }),
  BlockIdentity,
  BlockKeymap,
  MarkdownShortcuts,
];

/** A note saved before this editor (plain text) as a document. */
export function noteDoc(doc: unknown): JSONContent {
  if (doc && typeof doc === "object" && (doc as { type?: unknown }).type === "doc") return doc as JSONContent;
  const text = (doc as { text?: unknown } | null)?.text;
  const lines = typeof text === "string" && text ? text.split("\n") : [""];
  return { type: "doc", content: lines.map((l) => (l ? { type: "paragraph", content: [{ type: "text", text: l }] } : { type: "paragraph" })) };
}

function Toolbar({ editor }: { editor: Editor }) {
  const block = (name: string, attrs?: Record<string, unknown>) => () => {
    const on = editor.isActive(name, attrs);
    editor
      .chain()
      .focus()
      .setNode(on ? "paragraph" : name, on ? {} : attrs)
      .run();
  };
  const tools: [string, React.ReactNode, () => void, boolean][] = [
    ["Bold", <Bold key="b" size={15} />, () => editor.chain().focus().toggleMark("bold").run(), editor.isActive("bold")],
    ["Italic", <Italic key="i" size={15} />, () => editor.chain().focus().toggleMark("italic").run(), editor.isActive("italic")],
    ["Strikethrough", <Strikethrough key="s" size={15} />, () => editor.chain().focus().toggleMark("strike").run(), editor.isActive("strike")],
    ["Heading", <Heading2 key="h" size={15} />, block("heading", { level: 2 }), editor.isActive("heading")],
    ["Bulleted list", <List key="ul" size={15} />, block("bulleted"), editor.isActive("bulleted")],
    ["Numbered list", <ListOrdered key="ol" size={15} />, block("numbered"), editor.isActive("numbered")],
    ["To-do", <CheckSquare key="t" size={15} />, block("todo"), editor.isActive("todo")],
    ["Quote", <Quote key="q" size={15} />, block("quote"), editor.isActive("quote")],
    ["Code", <Code2 key="c" size={15} />, block("code"), editor.isActive("code")],
    ["Divider", <Minus key="d" size={15} />, () => editor.chain().focus().insertContent({ type: "divider" }).run(), false],
  ];
  return (
    <div role="toolbar" aria-label="Formatting" className="mb-2 flex flex-wrap gap-0.5 border-b border-line pb-2">
      {tools.map(([label, icon, run, active]) => (
        <IconButton key={label} label={label} aria-pressed={active} onClick={run} className={active ? "bg-[var(--glass-active)] text-heading" : ""}>
          {icon}
        </IconButton>
      ))}
    </div>
  );
}

export function NoteEditor({ initial, editable, onChange }: { initial: unknown; editable: boolean; onChange: (doc: JSONContent, text: string) => void }) {
  const editor = useEditor({
    extensions: NOTE_EXTENSIONS,
    content: noteDoc(initial),
    editable,
    immediatelyRender: false,
    // The toolbar shows what's on at the caret.
    shouldRerenderOnTransaction: true,
    editorProps: { attributes: { role: "textbox", "aria-multiline": "true", "aria-label": "Note", class: "fb-editor min-h-[18rem] outline-none" } },
    onUpdate: ({ editor: e }) => onChange(e.getJSON(), e.getText({ blockSeparator: "\n" })),
  });
  if (!editor) return <div className="h-40 animate-pulse rounded-chip bg-surface motion-reduce:animate-none" aria-busy />;
  return (
    <div>
      {editable ? <Toolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
}
