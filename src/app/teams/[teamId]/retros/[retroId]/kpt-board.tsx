import { NoteKind } from "@prisma/client";
import { addNote, updateNote, deleteNote } from "./actions";

type Note = { id: string; kind: NoteKind; content: string };

const COLUMNS: {
  kind: NoteKind;
  label: string;
  hint: string;
  color: string;
}[] = [
  { kind: "KEEP", label: "Keep", hint: "良かった・続けたい", color: "text-keep" },
  { kind: "PROBLEM", label: "Problem", hint: "困った・課題", color: "text-problem" },
  { kind: "TRY", label: "Try", hint: "次に試す", color: "text-try" },
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
          <section key={col.kind} className="card flex flex-col gap-3 p-3">
            <header className="flex items-baseline justify-between">
              <span className={`badge ${col.color}`}>{col.label}</span>
              <span className="text-xs text-muted">{col.hint}</span>
            </header>

            <ul className="flex flex-col gap-2">
              {items.map((note) => (
                <li
                  key={note.id}
                  className="rounded-lg border border-line bg-surface-2 p-2.5 text-sm"
                >
                  <p className="whitespace-pre-wrap break-words">{note.content}</p>
                  <div className="mt-2 flex items-center gap-3 text-xs text-muted">
                    <details>
                      <summary className="cursor-pointer hover:text-ink">
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
                          className="field"
                        />
                        <button type="submit" className="btn btn-primary btn-sm self-start">
                          保存
                        </button>
                      </form>
                    </details>
                    <form action={deleteNote.bind(null, teamId, retroId, note.id)}>
                      <button type="submit" className="hover:text-problem">
                        削除
                      </button>
                    </form>
                  </div>
                </li>
              ))}
              {items.length === 0 && (
                <li className="rounded-lg border border-dashed border-line px-2 py-3 text-center text-xs text-muted">
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
                className="field"
              />
              <button type="submit" className="btn btn-ghost btn-sm self-start">
                ＋ 追加
              </button>
            </form>
          </section>
        );
      })}
    </div>
  );
}
