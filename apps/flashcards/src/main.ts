// Flashcards, the decks screen: the index doc (the app doc) lists the decks,
// and a deck's cards live in a doc of their own, opened while that deck is on
// screen and closed on the way out. Studying is a separate screen over the same
// deck doc plus the person's progress doc, both let go on the way back. The list
// itself also holds every deck doc and the person's progress doc, to show which
// decks have anything to study today.

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
  deleteDeck,
  gradeCard,
  indexDoc,
  listCards,
  listDecks,
  planSession,
  progressDoc,
  renameDeck,
  sessionsTotal,
  setSide,
  type Card,
  type Plan,
  type Side,
  type SideKind,
} from "./model";
import { flavourFor } from "./reward";
import { startSession, type Outcome, type Session } from "./session";

const { doc, actor, me, stale } = await openApp(indexDoc(), SCHEMA);

type Held = ReturnType<typeof openPersistedDoc>;

const decksEl = document.getElementById("decks")!;
const deckEl = document.getElementById("deck")!;
const deckListEl = document.getElementById("deck-list")!;
const cardsEl = document.getElementById("cards")!;
const backEl = document.getElementById("back") as HTMLButtonElement;
const titleEl = document.getElementById("deck-title") as HTMLInputElement;
const cardCountEl = document.getElementById("card-count")!;
const newEl = document.getElementById("new") as HTMLFormElement;
const nameEl = document.getElementById("deck-name") as HTMLInputElement;
const addCardEl = document.getElementById("add-card")!;
const deleteDeckEl = document.getElementById("delete-deck")!;
const unmappedEl = document.getElementById("unmapped")!;
const studyEl = document.getElementById("study")!;
const countEl = document.getElementById("study-count")!;
const progressEl = document.getElementById("study-progress")!;
const barEl = progressEl.firstElementChild as HTMLElement;
const introEl = document.getElementById("study-intro")!;
const frontEl = document.getElementById("study-front")!;
const answerEl = document.getElementById("study-back")!;
const revealEl = document.getElementById("reveal") as HTMLButtonElement;
const gradesEl = document.getElementById("grades")!;
const finishEl = document.getElementById("study-finish")!;
const flavourEl = document.getElementById("study-flavour")!;
const summaryEl = document.getElementById("study-summary")!;
const sessionsEl = document.getElementById("study-sessions")!;
const doneEl = document.getElementById("study-done") as HTMLButtonElement;

// --- Identity: acting needs a handle, since `createdBy` records one and the
// deck names a person by handle everywhere. An unmapped identity still reads
// the decks; every control that would act refuses, and the message says why.
function renderIdentity() {
  unmappedEl.textContent = me.current
    ? ""
    : `${actor} has no handle in the actors directory, so nothing here can be` +
      ` created or edited and there is no handle to study under`;
  watchDecks();
  renderDecks();
  renderCards();
}

// --- A stale bundle has already disconnected its app doc; say so plainly, and
// drop the deck doc it was holding, since it must open no further docs.
let stalled = false;
stale.then(() => {
  stalled = true;
  document.getElementById("stale")!.textContent = "this app is out of date, reload";
  watchDecks();
  showList();
});

// --- Deck status: whether a deck has anything to study today, for the person
// on this device, decided by the same planner Study uses so the two never
// disagree. That needs every deck doc and the progress doc, so they are held
// for as long as the list could show them, following the index. A deck shows
// no status until both have arrived from the server, since a doc still empty
// would plan as nothing to study.
type Watched = { held: Held; arrived: boolean };
let watchedProgress: (Watched & { handle: string }) | null = null;
const watchedDecks = new Map<string, Watched>();

function watch(name: string): Watched {
  const w = { held: openPersistedDoc(name), arrived: false };
  synced(w.held).then(() => {
    w.arrived = true;
    renderDecksSoon();
  });
  w.held.doc.on("update", renderDecksSoon);
  return w;
}

function watchDecks() {
  const handle = stalled ? undefined : me.current?.handle;
  if (watchedProgress?.handle !== handle) {
    watchedProgress?.held.close();
    watchedProgress = handle ? Object.assign(watch(progressDoc(handle)), { handle }) : null;
  }
  const ids = new Set(handle ? decksMap(doc).keys() : []);
  for (const [id, w] of watchedDecks) {
    if (ids.has(id)) continue;
    w.held.close();
    watchedDecks.delete(id);
  }
  for (const id of ids) if (!watchedDecks.has(id)) watchedDecks.set(id, watch(deckDoc(id)));
}

