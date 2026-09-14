// Flashcards, the decks screen: the index doc (the app doc) lists the decks,
// and a deck's cards live in a doc of their own, opened while that deck is on
// screen and closed on the way out. Studying is a separate screen.

import { openApp, openPersistedDoc } from "@garage/sync";
import {
  SCHEMA,
  addCard,
  cardsMap,
  copyCards,
  createDeck,
  deckDoc,
  decksMap,
  deleteCard,
  indexDoc,
  listCards,
  listDecks,
  renameDeck,
  setSide,
  type Card,
  type Side,
  type SideKind,
} from "./model";

const { doc, actor, me, stale } = await openApp(indexDoc(), SCHEMA);

type Held = ReturnType<typeof openPersistedDoc>;

const decksEl = document.getElementById("decks")!;
const deckEl = document.getElementById("deck")!;
const deckListEl = document.getElementById("deck-list")!;
const cardsEl = document.getElementById("cards")!;
const backEl = document.getElementById("back") as HTMLButtonElement;
const titleEl = document.getElementById("deck-title") as HTMLInputElement;
const newEl = document.getElementById("new") as HTMLFormElement;
const nameEl = document.getElementById("deck-name") as HTMLInputElement;
const addCardEl = document.getElementById("add-card")!;
const unmappedEl = document.getElementById("unmapped")!;

// --- Identity: acting needs a handle, since `createdBy` records one and the
// deck names a person by handle everywhere. An unmapped identity still reads
// the decks; every control that would act refuses, and the message says why.
function renderIdentity() {
  unmappedEl.textContent = me.current
    ? ""
    : `${actor} has no handle in the actors directory, so nothing here can be created or edited`;
  renderDecks();
  renderCards();
}

// --- A stale bundle has already disconnected its app doc; say so plainly, and
// drop the deck doc it was holding, since it must open no further docs.
let stalled = false;
stale.then(() => {
  stalled = true;
  document.getElementById("stale")!.textContent = "this app is out of date, reload";
  showList();
});

// --- Deck list
function renderDecks() {
  deckListEl.replaceChildren(
    ...listDecks(doc)
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([id, deck]) => {
        const li = document.createElement("li");
        const name = document.createElement("button");
        name.className = "name";
        name.textContent = deck.name;
        name.addEventListener("click", () => openDeck(id, deck.name));
        const by = document.createElement("span");
        by.className = "by";
        by.textContent = deck.createdBy;
        const copy = document.createElement("button");
        copy.textContent = "Copy";
        copy.addEventListener("click", () => copyDeck(id, deck.name));
        li.append(name, by, copy);
        return li;
      }),
  );
}

newEl.addEventListener("submit", (e) => {
  e.preventDefault();
  const m = me.current;
  const name = nameEl.value.trim();
  if (!m || !name) return;
  createDeck(doc, name, m.handle);
  nameEl.value = "";
});

// The copy carries the source deck's card ids, so progress on them still
// resolves; that means reading the source, which means waiting for its doc to
// arrive. Both docs are let go once the copy is written.
function synced(held: Held): Promise<void> {
  return new Promise((resolve) => held.provider.once("synced", () => resolve()));
}

async function copyDeck(id: string, name: string) {
  const m = me.current;
  if (!m || stalled) return;
  const from = openPersistedDoc(deckDoc(id));
  const to = openPersistedDoc(deckDoc(createDeck(doc, `${name} copy`, m.handle)));
  await Promise.all([synced(from), synced(to)]);
  copyCards(from.doc, to.doc);
  from.close();
  to.close();
}

// --- Deck editor: one deck doc held at a time.
let open: { id: string; held: Held } | null = null;
let rows = new Map<string, { el: HTMLLIElement; show(card: Card): void }>();

function showList() {
  open?.held.close();
  open = null;
  rows.clear();
  cardsEl.replaceChildren();
  decksEl.hidden = false;
  deckEl.hidden = true;
  backEl.hidden = true;
}

