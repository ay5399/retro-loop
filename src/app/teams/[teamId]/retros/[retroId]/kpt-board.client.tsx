"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { addNote, updateNote, deleteNote, moveNote, setNoteColor } from "./actions";
import { NOTE_COLORS, type NoteColor } from "@/lib/note-colors";

type NoteKind = "KEEP" | "PROBLEM" | "TRY";

type NoteDTO = {
  id: string;
  kind: NoteKind;
  content: string;
  order: number;
  color: string | null;
  groupId: string | null;
  voteCount: number;
  hasVoted: boolean;
};

type Props = { teamId: string; retroId: string; notes: NoteDTO[] };

type MoveAction = { noteId: string; toKind: NoteKind; toIndex: number };

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

const KINDS: NoteKind[] = ["KEEP", "PROBLEM", "TRY"];

function isKind(value: string): value is NoteKind {
  return value === "KEEP" || value === "PROBLEM" || value === "TRY";
}

// 楽観状態のレデューサ。対象付箋を取り除き、指定レーンの toIndex に差し込む。
// レーンごとの並びは配列順で表現するため、order フィールドではなく配列位置が真実。
function moveReducer(state: NoteDTO[], action: MoveAction): NoteDTO[] {
  const moving = state.find((n) => n.id === action.noteId);
  if (!moving) return state;

  const lanes: Record<NoteKind, NoteDTO[]> = { KEEP: [], PROBLEM: [], TRY: [] };
  for (const n of state) {
    if (n.id === action.noteId) continue;
    lanes[n.kind].push(n);
  }
  const updated: NoteDTO = { ...moving, kind: action.toKind };
  const target = lanes[action.toKind];
  const idx = Math.max(0, Math.min(action.toIndex, target.length));
  target.splice(idx, 0, updated);

  return [...lanes.KEEP, ...lanes.PROBLEM, ...lanes.TRY];
}

