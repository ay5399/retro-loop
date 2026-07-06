"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { addNote, updateNote, deleteNote, moveNote, setNoteColor, toggleVote } from "./actions";
import { createGroup, renameGroup, ungroup } from "./actions";
import { NOTE_COLORS, type NoteColor } from "@/lib/note-colors";
import { MAX_VOTES_PER_USER } from "@/lib/votes";

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

// グループ（視覚的なまとまり）。Backend が渡す。付箋は Note.groupId でこれを参照する。
type GroupDTO = { id: string; kind: NoteKind; name: string | null };

type Props = {
  teamId: string;
  retroId: string;
  notes: NoteDTO[];
  votesUsed: number;
  groups: GroupDTO[];
};

// 票用の軽い楽観状態: noteId -> 表示中の投票状態。
type VoteState = { voted: boolean; count: number };

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

// レーン内 id 列を groupId でまとめる（同 group を隣接させる）。
// - ungrouped(null) は元の位置のまま。
// - group は初出位置にブロックを固め、そのメンバーを元順で並べる。
// 全付箋が groupId=null のときは恒等（＝既存の並びをそのまま返す）なので、
// グループ未使用時は move の並びに一切影響しない。
function clusterByGroup(
  ids: string[],
  groupOf: (id: string) => string | null,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const g = groupOf(id);
    if (g == null) {
      out.push(id);
      continue;
    }
    if (seen.has(g)) continue; // このグループのブロックは初出時に一括で出す
    seen.add(g);
    for (const other of ids) if (groupOf(other) === g) out.push(other);
  }
  return out;
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

