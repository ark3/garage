import * as Y from "yjs";
import { openDoc } from "@garage/sync";
import { IndexeddbPersistence } from "y-indexeddb";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap } from "@codemirror/commands";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import { body, createNote, deleteNote, listNotes, notesMap, title } from "./model";

const { doc, provider } = openDoc("notes");
new IndexeddbPersistence("notes", doc);

const notes = notesMap(doc);

// --- Identity: name from /whoami, color derived from the name so a person
// is the same color on every device. Cached for offline starts.
const palette = [
  { color: "#30bced", light: "#30bced33" },
  { color: "#6eeb83", light: "#6eeb8333" },
  { color: "#ffbc42", light: "#ffbc4233" },
  { color: "#ecd444", light: "#ecd44433" },
  { color: "#ee6352", light: "#ee635233" },
  { color: "#9ac2c9", light: "#9ac2c933" },
  { color: "#8acb88", light: "#8acb8833" },
  { color: "#1be7ff", light: "#1be7ff33" },
];

function colorFor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return palette[h % palette.length];
}

let me = localStorage.getItem("whoami") ?? "unknown";

function setAwarenessUser() {
  const c = colorFor(me);
  provider.awareness.setLocalStateField("user", {
    name: me,
    color: c.color,
    colorLight: c.light,
  });
}

setAwarenessUser();
fetch("/whoami")
  .then((r) => r.text())
  .then((t) => {
    me = t.trim();
    localStorage.setItem("whoami", me);
    setAwarenessUser();
  })
  .catch(() => {}); // offline: keep the cached name

// --- DOM
const listEl = document.getElementById("list")!;
const editorEl = document.getElementById("editor")!;
const placeholderEl = document.getElementById("placeholder")!;
const newBtn = document.getElementById("new")!;

// --- Editor lifecycle: one EditorView, rebuilt when the selection changes.
let selectedId: string | null = null;
let view: EditorView | null = null;
let teardown: (() => void) | null = null;

function closeEditor() {
  if (teardown) teardown();
  teardown = null;
  if (view) view.destroy();
  view = null;
  selectedId = null;
  editorEl.replaceChildren(placeholderEl);
}

function selectNote(id: string) {
  if (id === selectedId) return;
  closeEditor();
  const note = notes.get(id);
  if (!note) return;
  selectedId = id;
  const ytext = body(note);

  // Debounced updatedAt: order the list without per-keystroke meta churn.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = (_e: Y.YTextEvent, txn: Y.Transaction) => {
    if (!txn.local) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (notes.get(id) === note) note.set("updatedAt", Date.now());
    }, 1500);
  };
  ytext.observe(observer);
  teardown = () => {
    clearTimeout(timer);
    ytext.unobserve(observer);
  };

  editorEl.replaceChildren();
  view = new EditorView({
    state: EditorState.create({
      doc: ytext.toString(),
      extensions: [
        keymap.of([...yUndoManagerKeymap, ...defaultKeymap]),
        EditorView.lineWrapping,
        yCollab(ytext, provider.awareness, {
          undoManager: new Y.UndoManager(ytext),
        }),
      ],
    }),
    parent: editorEl,
  });
  view.focus();
  renderList();
}

// --- Note list
function renderList() {
  listEl.replaceChildren(
    ...listNotes(doc).map(([id, note]) => {
      const li = document.createElement("li");
      if (id === selectedId) li.classList.add("selected");
      const span = document.createElement("span");
      const t = title(note);
      span.className = t ? "title" : "title untitled";
      span.textContent = t || "New note";
      li.append(span);
      const del = document.createElement("button");
      del.className = "delete";
      del.textContent = "×";
      del.title = "Delete note";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteNote(doc, id);
      });
      li.append(del);
      li.addEventListener("click", () => selectNote(id));
      return li;
    }),
  );
}

newBtn.addEventListener("click", () => selectNote(createNote(doc, me)));

// Any change anywhere in the doc can move titles or ordering; the list is
// tiny, so just re-render. If the selected note vanished (remote delete),
// close the editor rather than wedging.
notes.observeDeep(() => {
  if (selectedId && !notes.has(selectedId)) closeEditor();
  renderList();
});

renderList();