export function KptBoardClient({ teamId, retroId, notes }: Props) {
  // サーバ props を真実源にする（useState を真実源にしない）。
  // 表示順はレーン内 order でソートした配列位置で表す。
  const baseNotes = useMemo(
    () => [...notes].sort((a, b) => a.order - b.order),
    [notes],
  );

  const [optimisticNotes, applyMove] = useOptimistic(baseNotes, moveReducer);
  // 色専用の軽い楽観状態: noteId -> 色キー(または null)。
  // base は空オブジェクトなので、transition 完了・revalidate 後は props(note.color) が真実源に戻る。
  const [colorOverrides, applyColor] = useOptimistic<
    Record<string, NoteColor | null>,
    { noteId: string; color: NoteColor | null }
  >({}, (state, action) => ({ ...state, [action.noteId]: action.color }));
  const [, startTransition] = useTransition();
  const [activeId, setActiveId] = useState<string | null>(null);

  // 色の楽観上書きを適用した表示用ノート。並び(move)とは独立に色だけ差し替える。
  const displayNotes = useMemo(
    () =>
      optimisticNotes.map((n) =>
        n.id in colorOverrides ? { ...n, color: colorOverrides[n.id] } : n,
      ),
    [optimisticNotes, colorOverrides],
  );

  // 色変更を楽観適用してからサーバへ確定する。move と同じ作法で transition 内 await。
  function handleSetColor(noteId: string, color: NoteColor | null) {
    startTransition(async () => {
      applyColor({ noteId, color });
      await setNoteColor(teamId, retroId, noteId, color);
    });
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // レーン別のノート id リスト（SortableContext 用）。
  const laneItems = useMemo(() => {
    const map: Record<NoteKind, string[]> = { KEEP: [], PROBLEM: [], TRY: [] };
    for (const n of optimisticNotes) map[n.kind].push(n.id);
    return map;
  }, [optimisticNotes]);

  // over.id がレーン id でもノート id でも、その所属レーンを解決する。
  const laneOf = (id: string): NoteKind | null => {
    if (isKind(id)) return id;
    const note = optimisticNotes.find((n) => n.id === id);
    return note ? note.kind : null;
  };

  const activeNote = activeId
    ? optimisticNotes.find((n) => n.id === activeId) ?? null
    : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const noteId = String(active.id);
    const overId = String(over.id);
    if (overId === noteId) return; // 自分自身へのドロップ=変化なし
    const toKind = laneOf(overId);
    if (!toKind) return;
    const fromKind = laneOf(noteId);

    // 対象レーンから active を除いた並びを基準に差し込み位置を求める。
    const targetIds = laneItems[toKind].filter((id) => id !== noteId);
    let toIndex: number;
    if (isKind(overId)) {
      toIndex = targetIds.length; // 空レーン/レーン枠へのドロップ = 末尾
    } else {
      const overPos = targetIds.indexOf(overId);
      if (overPos === -1) {
        toIndex = targetIds.length;
      } else if (fromKind === toKind) {
        // 同レーン内: 下方向(active が over より上にある)なら over の後ろへ差し込む
        const fullLane = laneItems[toKind];
        const draggingDown = fullLane.indexOf(noteId) < fullLane.indexOf(overId);
        toIndex = draggingDown ? overPos + 1 : overPos;
      } else {
        toIndex = overPos; // レーン跨ぎ: over の手前へ
      }
    }

    const fromIndex = laneItems[toKind].indexOf(noteId);
    // 位置に変化が無ければ何もしない。
    if (fromKind === toKind && fromIndex === toIndex) return;

    // 楽観更新をサーバ反映(revalidate)まで保持するため transition 内で await する。
    // await しないと transition が即完了し、再描画が届くまで旧位置に戻ってちらつく。
    startTransition(async () => {
      applyMove({ noteId, toKind, toIndex });
      await moveNote(teamId, retroId, { noteId, toKind, toIndex });
    });
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {COLUMNS.map((col) => (
          <Lane
            key={col.kind}
            teamId={teamId}
            retroId={retroId}
            column={col}
            itemIds={laneItems[col.kind]}
            notes={displayNotes.filter((n) => n.kind === col.kind)}
            onSetColor={handleSetColor}
          />
        ))}
      </div>

      <DragOverlay>
        {activeNote ? <NoteCardBody content={activeNote.content} dragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function Lane({
  teamId,
  retroId,
  column,
  itemIds,
  notes,
  onSetColor,
}: {
  teamId: string;
  retroId: string;
  column: { kind: NoteKind; label: string; hint: string; color: string };
  itemIds: string[];
  notes: NoteDTO[];
  onSetColor: (noteId: string, color: NoteColor | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.kind });
  const add = addNote.bind(null, teamId, retroId, column.kind);

  return (
    <section
      ref={setNodeRef}
      data-lane={column.kind}
      className={`card flex flex-col gap-3 p-3 ${
        isOver ? "border-line-strong" : ""
      }`}
    >
      <header className="flex items-baseline justify-between">
        <span className={`badge ${column.color}`}>{column.label}</span>
        <span className="text-xs text-muted">{column.hint}</span>
      </header>

      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col gap-2">
          {notes.map((note) => (
            <SortableNote
              key={note.id}
              teamId={teamId}
              retroId={retroId}
              note={note}
              onSetColor={onSetColor}
            />
          ))}
          {notes.length === 0 && (
            <li className="rounded-lg border border-dashed border-line px-2 py-3 text-center text-xs text-muted">
              まだありません
            </li>
          )}
        </ul>
      </SortableContext>

      <form action={add} className="flex flex-col gap-2">
        <textarea
          name="content"
          required
          rows={2}
          placeholder={`${column.label} を追加`}
          className="field"
        />
        <button type="submit" className="btn btn-ghost btn-sm self-start">
          ＋ 追加
        </button>
      </form>
    </section>
  );
}

function SortableNote({
  teamId,
  retroId,
  note,
  onSetColor,
}: {
  teamId: string;
  retroId: string;
  note: NoteDTO;
  onSetColor: (noteId: string, color: NoteColor | null) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: note.id });

  const [pickerOpen, setPickerOpen] = useState(false);

  // 色があればその CSS 変数を背景に敷く。null なら既定の bg-surface-2 のまま。
  const colored = note.color != null && note.color !== "";
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
    ...(colored ? { background: `var(--note-${note.color})` } : {}),
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-note-id={note.id}
      data-note-color={note.color ?? ""}
      className={`rounded-lg border border-line p-2.5 text-sm ${
        colored ? "" : "bg-surface-2"
      }`}
    >
      <div className="flex items-start gap-2">
        {/* ドラッグはこのハンドルに限定。listeners/attributes をここだけに付与。 */}
        <button
          type="button"
          aria-label="ドラッグして移動"
          className="mt-0.5 cursor-grab touch-none rounded px-1 text-muted hover:text-ink"
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-wrap break-words">{note.content}</p>
          <div className="mt-2 flex items-center gap-3 text-xs text-muted">
            <details>
              <summary className="cursor-pointer hover:text-ink">編集</summary>
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
                <button
                  type="submit"
                  className="btn btn-primary btn-sm self-start"
                >
                  保存
                </button>
              </form>
            </details>
            <button
              type="button"
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((v) => !v)}
              className="cursor-pointer hover:text-ink"
            >
              色
            </button>
            <form action={deleteNote.bind(null, teamId, retroId, note.id)}>
              <button type="submit" className="hover:text-problem">
                削除
              </button>
            </form>
          </div>

          {pickerOpen && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {NOTE_COLORS.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-label={`色: ${key}`}
                  aria-pressed={note.color === key}
                  onClick={() => {
                    onSetColor(note.id, key);
                    setPickerOpen(false);
                  }}
                  style={{ background: `var(--note-${key})` }}
                  className={`h-6 w-6 rounded-full border ${
                    note.color === key
                      ? "border-line-strong ring-2 ring-line-strong"
                      : "border-line"
                  }`}
                />
              ))}
              <button
                type="button"
                aria-label="色をクリア（デフォルトに戻す）"
                onClick={() => {
                  onSetColor(note.id, null);
                  setPickerOpen(false);
                }}
                className="ml-1 rounded border border-line px-2 py-1 text-xs text-muted hover:text-ink"
              >
                クリア
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

// DragOverlay 用の静的なカード表示。
function NoteCardBody({
  content,
  dragging,
}: {
  content: string;
  dragging?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border border-line bg-surface-2 p-2.5 text-sm ${
        dragging ? "shadow-lg" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 px-1 text-muted">⠿</span>
        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">
          {content}
        </p>
      </div>
    </div>
  );
}
