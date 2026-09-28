// Every note gets an icon: new notes start with a random emoji from this friendly set (people can pick
// any other emoji from the picker, but a note is never left without one).
export const NOTE_EMOJI = [
  "📝", "📓", "📒", "📔", "📕", "📗", "📘", "📙", "📚", "🗒️", "🗂️", "📌", "📎", "✏️", "🖋️", "🖍️", "📐", "🧭", "🗺️", "🧩",
  "💡", "🔑", "🎯", "🎨", "🎵", "🎬", "📷", "🔭", "🔬", "🧪", "🧠", "💼", "🎁", "🏷️", "🪴", "🌿", "🍀", "🌱", "🌵", "🌲",
  "🌸", "🌻", "🌷", "🌼", "🍂", "🍁", "🌊", "⛰️", "🏔️", "🏝️", "☀️", "🌙", "⭐️", "🌈", "❄️", "🔥", "☕️", "🍵", "🍋", "🍓",
  "🍎", "🍐", "🥐", "🧁", "🍯", "🧺", "🏡", "🏠", "⛺️", "🚲", "⛵️", "⛴️", "✈️", "🚀", "🎈", "🪁", "🧸", "🪄", "🔮", "🕯️",
  "🧵", "🧶", "🪡", "🛋️", "🪞", "🪟", "🗝️", "⏳", "⌛️", "🧿", "🐚", "🦋", "🐝", "🐞", "🐢", "🦊", "🐳", "🦉", "🐈", "🐕",
] as const;

/** A random note emoji (pass a random source for deterministic results). */
export function randomNoteEmoji(random: () => number = Math.random): string {
  return NOTE_EMOJI[Math.floor(random() * NOTE_EMOJI.length)]!;
}
