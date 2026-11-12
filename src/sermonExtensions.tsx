import {
  Extension,
  Mark,
  Node,
  mergeAttributes,
  type Editor,
} from "@tiptap/core";
import { Blockquote } from "@tiptap/extension-blockquote";
import { Heading } from "@tiptap/extension-heading";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { useRef } from "react";

export const FillInTheBlank = Mark.create({
  name: "fillInTheBlank",
  inclusive: false,
  parseHTML() {
    return [{ tag: "span[data-sermon-blank]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-sermon-blank": "true",
        class: "sermon-blank",
      }),
      0,
    ];
  },
});

export const SermonBlockquote = Blockquote.extend({
  addAttributes() {
    return {
      ...(this.parent?.() ?? {}),
      background: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-background") ?? "",
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.background
            ? {
                "data-background": String(attributes.background),
                style: `--sermon-quote-bg: ${String(attributes.background)}`,
              }
            : {},
      },
    };
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "blockquote",
      mergeAttributes(HTMLAttributes, { class: "sermon-quote" }),
      0,
    ];
  },
});

export const SermonHeading = Heading.extend({
  renderHTML({ node, HTMLAttributes }) {
    const level = Number(node.attrs.level) || 1;
    return [
      `h${level}`,
      mergeAttributes(HTMLAttributes, {
        class: `sermon-heading sermon-h${level}`,
      }),
      0,
    ];
  },
});

export interface IllustrationOptions {
  onPickImage: (
    apply: (image: { url: string; credit?: string }) => void,
    initialQuery?: string,
  ) => void;
}

function IllustrationView({
  node,
  updateAttributes,
  deleteNode,
  selected,
  extension,
}: NodeViewProps) {
  const titleRef = useRef<HTMLInputElement>(null);
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const imageUrl = String(node.attrs.imageUrl ?? "");
  const credit = String(node.attrs.credit ?? "");
  const options = extension.options as IllustrationOptions;

  function commit() {
    updateAttributes({
      title: titleRef.current?.value ?? "",
      caption: captionRef.current?.value ?? "",
    });
  }

  function pickImage() {
    options.onPickImage((image) => {
      updateAttributes({
        imageUrl: image.url,
        credit: image.credit ?? "",
      });
    }, titleRef.current?.value || "sermón");
  }

  return (
    <NodeViewWrapper
      className={`sermon-illustration-node${selected ? " selected" : ""}`}
      data-sermon-illustration="true"
      contentEditable={false}
    >
      <div className="sermon-illustration-media">
        {imageUrl ? (
          <img src={imageUrl} alt={String(node.attrs.title ?? "")} />
        ) : (
          <div className="sermon-illustration-empty">
            <span>Sin imagen</span>
            <small>Busca una foto para esta ilustración.</small>
          </div>
        )}
      </div>
      <div className="sermon-illustration-fields">
        <input
          ref={titleRef}
          className="sermon-illustration-title"
          defaultValue={String(node.attrs.title ?? "Ilustración")}
          placeholder="Título de la ilustración"
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
        <textarea
          ref={captionRef}
          className="sermon-illustration-caption"
          defaultValue={String(node.attrs.caption ?? "")}
          placeholder="Pie de foto o idea que ilustra…"
          rows={2}
          onBlur={commit}
        />
        {credit && <small className="sermon-illustration-credit">{credit}</small>}
        <div className="sermon-illustration-actions">
          <button type="button" onClick={pickImage}>
            Buscar imagen
          </button>
          {imageUrl && (
            <button
              type="button"
              onClick={() => updateAttributes({ imageUrl: "", credit: "" })}
            >
              Quitar imagen
            </button>
          )}
          <button
            type="button"
            className="danger"
            onClick={() => deleteNode()}
          >
            Eliminar
          </button>
        </div>
      </div>
    </NodeViewWrapper>
  );
}

export const SermonIllustration = Node.create<IllustrationOptions>({
  name: "sermonIllustration",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addOptions() {
    return {
      onPickImage: () => {},
    };
  },
  addAttributes() {
    return {
      title: { default: "Ilustración" },
      caption: { default: "" },
      imageUrl: { default: "" },
      credit: { default: "" },
      background: { default: "" },
    };
  },
  parseHTML() {
    return [
      {
        tag: "figure[data-sermon-illustration]",
        getAttrs: (element) => {
          const figure = element as HTMLElement;
          const image = figure.querySelector("img");
          return {
            title: figure.getAttribute("data-title") ?? "Ilustración",
            caption: figure.getAttribute("data-caption") ?? "",
            imageUrl: image?.getAttribute("src") ?? "",
            credit: figure.getAttribute("data-credit") ?? "",
            background: figure.getAttribute("data-background") ?? "",
          };
        },
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const title = String(node.attrs.title ?? "Ilustración");
    const caption = String(node.attrs.caption ?? "");
    const imageUrl = String(node.attrs.imageUrl ?? "");
    const credit = String(node.attrs.credit ?? "");
    const children: unknown[] = [];
    if (imageUrl) {
      children.push(["img", { src: imageUrl, alt: title }]);
    }
    children.push(["figcaption", {}, title]);
    if (caption) {
      children.push(["p", { class: "sermon-illustration-caption" }, caption]);
    }
    if (credit) {
      children.push(["small", { class: "sermon-illustration-credit" }, credit]);
    }
    return [
      "figure",
      mergeAttributes(HTMLAttributes, {
        "data-sermon-illustration": "true",
        "data-title": title,
        "data-caption": caption,
        "data-credit": credit,
        "data-background": String(node.attrs.background ?? ""),
        class: "sermon-illustration",
      }),
      ...children,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(IllustrationView);
  },
});

export const SermonBiblePassage = Node.create({
  name: "biblePassage",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      reference: { default: "Pasaje bíblico" },
      text: { default: "" },
      translation: { default: "" },
      book: { default: 0 },
      chapter: { default: 1 },
      verse: { default: 1 },
      endVerse: { default: 1 },
      background: { default: "" },
    };
  },
  parseHTML() {
    return [
      {
        tag: "aside[data-sermon-passage]",
        getAttrs: (element) => {
          const aside = element as HTMLElement;
          return {
            reference: aside.getAttribute("data-reference") ?? "Pasaje bíblico",
            text: aside.querySelector("p")?.textContent ?? "",
            translation: aside.getAttribute("data-translation") ?? "",
            background: aside.getAttribute("data-background") ?? "",
          };
        },
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const reference = String(node.attrs.reference ?? "Pasaje bíblico");
    const text = String(node.attrs.text ?? "");
    const translation = String(node.attrs.translation ?? "");
    return [
      "aside",
      mergeAttributes(HTMLAttributes, {
        "data-sermon-passage": "true",
        "data-reference": reference,
        "data-translation": translation,
        "data-background": String(node.attrs.background ?? ""),
        class: "sermon-passage",
      }),
      ["header", {}, reference, translation ? ` · ${translation}` : ""],
      ["p", {}, text],
    ];
  },
});

export const SermonOutlineExtension = Extension.create<{
  onChange: (editor: Editor) => void;
}>({
  name: "sermonOutline",
  addOptions() {
    return {
      onChange: () => {},
    };
  },
  onCreate() {
    this.options.onChange(this.editor);
  },
  onUpdate() {
    this.options.onChange(this.editor);
  },
});