function deckPlan(id: string): Plan | undefined {
  const deck = watchedDecks.get(id);
  if (!watchedProgress?.arrived || !deck?.arrived) return;
  return planSession(watchedProgress.held.doc, id, deck.held.doc, Date.now());
}

// Every edit to any held doc lands here, and a thousand-card deck arrives in
// pieces; one rebuild per frame is plenty.
let renderPending = false;
function renderDecksSoon() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    renderDecks();
  });
}

// The day can turn while the app sits in the background.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) renderDecks();
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
        const meta = document.createElement("div");
        meta.className = "meta";
        const by = document.createElement("span");
        by.className = "by";
        by.textContent = deck.createdBy;
        meta.append(by);
        const plan = deckPlan(id);
        if (plan) {
          const due = plan.review.length;
          const fresh = plan.fresh.length;
          const status = document.createElement("span");
          status.className = "status";
          status.textContent =
            due || fresh
              ? [due && `${due} due`, fresh && `${fresh} new`].filter(Boolean).join(" · ")
              : "done for today ✓";
          li.classList.toggle("done", !due && !fresh);
          meta.append(status);
        }
        const copy = document.createElement("button");
        copy.className = "copy";
        copy.textContent = "Copy";
        copy.addEventListener("click", () => copyDeck(id, deck.name));
        const study = document.createElement("button");
        study.className = "study";
        study.textContent = "Study";
        study.addEventListener("click", () => studyDeck(id));
        li.append(name, meta, copy, study);
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
let open: { id: string; held: Held; loaded: boolean } | null = null;
let rows = new Map<string, { el: HTMLLIElement; num: HTMLElement; show(card: Card): void }>();

function showList() {
  open?.held.close();
  open = null;
  study?.deck.close();
  study?.progress.close();
  study = null;
  rows.clear();
  cardsEl.replaceChildren();
  decksEl.hidden = false;
  deckEl.hidden = true;
  studyEl.hidden = true;
  backEl.hidden = true;
  renderDecks();
}

// The cards, and the controls under them, appear together once the deck has
// arrived from the server; until then an empty list would leave those controls
// sitting under the title. The name is already known from the index.
async function openDeck(id: string, name: string) {
  if (stalled) return;
  showList();
  const held = openPersistedDoc(deckDoc(id));
  open = { id, held, loaded: false };
  titleEl.value = name;
  cardCountEl.textContent = "loading…";
  addCardEl.hidden = deleteDeckEl.hidden = true;
  cardsMap(held.doc).observeDeep(renderCards);
  decksEl.hidden = true;
  deckEl.hidden = false;
  backEl.hidden = false;
  await synced(held);
  if (open?.held !== held) return;
  open.loaded = true;
  addCardEl.hidden = deleteDeckEl.hidden = false;
  renderCards();
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

// Drops the deck from the index and returns to the list; the deck doc itself
// stays where it is, as deleteDeck documents. A confirm stands between a
// stray thumb and losing a deck, since the list holds hand-typed cards.
deleteDeckEl.addEventListener("click", () => {
  if (!me.current || !open) return;
  if (!confirm(`Delete "${titleEl.value}"?`)) return;
  deleteDeck(doc, open.id);
  showList();
});

// An abc side previews as engraved notation. The renderer is by far this app's
// largest dependency, so it is imported only when an abc side is first shown
// and the bundler gives it a chunk of its own; arithmetic decks never fetch it.
async function renderSide(el: HTMLElement, side: Side) {
  if (side.kind !== "abc") {
    el.textContent = side.text;
    return;
  }
  const { renderAbc } = await import("abcjs");
  renderAbc(el, side.text);
  fitNotation(el);
}

// abcjs lays a tune out on a fixed 740px staff, so a one-note snippet lands
// small in the top-left corner of whatever box holds it. Crop the drawing to
// what was actually drawn and let it fill the width, scaling up by at most
// ENGRAVING_ZOOM so a single note is big on a card but a full line is not.
// abcjs also pins the container to the uncropped drawing's height with inline
// style, which would clip the enlarged one; that is undone here too.
const ENGRAVING_ZOOM = 2.5;
function fitNotation(el: HTMLElement) {
  const svg = el.querySelector("svg");
  if (!svg) return;
  const box = svg.getBBox();
  if (!box.width) return;
  const pad = 6;
  const width = box.width + 2 * pad;
  svg.setAttribute("viewBox", `${box.x - pad} ${box.y - pad} ${width} ${box.height + 2 * pad}`);
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.style.display = "block";
  svg.style.width = `${width * ENGRAVING_ZOOM}px`;
  svg.style.maxWidth = "100%";
  svg.style.height = "auto";
  el.style.height = "";
  el.style.overflow = "";
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
      // A plain side is its own preview; only notation needs engraving.
      if (side.kind === "abc") renderSide(preview, side);
      else preview.textContent = "";
    },
  };
}