function openDeck(id: string, name: string) {
  if (stalled) return;
  showList();
  open = { id, held: openPersistedDoc(deckDoc(id)) };
  titleEl.value = name;
  cardsMap(open.held.doc).observeDeep(renderCards);
  renderCards();
  decksEl.hidden = true;
  deckEl.hidden = false;
  backEl.hidden = false;
}

backEl.addEventListener("click", showList);

titleEl.addEventListener("input", () => {
  if (!me.current || !open) return;
  renameDeck(doc, open.id, titleEl.value);
});

addCardEl.addEventListener("click", () => {
  if (!me.current || !open) return;
  addCard(open.held.doc, { kind: "plain", text: "" }, { kind: "plain", text: "" });
});

// An abc side previews as engraved notation. The renderer is by far this app's
// largest dependency, so it is imported only when an abc side is first shown
// and the bundler gives it a chunk of its own; arithmetic decks never fetch it.
// `responsive` keeps the engraving inside a phone's width rather than abcjs's
// 770px default.
async function renderSide(el: HTMLElement, side: Side) {
  if (side.kind !== "abc") {
    el.textContent = side.text;
    return;
  }
  const { renderAbc } = await import("abcjs");
  renderAbc(el, side.text, { responsive: "resize" });
}

function sideEditor(cardId: string, which: "front" | "back") {
  const el = document.createElement("div");
  el.className = "side";
  const label = document.createElement("label");
  label.textContent = which;
  const kind = document.createElement("select");
  for (const k of ["plain", "abc"] as SideKind[]) {
    const option = document.createElement("option");
    option.value = k;
    option.textContent = k;
    kind.append(option);
  }
  const text = document.createElement("textarea");
  const preview = document.createElement("div");
  preview.className = "preview";
  // A side is replaced whole, so kind and text are always written together.
  const write = () => {
    if (!me.current || !open) return;
    setSide(open.held.doc, cardId, which, { kind: kind.value as SideKind, text: text.value });
  };
  kind.addEventListener("change", write);
  text.addEventListener("input", write);
  el.append(label, kind, text, preview);
  return {
    el,
    show(side: Side) {
      kind.disabled = text.disabled = !me.current;
      if (document.activeElement !== kind) kind.value = side.kind;
      if (document.activeElement !== text) text.value = side.text;
      renderSide(preview, side);
    },
  };
}

function cardRow(id: string) {
  const el = document.createElement("li");
  const head = document.createElement("div");
  head.className = "card-head";
  const del = document.createElement("button");
  del.className = "delete";
  del.textContent = "×";
  del.title = "Delete card";
  del.addEventListener("click", () => {
    if (!me.current || !open) return;
    deleteCard(open.held.doc, id);
  });
  head.append(del);
  const sides = document.createElement("div");
  sides.className = "sides";
  const front = sideEditor(id, "front");
  const back = sideEditor(id, "back");
  sides.append(front.el, back.el);
  el.append(head, sides);
  return {
    el,
    show(card: Card) {
      front.show(card.front);
      back.show(card.back);
    },
  };
}

// Rows are rebuilt only when cards appear or vanish; otherwise the fields that
// exist are refreshed in place, so a keystroke never interrupts itself and a
// remote edit to the other side still lands. A thousand-card deck arrives over
// a second or two, and the rows fill in as it does.
function renderCards() {
  if (!open) return;
  const cards = listCards(open.held.doc);
  if (cards.length !== rows.size || cards.some(([id]) => !rows.has(id))) {
    rows = new Map(cards.map(([id]) => [id, cardRow(id)]));
    cardsEl.replaceChildren(...[...rows.values()].map((row) => row.el));
  }
  for (const [id, card] of cards) rows.get(id)!.show(card);
}

// Any index change can reorder the list or rename the open deck; the list is
// small, so just re-render it.
decksMap(doc).observeDeep(() => {
  renderDecks();
  const name = open && decksMap(doc).get(open.id)?.get("name");
  if (typeof name === "string" && document.activeElement !== titleEl) titleEl.value = name;
});

me.observe(renderIdentity);
renderIdentity();
