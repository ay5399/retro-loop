// AIチャットのツール（読み取り専用・盤面非破壊）が使うデータ取得ロジック。
// LLM 依存(ai/zod)をここに持ち込まないことで、E2Eから純粋関数として検証できる。
// ツール定義(tool())側はこの結果を LLM に渡すだけの薄いラッパにする。
import { prisma } from "../prisma";

type NoteLite = { kind: string; content: string };

type ChatToolNote = { kind: string; content: string; votes: number; author: string };
function chatToolNote(note: NoteLite & { authorId: string; votes: unknown[] }, userId: string): ChatToolNote {
  return { kind: note.kind, content: note.content, votes: note.votes.length,
    author: note.authorId === userId ? "ログイン本人" : "他メンバー" };
}

// TRY / PROBLEM を content 配列に分解する
function splitTryProblem(notes: NoteLite[]): {
  tries: string[];
  problems: string[];
} {
  return {
    tries: notes.filter((n) => n.kind === "TRY").map((n) => n.content),
    problems: notes.filter((n) => n.kind === "PROBLEM").map((n) => n.content),
  };
}

export type RetroSummary = {
  retroName: string;
  counts: { keep: number; problem: number; try: number };
  // 各レーンを投票数の多い順に（総括で重要な付箋を上に）
  keep: { content: string; votes: number }[];
  problem: { content: string; votes: number }[];
  try: { content: string; votes: number }[];
  groups: { kind: string; name: string | null }[];
};

type ChatRetroSummary = Omit<RetroSummary, "keep" | "problem" | "try"> & {
  keep: ChatToolNote[]; problem: ChatToolNote[]; try: ChatToolNote[];
};

export function buildRetroSummary(retroId: string): Promise<RetroSummary | null>;
export function buildRetroSummary(retroId: string, currentUserId: string): Promise<ChatRetroSummary | null>;

// E: 今回のふりかえりの総括材料（付箋を投票数つき・グループつきで構造化）。
export async function buildRetroSummary(
  retroId: string,
  currentUserId?: string,
): Promise<RetroSummary | null> {
  const retro = await prisma.retrospective.findUnique({
    where: { id: retroId },
    include: {
      notes: { include: { votes: true } },
      noteGroups: true,
    },
  });
  if (!retro) return null;

  const byKind = (kind: string) =>
    retro.notes
      .filter((n) => n.kind === kind)
      .map((n) => currentUserId === undefined
        ? { content: n.content, votes: n.votes.length }
        : chatToolNote(n, currentUserId))
      .sort((a, b) => b.votes - a.votes);

  const keep = byKind("KEEP");
  const problem = byKind("PROBLEM");
  const tryList = byKind("TRY");

  return {
    retroName: retro.name,
    counts: { keep: keep.length, problem: problem.length, try: tryList.length },
    keep,
    problem,
    try: tryList,
    groups: retro.noteGroups.map((g) => ({ kind: g.kind, name: g.name })),
  };
}

export type RecurringIssues = {
  hasHistory: boolean;
  // 直近から遡った過去ふりかえりの Try / Problem（未定着・再発の検知材料）
  previous: { retroName: string; tries: string[]; problems: string[] }[];
  current: { tries: string[]; problems: string[] };
};

type ChatRecurringIssues = {
  hasHistory: boolean;
  previous: { retroName: string; tries: ChatToolNote[]; problems: ChatToolNote[] }[];
  current: { tries: ChatToolNote[]; problems: ChatToolNote[] };
};

export function buildRecurringIssues(retroId: string, depth?: number): Promise<RecurringIssues>;
export function buildRecurringIssues(retroId: string, depth: number, currentUserId: string): Promise<ChatRecurringIssues>;

// F: 直近スプリント横断の指摘材料。previousRetrospectiveId チェーンを depth 件遡り、
// 過去の Try / Problem を集めて「未定着の Try」「再発している Problem」を LLM に判断させる。
export async function buildRecurringIssues(
  retroId: string,
  depth = 3,
  currentUserId?: string,
): Promise<{
  hasHistory: boolean;
  previous: { retroName: string; tries: (string | ChatToolNote)[]; problems: (string | ChatToolNote)[] }[];
  current: { tries: (string | ChatToolNote)[]; problems: (string | ChatToolNote)[] };
}> {
  // Only the authenticated Route supplies this ID; note text cannot set authorship.
  const split = (notes: (NoteLite & { authorId: string; votes: unknown[] })[]) => {
    if (currentUserId === undefined) return splitTryProblem(notes);
    return {
      tries: notes.filter((n) => n.kind === "TRY").map((n) => chatToolNote(n, currentUserId)),
      problems: notes.filter((n) => n.kind === "PROBLEM").map((n) => chatToolNote(n, currentUserId)),
    };
  };
  const current = await prisma.retrospective.findUnique({
    where: { id: retroId },
    include: { notes: { include: { votes: true } } },
  });
  if (!current) {
    return { hasHistory: false, previous: [], current: { tries: [], problems: [] } };
  }

  const previous: { retroName: string; tries: (string | ChatToolNote)[]; problems: (string | ChatToolNote)[] }[] = [];
  let prevId = current.previousRetrospectiveId;
  let guard = 0;
  while (prevId && guard < depth) {
    const r = await prisma.retrospective.findUnique({
      where: { id: prevId },
      include: { notes: { include: { votes: true } } },
    });
    if (!r) break;
    const tp = split(r.notes);
    previous.push({ retroName: r.name, tries: tp.tries, problems: tp.problems });
    prevId = r.previousRetrospectiveId;
    guard++;
  }

  return {
    hasHistory: previous.length > 0,
    previous,
    current: split(current.notes),
  };
}