function cardRow(id: string) {
  const el = document.createElement("li");
  const head = document.createElement("div");
  head.className = "card-head";
  const num = document.createElement("span");
  num.className = "card-num";
  const del = document.createElement("button");
  del.className = "delete";
  del.textContent = "×";
  del.title = "Delete card";
  del.addEventListener("click", () => {
    if (!me.current || !open) return;
    deleteCard(open.held.doc, id);
  });
  head.append(num, del);
  const sides = document.createElement("div");
  sides.className = "sides";
  const front = sideEditor(id, "front");
  const back = sideEditor(id, "back");
  sides.append(front.el, back.el);
  el.append(head, sides);
  return {
    el,
    num,
    show(card: Card) {
      front.show(card.front);
      back.show(card.back);
    },
  };
}

// Rows are rebuilt only when cards appear or vanish; otherwise the fields that
// exist are refreshed in place, so a keystroke never interrupts itself and a
// remote edit to the other side still lands. Numbers are positions, there to
// keep one's place, so they are handed out again whenever the rows are.
function renderCards() {
  if (!open?.loaded) return;
  const cards = listCards(open.held.doc);
  if (cards.length !== rows.size || cards.some(([id]) => !rows.has(id))) {
    rows = new Map(cards.map(([id]) => [id, cardRow(id)]));
    [...rows.values()].forEach((row, i) => (row.num.textContent = `${i + 1}`));
    cardsEl.replaceChildren(...[...rows.values()].map((row) => row.el));
  }
  cardCountEl.textContent = `${cards.length} card${cards.length === 1 ? "" : "s"}`;
  for (const [id, card] of cards) rows.get(id)!.show(card);
}

// --- Study: the deck doc and the person's progress doc, held together for one
// session. An unmapped identity has no handle, so no progress doc and no queue;
// the message above says so and this refuses, like every other acting control.
let study: { deckId: string; deck: Held; progress: Held; session?: Session } | null = null;

async function studyDeck(id: string) {
  const m = me.current;
  if (!m || stalled) return;
  showList();
  const deck = openPersistedDoc(deckDoc(id));
  const progress = openPersistedDoc(progressDoc(m.handle));
  study = { deckId: id, deck, progress };
  decksEl.hidden = true;
  studyEl.hidden = false;
  backEl.hidden = false;
  countEl.textContent = "loading…";
  introEl.hidden = frontEl.hidden = answerEl.hidden = revealEl.hidden = gradesEl.hidden = true;
  finishEl.hidden = progressEl.hidden = true;
  // The session is planned once, only after both docs have arrived: an empty
  // progress doc would make every card look new. Leaving while they load
  // closes them, and then there is nothing to show.
  await Promise.all([synced(deck), synced(progress)]);
  if (study?.deck !== deck) return;
  study.session = startSession(planSession(progress.doc, id, deck.doc, Date.now()));
  renderStudy();
}