export function KptBoardClient({ teamId, retroId, notes, votesUsed, groups }: Props) {
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
  // 投票専用の軽い楽観状態: noteId -> {voted, count}。
  // color の colorOverrides と同型。base は空なので revalidate 後は props に収束する。
  const [voteOverrides, applyVote] = useOptimistic<
    Record<string, VoteState>,
    { noteId: string; vote: VoteState }
  >({}, (state, action) => ({ ...state, [action.noteId]: action.vote }));
  const [, startTransition] = useTransition();
  const [activeId, setActiveId] = useState<string | null>(null);
  // グループ化の選択状態（クライアントのみ。楽観にはしない）。
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // ドラッグ中のライブな並び（レーンごとの id 配列）。ドラッグ中のみ非 null。
  // onDragOver でコンテナ間移動を反映し、跨ぎでもドロップ前に見た目が対象レーンへ入る。
  // ドロップ後は null に戻し、楽観状態(optimisticNotes)由来の laneItems に収束させる。
  const [dragLanes, setDragLanes] = useState<Record<NoteKind, string[]> | null>(
    null,
  );

  // グループ id -> メタ情報。ヘッダのグループ名表示に使う。
  const groupById = useMemo(() => {
    const m = new Map<string, GroupDTO>();
    for (const g of groups) m.set(g.id, g);
    return m;
  }, [groups]);

  // 色変更を楽観適用してからサーバへ確定する。move と同じ作法で transition 内 await。
  function handleSetColor(noteId: string, color: NoteColor | null) {
    startTransition(async () => {
      applyColor({ noteId, color });
      await setNoteColor(teamId, retroId, noteId, color);
    });
  }

  // 投票トグルを楽観適用してからサーバへ確定する。color/move と同じ作法で transition 内 await。
  // current は表示中（楽観反映済み）の状態。反転して即時に見た目を更新する。
  function handleToggleVote(noteId: string, current: VoteState) {
    const nextVoted = !current.voted;
    const vote: VoteState = {
      voted: nextVoted,
      count: current.count + (nextVoted ? 1 : -1),
    };
    startTransition(async () => {
      applyVote({ noteId, vote });
      await toggleVote(teamId, retroId, noteId);
    });
  }

  // 付箋の選択トグル（まとめる対象の集合を作る）。
  function toggleSelect(noteId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }

  // 選択した付箋をグループ化する。楽観にはせず、サーバ確定→revalidate で反映する。
  // 成功後に選択状態をクリアする。
  function handleCreateGroup(kind: NoteKind, noteIds: string[]) {
    if (noteIds.length < 2) return;
    startTransition(async () => {
      await createGroup(teamId, retroId, { kind, noteIds });
      setSelectedIds(new Set());
    });
  }

  function handleRenameGroup(groupId: string, name: string) {
    startTransition(async () => {
      await renameGroup(teamId, retroId, groupId, name);
    });
  }

  function handleUngroup(groupId: string) {
    startTransition(async () => {
      await ungroup(teamId, retroId, groupId);
    });
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // サーバ props(楽観 move 反映後)由来のレーン別 id リスト。確定後の真実源。
  const laneItems = useMemo(() => {
    const map: Record<NoteKind, string[]> = { KEEP: [], PROBLEM: [], TRY: [] };
    for (const n of optimisticNotes) map[n.kind].push(n.id);
    return map;
  }, [optimisticNotes]);

  // id -> ノート の索引（表示用の元データ）。
  const noteById = useMemo(() => {
    const m = new Map<string, NoteDTO>();
    for (const n of optimisticNotes) m.set(n.id, n);
    return m;
  }, [optimisticNotes]);

  // 表示に使うレーン。ドラッグ中は dragLanes（ライブ・クラスタリングしない）、
  // 静止時は laneItems を groupId でまとめた並び。
  // グループ未使用時 clusterByGroup は恒等なので、静止時の並びは既存と完全に一致する。
  // move のロジック（findContainer / onDragOver / onDragEnd）は laneItems / dragLanes を
  // 直接参照しており、この表示用クラスタリングには依存しない（＝ドラッグ挙動に影響しない）。
  const effectiveLanes = useMemo(() => {
    if (dragLanes) return dragLanes;
    const groupOf = (id: string) => noteById.get(id)?.groupId ?? null;
    return {
      KEEP: clusterByGroup(laneItems.KEEP, groupOf),
      PROBLEM: clusterByGroup(laneItems.PROBLEM, groupOf),
      TRY: clusterByGroup(laneItems.TRY, groupOf),
    } as Record<NoteKind, string[]>;
  }, [dragLanes, laneItems, noteById]);

  // 指定レーンの表示ノート列を、effectiveLanes の並び＋色の楽観上書きで組み立てる。
  // ドラッグ中に別レーンへ来たノートは kind をそのレーンに合わせる（data-lane と整合）。
  function laneNotes(kind: NoteKind): NoteDTO[] {
    const out: NoteDTO[] = [];
    for (const id of effectiveLanes[kind]) {
      const n = noteById.get(id);
      if (!n) continue;
      const color = id in colorOverrides ? colorOverrides[id] : n.color;
      const vote = id in voteOverrides ? voteOverrides[id] : null;
      out.push({
        ...n,
        kind,
        color,
        voteCount: vote ? vote.count : n.voteCount,
        hasVoted: vote ? vote.voted : n.hasVoted,
      });
    }
    return out;
  }

  // 現在の総投票数 = props(votesUsed) ＋ 楽観分の増減。
  // 各上書きにつき、base(hasVoted) からの差分を加算する。
  const votesUsedNow = useMemo(() => {
    let total = votesUsed;
    for (const id in voteOverrides) {
      const base = noteById.get(id);
      const was = base?.hasVoted ? 1 : 0;
      const now = voteOverrides[id].voted ? 1 : 0;
      total += now - was;
    }
    return total;
  }, [votesUsed, voteOverrides, noteById]);

  // 上限到達: これ以上、未投票の付箋へは投票できない（投票済みは取り消し可）。
  const atVoteLimit = votesUsedNow >= MAX_VOTES_PER_USER;

  // id（レーン id でもノート id でも）から所属レーンを、ライブ並びを優先して解決する。
  function findContainer(id: string): NoteKind | null {
    if (isKind(id)) return id;
    const src = dragLanes ?? laneItems;
    for (const k of KINDS) if (src[k].includes(id)) return k;
    return null;
  }

  const cloneLanes = (src: Record<NoteKind, string[]>): Record<NoteKind, string[]> => ({
    KEEP: [...src.KEEP],
    PROBLEM: [...src.PROBLEM],
    TRY: [...src.TRY],
  });

  const activeNote = activeId ? noteById.get(activeId) ?? null : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    // ライブ並びの起点を現在の確定並びから初期化する。
    setDragLanes(cloneLanes(laneItems));
  }

  // dnd-kit の multiple containers 例と同型。ドラッグ中に active を
  // ホバー中のレーンへライブ移動し、跨ぎでもドロップ前にプレビュー（隙間）を出す。
  // 同一レーン内の並べ替えは SortableContext のストラテジが視覚的に処理するため、
  // ここではレーン跨ぎ（コンテナ間移動）のみを扱う。
  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeIdStr = String(active.id);
    const overId = String(over.id);

    const activeContainer = findContainer(activeIdStr);
    const overContainer = findContainer(overId);
    if (!activeContainer || !overContainer) return;
    if (activeContainer === overContainer) return;

    setDragLanes((prev) => {
      const lanes = prev ? cloneLanes(prev) : cloneLanes(laneItems);
      const activeItems = lanes[activeContainer];
      const overItems = lanes[overContainer];
      const overIndex = overItems.indexOf(overId);

      let newIndex: number;
      if (isKind(overId)) {
        newIndex = overItems.length; // 空レーン/レーン枠 = 末尾
      } else {
        const translated = active.rect.current.translated;
        const isBelow =
          translated != null &&
          translated.top > over.rect.top + over.rect.height / 2;
        newIndex =
          overIndex >= 0 ? overIndex + (isBelow ? 1 : 0) : overItems.length;
      }

      return {
        ...lanes,
        [activeContainer]: activeItems.filter((id) => id !== activeIdStr),
        [overContainer]: [
          ...overItems.slice(0, newIndex),
          activeIdStr,
          ...overItems.slice(newIndex),
        ],
      };
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    const noteId = String(active.id);

    if (!over) {
      setDragLanes(null);
      return;
    }
    const overId = String(over.id);

    // レーン跨ぎは onDragOver で dragLanes に反映済み。ここでは最終並びを確定する。
    const lanes = dragLanes ?? laneItems;
    const toKind = findContainer(overId) ?? findContainer(noteId);
    if (!toKind) {
      setDragLanes(null);
      return;
    }

    let finalOrder = lanes[toKind];
    const activeIndex = finalOrder.indexOf(noteId);
    if (activeIndex === -1) {
      setDragLanes(null);
      return;
    }
    // 同一レーン内の最終位置は arrayMove で確定（上下方向は index 差で自然に決まる）。
    if (!isKind(overId)) {
      const overIndex = finalOrder.indexOf(overId);
      if (overIndex !== -1 && overIndex !== activeIndex) {
        finalOrder = arrayMove(finalOrder, activeIndex, overIndex);
      }
    }
    const toIndex = finalOrder.indexOf(noteId);

    // 元の確定並び(props 由来)と同じ位置なら永続化不要。
    const originalKind = KINDS.find((k) => laneItems[k].includes(noteId)) ?? null;
    const originalIndex = originalKind
      ? laneItems[originalKind].indexOf(noteId)
      : -1;
    if (originalKind === toKind && originalIndex === toIndex) {
      setDragLanes(null);
      return;
    }

    // 楽観更新をサーバ反映(revalidate)まで保持するため transition 内で await する。
    // await しないと transition が即完了し、旧位置へ戻る"スナップバック"が出る。
    // applyMove で optimisticNotes を更新するので、dragLanes を null に戻しても
    // effectiveLanes(=laneItems) が確定並びに一致し、ちらつかない。
    startTransition(async () => {
      applyMove({ noteId, toKind, toIndex });
      await moveNote(teamId, retroId, { noteId, toKind, toIndex });
    });
    setDragLanes(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        setDragLanes(null);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {COLUMNS.map((col) => (
          <Lane
            key={col.kind}
            teamId={teamId}
            retroId={retroId}
            column={col}
            itemIds={effectiveLanes[col.kind]}
            notes={laneNotes(col.kind)}
            groupById={groupById}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onCreateGroup={handleCreateGroup}
            onRenameGroup={handleRenameGroup}
            onUngroup={handleUngroup}
            onSetColor={handleSetColor}
            onToggleVote={handleToggleVote}
            atVoteLimit={atVoteLimit}
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
  groupById,
  selectedIds,
  onToggleSelect,
  onCreateGroup,
  onRenameGroup,
  onUngroup,
  onSetColor,
  onToggleVote,
  atVoteLimit,
}: {
  teamId: string;
  retroId: string;
  column: { kind: NoteKind; label: string; hint: string; color: string };
  itemIds: string[];
  notes: NoteDTO[];
  groupById: Map<string, GroupDTO>;
  selectedIds: Set<string>;
  onToggleSelect: (noteId: string) => void;
  onCreateGroup: (kind: NoteKind, noteIds: string[]) => void;
  onRenameGroup: (groupId: string, name: string) => void;
  onUngroup: (groupId: string) => void;
  onSetColor: (noteId: string, color: NoteColor | null) => void;
  onToggleVote: (noteId: string, current: VoteState) => void;
  atVoteLimit: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.kind });
  const add = addNote.bind(null, teamId, retroId, column.kind);

  // このレーン内で選択中の付箋（2件以上で「まとめる」を出す）。
  const selectedInLane = notes.filter((n) => selectedIds.has(n.id)).map((n) => n.id);

  // 表示ノートを groupId の連続ブロックに畳む。notes は effectiveLanes 由来で
  // 同 group が既に隣接済みなので、隣接連続だけ見ればブロックを復元できる。
  type Block =
    | { type: "note"; note: NoteDTO }
    | { type: "group"; groupId: string; notes: NoteDTO[] };
  const blocks: Block[] = [];
  for (let i = 0; i < notes.length; ) {
    const gid = notes[i].groupId;
    if (gid == null) {
      blocks.push({ type: "note", note: notes[i] });
      i++;
      continue;
    }
    const members: NoteDTO[] = [];
    while (i < notes.length && notes[i].groupId === gid) {
      members.push(notes[i]);
      i++;
    }
    blocks.push({ type: "group", groupId: gid, notes: members });
  }

  return (
    <section
      ref={setNodeRef}
      data-lane={column.kind}
      className={`card flex flex-col gap-3 p-3 ${
        isOver ? "border-line-strong" : ""
      }`}
    >
      <header className="flex items-baseline justify-between gap-2">
        <span className={`badge ${column.color}`}>{column.label}</span>
        {selectedInLane.length >= 2 ? (
          <button
            type="button"
            data-group-action="create"
            data-lane-group-kind={column.kind}
            aria-label="選択した付箋をまとめる"
            onClick={() => onCreateGroup(column.kind, selectedInLane)}
            className="btn btn-ghost btn-sm"
          >
            まとめる（{selectedInLane.length}）
          </button>
        ) : (
          <span className="text-xs text-muted">{column.hint}</span>
        )}
      </header>

      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col gap-2">
          {blocks.map((block) =>
            block.type === "note" ? (
              <SortableNote
                key={block.note.id}
                teamId={teamId}
                retroId={retroId}
                note={block.note}
                selected={selectedIds.has(block.note.id)}
                onToggleSelect={onToggleSelect}
                onSetColor={onSetColor}
                onToggleVote={onToggleVote}
                atVoteLimit={atVoteLimit}
              />
            ) : (
              <li key={block.groupId} className="list-none">
                <div
                  data-group-id={block.groupId}
                  className="flex flex-col gap-2 rounded-lg border border-line-strong border-l-4 bg-surface p-2"
                >
                  <GroupHeader
                    groupId={block.groupId}
                    name={groupById.get(block.groupId)?.name ?? null}
                    count={block.notes.length}
                    onRename={onRenameGroup}
                    onUngroup={onUngroup}
                  />
                  <ul className="flex flex-col gap-2">
                    {block.notes.map((note) => (
                      <SortableNote
                        key={note.id}
                        teamId={teamId}
                        retroId={retroId}
                        note={note}
                        selected={selectedIds.has(note.id)}
                        onToggleSelect={onToggleSelect}
                        onSetColor={onSetColor}
                        onToggleVote={onToggleVote}
                        atVoteLimit={atVoteLimit}
                      />
                    ))}
                  </ul>
                </div>
              </li>
            ),
          )}
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

// グループのヘッダ。グループ名のインライン編集（renameGroup）と解除（ungroup）。
function GroupHeader({
  groupId,
  name,
  count,
  onRename,
  onUngroup,
}: {
  groupId: string;
  name: string | null;
  count: number;
  onRename: (groupId: string, name: string) => void;
  onUngroup: (groupId: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem(
            "name",
          ) as HTMLInputElement | null;
          onRename(groupId, (input?.value ?? "").trim());
        }}
        className="flex min-w-0 flex-1 items-center gap-1"
      >
        {/* key に name を混ぜ、revalidate 後の新しい name を defaultValue に反映する */}
        <input
          key={name ?? ""}
          name="name"
          defaultValue={name ?? ""}
          placeholder="グループ名"
          aria-label="グループ名"
          data-group-name={groupId}
          className="field min-w-0 flex-1 py-1 text-xs font-medium"
        />
        <button
          type="submit"
          data-group-action="rename"
          className="btn btn-ghost btn-sm shrink-0"
        >
          保存
        </button>
      </form>
      <span className="shrink-0 text-xs text-muted">{count}枚</span>
      <button
        type="button"
        data-group-action="ungroup"
        aria-label="グループを解除"
        onClick={() => onUngroup(groupId)}
        className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted hover:text-problem"
      >
        解除
      </button>
    </div>
  );
}

function SortableNote({
  teamId,
  retroId,
  note,
  selected,
  onToggleSelect,
  onSetColor,
  onToggleVote,
  atVoteLimit,
}: {
  teamId: string;
  retroId: string;
  note: NoteDTO;
  selected: boolean;
  onToggleSelect: (noteId: string) => void;
  onSetColor: (noteId: string, color: NoteColor | null) => void;
  onToggleVote: (noteId: string, current: VoteState) => void;
  atVoteLimit: boolean;
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

  // 未投票 かつ 上限到達 のときだけ投票不可（投票済みは常に取り消せる）。
  const voteDisabled = atVoteLimit && !note.hasVoted;
  const voteHint = voteDisabled
    ? `投票上限（${MAX_VOTES_PER_USER}票）に達しています`
    : note.hasVoted
      ? "投票を取り消す"
      : "投票する";

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
      className={`rounded-lg border p-2.5 text-sm ${
        selected ? "border-line-strong ring-2 ring-line-strong" : "border-line"
      } ${colored ? "" : "bg-surface-2"}`}
    >
      <div className="flex items-start gap-2">
        {/* グループ化用の選択トグル。ドラッグとは独立（listeners は付けない）。 */}
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(note.id)}
          aria-label="この付箋を選択"
          data-select-note={note.id}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer"
        />
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
            <button
              type="button"
              onClick={() =>
                onToggleVote(note.id, {
                  voted: note.hasVoted,
                  count: note.voteCount,
                })
              }
              disabled={voteDisabled}
              aria-pressed={note.hasVoted}
              aria-label={voteHint}
              title={voteHint}
              data-vote-count={note.voteCount}
              data-voted={note.hasVoted ? "true" : "false"}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                note.hasVoted
                  ? "border-line-strong bg-surface-2 text-ink"
                  : "border-line text-muted hover:text-ink"
              }`}
            >
              <span aria-hidden>▲</span>
              {note.voteCount}
            </button>
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
            // 不透明な surface 背景＋薄いボーダー・角丸・小さな影で、
            // 着色済みカードの上でもスウォッチが常に surface 上に並ぶようにする。
            <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface p-2 shadow-sm">
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
