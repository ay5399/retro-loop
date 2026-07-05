import { NoteKind } from "@prisma/client";
import { addNote, updateNote, deleteNote } from "./actions";

type Note = { id: string; kind: NoteKind; content: string };

const COLUMNS: { kind: NoteKind; label: string; hint: string }[] = [
  { kind: "KEEP", label: "Keep", hint: "良かった・続けたいこと" },
  { kind: "PROBLEM", label: "Problem", hint: "困った・課題" },
  { kind: "TRY", label: "Try", hint: "次に試すこと" },
];

export function KptBoard({
  teamId,
  retroId,
  notes,
}: {
  teamId: string;
  retroId: string;
  notes: Note[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {COLUMNS.map((col) => {
        const items = notes.filter((n) => n.kind === col.kind);
        const add = addNote.bind(null, teamId, retroId, col.kind);
        return (
          <section
            key={col.kind}
            className="flex flex-col gap-3 rounded-md border border-black/10 p-3 dark:border-white/15"
          >
            <header>
              <h3 className="text-sm font-semibold">{col.label}</h3>
              <p className="text-xs text-black/40 dark:text-white/40">{col.hint}</p>
            </header>

            <ul className="flex flex-col gap-2">
              {items.map((note) => (
                <li
                  key={note.id}
                  className="rounded border border-black/10 bg-black/[.02] p-2 text-sm dark:border-white/10 dark:bg-white/[.03]"
                >
                  <p className="whitespace-pre-wrap break-words">{note.content}</p>
                  <div className="mt-1 flex items-center gap-3 text-xs">
                    <details>
                      <summary className="cursor-pointer text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white">
                        編集
                      </summary>
                      <form
                        action={updateNote.bind(null, teamId, retroId, note.id)}
                        className="mt-2 flex flex-col gap-2"
                      >
                        <textarea
                          name="content"
                          defaultValue={note.content}
                          required
                          rows={2}
                          className="w-full rounded border border-black/15 bg-transparent px-2 py-1 text-sm outline-none focus:border-black/40 dark:border-white/20"
                        />
                        <button
                          type="submit"
                          className="self-start rounded bg-foreground px-2 py-1 text-xs font-medium text-background hover:opacity-90"
                        >
                          保存
                        </button>
                      </form>
                    </details>
                    <form action={deleteNote.bind(null, teamId, retroId, note.id)}>
                      <button
                        type="submit"
                        className="text-black/50 hover:text-red-600 dark:text-white/50 dark:hover:text-red-400"
                      >
                        削除
                      </button>
                    </form>
                  </div>
                </li>
              ))}
              {items.length === 0 && (
                <li className="rounded border border-dashed border-black/10 p-2 text-center text-xs text-black/30 dark:border-white/10 dark:text-white/30">
                  まだありません
                </li>
              )}
            </ul>

            <form action={add} className="flex flex-col gap-2">
              <textarea
                name="content"
                required
                rows={2}
                placeholder={`${col.label} を追加`}
                className="w-full rounded border border-black/15 bg-transparent px-2 py-1 text-sm outline-none focus:border-black/40 dark:border-white/20"
              />
              <button
                type="submit"
                className="self-start rounded border border-black/15 px-2 py-1 text-xs transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                ＋ 追加
              </button>
            </form>
          </section>
        );
      })}
    </div>
  );
}
