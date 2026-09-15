// The completion moment's decoration: one flavour per local calendar day, the
// same on every device that morning, scrambled so consecutive days do not
// simply cycle. Each flavour is an emoji line and the name of a CSS animation
// in index.html.

export type Flavour = { emoji: string; motion: string };

export const FLAVOURS: Flavour[] = [
  { emoji: "🎉🎊🎉", motion: "bounce" },
  { emoji: "🌟✨🌟", motion: "spin" },
  { emoji: "🚀🌙🚀", motion: "rise" },
  { emoji: "🦄🌈🦄", motion: "wiggle" },
  { emoji: "🐙🎈🐙", motion: "pulse" },
];

export function flavourFor(now: number): Flavour {
  const d = new Date(now);
  const day = d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate();
  let h = Math.imul(day ^ (day >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return FLAVOURS[(h >>> 0) % FLAVOURS.length];
}
