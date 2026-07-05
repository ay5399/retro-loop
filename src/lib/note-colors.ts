// 付箋の色パレット（Backend の検証と Frontend のスウォッチで共有する契約）。
// 対応する CSS 変数 --note-<key> は globals.css で定義する。null = デフォルト（色なし）。
export const NOTE_COLORS = [
  "yellow",
  "green",
  "blue",
  "pink",
  "purple",
  "gray",
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number];

export function isNoteColor(value: unknown): value is NoteColor {
  return (
    typeof value === "string" &&
    (NOTE_COLORS as readonly string[]).includes(value)
  );
}