// Whatever the machine says is current: an intro shows both sides at once and
// space advances; a prompt shows the front and waits for reveal. Nothing
// current means the session is over.
function renderStudy() {
  const session = study!.session!;
  const cur = session.current();
  if (!cur) {
    renderFinish();
    return;
  }
  // Another client can delete a card mid-session; the plan is a snapshot. The
  // machine has no way to drop a card, so a missing one is answered as a hit
  // whose grade is thrown away, and it works its way out of the queue.
  const card = cardsMap(study!.deck.doc).get(cur.id)?.toJSON() as Card | undefined;
  if (!card) {
    session.answer(cur.phase === "intro" ? "advance" : "hit");
    renderStudy();
    return;
  }
  // Answers still owed, not cards: a bar that fills a step on every tap is
  // what keeps a short session from feeling endless.
  const { done, remaining } = session.summary();
  countEl.textContent = `${remaining} to go`;
  barEl.style.width = `${(100 * done) / (done + remaining)}%`;
  progressEl.hidden = false;
  introEl.hidden = cur.phase !== "intro";
  frontEl.hidden = answerEl.hidden = revealEl.hidden = false;
  gradesEl.hidden = true;
  revealEl.textContent = cur.phase === "intro" ? "Next" : "Show answer";
  // The back is laid out with the front from the start and only veiled until
  // the reveal, so showing it moves nothing that is already on screen.
  answerEl.classList.toggle("veiled", cur.phase !== "intro");
  renderSide(frontEl, card.front);
  renderSide(answerEl, card.back);
}

function renderFinish() {
  const { answered, fresh } = study!.session!.summary();
  introEl.hidden = frontEl.hidden = answerEl.hidden = revealEl.hidden = gradesEl.hidden = true;
  finishEl.hidden = false;
  progressEl.hidden = true;
  countEl.textContent = "";
  // An empty plan reads as done, but it is not a session and gets no fanfare.
  const flavour = answered ? flavourFor(Date.now()) : undefined;
  flavourEl.textContent = flavour?.emoji ?? "";
  flavourEl.className = flavour?.motion ?? "";
  summaryEl.textContent = answered
    ? `${answered} answered, ${fresh} of them new`
    : "nothing to study in this deck today";
  const total = sessionsTotal(study!.progress.doc);
  sessionsEl.textContent = `${total} session${total === 1 ? "" : "s"} so far`;
}

// Reveal and the grades are separate steps on purpose, and a grade is refused
// for a moment after a reveal, so a bounced or held space cannot fall through
// into "got it".
const GRADE_LOCKOUT = 300;
let gradesOpenAt = 0;

function reveal() {
  const session = study!.session!;
  if (session.current()?.phase === "intro") {
    session.answer("advance");
    renderStudy();
    return;
  }
  if (!gradesEl.hidden) return;
  answerEl.classList.remove("veiled");
  revealEl.hidden = true;
  gradesEl.hidden = false;
  gradesOpenAt = Date.now() + GRADE_LOCKOUT;
}

function grade(outcome: Outcome) {
  if (gradesEl.hidden || Date.now() < gradesOpenAt) return;
  const written = study!.session!.answer(outcome);
  if (written) gradeCard(study!.progress.doc, study!.deckId, written.id, written.button);
  renderStudy();
}

// A clicked button keeps focus, and space would then both reveal here and
// click it; dropping focus keeps the keys as the only second path.
revealEl.addEventListener("click", () => {
  revealEl.blur();
  reveal();
});

for (const button of gradesEl.querySelectorAll("button")) {
  button.addEventListener("click", () => {
    button.blur();
    grade(button.dataset.outcome as Outcome);
  });
}

// Keys drive the session only while it is on screen and has cards, and never
// out from under a text field.
document.addEventListener("keydown", (e) => {
  if (studyEl.hidden || !study?.session?.current() || e.repeat) return;
  if ((e.target as HTMLElement).matches("input, textarea, select")) return;
  if (e.key === " ") reveal();
  else if (e.key === "ArrowRight") grade("hit");
  else if (e.key === "ArrowLeft") grade("miss");
  else return;
  e.preventDefault();
});

doneEl.addEventListener("click", showList);

// Any index change can reorder the list or rename the open deck; the list is
// small, so just re-render it.
decksMap(doc).observeDeep(() => {
  watchDecks();
  renderDecks();
  const name = open && decksMap(doc).get(open.id)?.get("name");
  if (typeof name === "string" && document.activeElement !== titleEl) titleEl.value = name;
});

me.observe(renderIdentity);
renderIdentity();
