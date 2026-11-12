import { useState } from "react";
import type { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";

interface NoteEditorProps {
  content: JSONContent;
  onChange: (content: JSONContent) => void;
  onRequestImage: () => Promise<string | null>;
}

const EMPTY_DOC: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

export function emptyNoteDocument(): JSONContent {
  return JSON.parse(JSON.stringify(EMPTY_DOC)) as JSONContent;
}

export default function NoteEditor({
  content,
  onChange,
  onRequestImage,
}: NoteEditorProps) {
  const [slashOpen, setSlashOpen] = useState(false);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
      }),
      Placeholder.configure({
        placeholder: "Escribe una nota… Usa / para insertar un bloque.",
      }),
    ],
    content,
    editorProps: {
      attributes: {
        class: "note-editor-content",
      },
      handleKeyDown: (view, event) => {
        if (event.key !== "/" || !view.state.selection.empty) return false;
        const { $from } = view.state.selection;
        if ($from.parent.type.name !== "paragraph" || $from.parent.content.size !== 0) {
          return false;
        }
        event.preventDefault();
        setSlashOpen(true);
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      onChange(current.getJSON());
    },
  });

  if (!editor) {
    return <div className="note-editor-loading">Cargando editor…</div>;
  }

  async function insertImage() {
    const dataUrl = await onRequestImage();
    if (dataUrl) {
      editor.chain().focus().setImage({ src: dataUrl }).run();
    }
  }

  function runSlash(command: () => void) {
    setSlashOpen(false);
    command();
  }

  return (
    <div className="note-editor">
      <div className="note-editor-toolbar" aria-label="Formato de nota">
        <button
          className={editor.isActive("bold") ? "active" : ""}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Negrita"
        >
          B
        </button>
        <button
          className={editor.isActive("italic") ? "active" : ""}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Cursiva"
        >
          I
        </button>
        <button
          className={editor.isActive("strike") ? "active" : ""}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          title="Tachado"
        >
          S
        </button>
        <span className="note-editor-divider" />
        <button
          className={editor.isActive("heading", { level: 1 }) ? "active" : ""}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          title="Título"
        >
          H1
        </button>
        <button
          className={editor.isActive("heading", { level: 2 }) ? "active" : ""}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          title="Subtítulo"
        >
          H2
        </button>
        <button
          className={editor.isActive("bulletList") ? "active" : ""}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Lista"
        >
          • Lista
        </button>
        <button
          className={editor.isActive("orderedList") ? "active" : ""}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Lista numerada"
        >
          1. Lista
        </button>
        <button
          className={editor.isActive("blockquote") ? "active" : ""}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          title="Cita"
        >
          ❝
        </button>
        <button
          className={editor.isActive("codeBlock") ? "active" : ""}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          title="Bloque de código"
        >
          {"</>"}
        </button>
        <span className="note-editor-divider" />
        <button onClick={() => void insertImage()} title="Insertar imagen local">
          Imagen
        </button>
        <button
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Deshacer"
        >
          ↶
        </button>
        <button
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Rehacer"
        >
          ↷
        </button>
      </div>

      <div className="note-editor-surface">
        <EditorContent editor={editor} />
        {slashOpen && (
          <div className="slash-menu" role="menu">
            <span className="slash-menu-title">Insertar bloque</span>
            <button
              onClick={() =>
                runSlash(() => editor.chain().focus().toggleHeading({ level: 1 }).run())
              }
            >
              <strong>Título</strong>
              <small>Encabezado principal</small>
            </button>
            <button
              onClick={() =>
                runSlash(() => editor.chain().focus().toggleHeading({ level: 2 }).run())
              }
            >
              <strong>Subtítulo</strong>
              <small>Sección dentro de la nota</small>
            </button>
            <button
              onClick={() =>
                runSlash(() => editor.chain().focus().toggleBulletList().run())
              }
            >
              <strong>Lista</strong>
              <small>Lista con viñetas</small>
            </button>
            <button
              onClick={() =>
                runSlash(() => editor.chain().focus().toggleOrderedList().run())
              }
            >
              <strong>Lista numerada</strong>
              <small>Pasos o elementos ordenados</small>
            </button>
            <button
              onClick={() =>
                runSlash(() => editor.chain().focus().toggleBlockquote().run())
              }
            >
              <strong>Cita</strong>
              <small>Texto destacado</small>
            </button>
            <button
              onClick={() =>
                runSlash(() => editor.chain().focus().toggleCodeBlock().run())
              }
            >
              <strong>Código</strong>
              <small>Bloque monoespaciado</small>
            </button>
            <button
              onClick={() =>
                runSlash(async () => {
                  const dataUrl = await onRequestImage();
                  if (dataUrl) editor.chain().focus().setImage({ src: dataUrl }).run();
                })
              }
            >
              <strong>Imagen</strong>
              <small>Adjuntar archivo local</small>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
