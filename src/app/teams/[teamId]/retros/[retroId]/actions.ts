"use server";

import { revalidatePath } from "next/cache";
import { NoteKind, Prisma, ActionOutcome } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { reflect, llmModelLabel, type ReflectionInput } from "@/lib/llm/reflection";

// このふりかえりが、ログインユーザーが所属するチームのものか確認する
async function assertRetroAccess(teamId: string, retroId: string, userId: string) {
  const retro = await prisma.retrospective.findFirst({
    where: {
      id: retroId,
      teamId,
      team: { memberships: { some: { userId } } },
    },
    select: { id: true },
  });
  if (!retro) throw new Error("アクセス権がありません");
}

function revalidateRetro(teamId: string, retroId: string) {
  revalidatePath(`/teams/${teamId}/retros/${retroId}`);
}

// 付箋を追加
export async function addNote(
  teamId: string,
  retroId: string,
  kind: NoteKind,
  formData: FormData,
) {
  const user = await requireUser();
  await assertRetroAccess(teamId, retroId, user.id);

  const content = String(formData.get("content") ?? "").trim();
  if (!content) return;

  await prisma.note.create({
    data: { retrospectiveId: retroId, authorId: user.id, kind, content },
  });
  revalidateRetro(teamId, retroId);
}

// 付箋を編集（自チームのふりかえりの付箋のみ）
export async function updateNote(
  teamId: string,
  retroId: string,
  noteId: string,
  formData: FormData,
) {
  const user = await requireUser();
  const content = String(formData.get("content") ?? "").trim();
  if (!content) return;

  await prisma.note.updateMany({
    where: {
      id: noteId,
      retrospectiveId: retroId,
      retrospective: { teamId, team: { memberships: { some: { userId: user.id } } } },
    },
    data: { content },
  });
  revalidateRetro(teamId, retroId);
}

// 付箋を削除
export async function deleteNote(teamId: string, retroId: string, noteId: string) {
  const user = await requireUser();

  await prisma.note.deleteMany({
    where: {
      id: noteId,
      retrospectiveId: retroId,
      retrospective: { teamId, team: { memberships: { some: { userId: user.id } } } },
    },
  });
  revalidateRetro(teamId, retroId);
}

// AI案を採用してアクション化する（採用分が次回の判定対象＝ループを閉じる）
export async function adoptProposedAction(
  teamId: string,
  retroId: string,
  formData: FormData,
) {
  const user = await requireUser();
  await assertRetroAccess(teamId, retroId, user.id);

  const content = String(formData.get("content") ?? "").trim();
  const reflectionId = String(formData.get("reflectionId") ?? "").trim() || null;
  if (!content) return;

  await prisma.action.create({
    data: {
      teamId,
      createdInRetrospectiveId: retroId,
      sourceReflectionId: reflectionId,
      content,
    },
  });
  revalidateRetro(teamId, retroId);
}

// 効果判定を人間が確定・上書きする（AIの判定を人が承認/修正）
export async function setEvaluationOutcome(
  teamId: string,
  retroId: string,
  formData: FormData,
) {
  const user = await requireUser();

  const evaluationId = String(formData.get("evaluationId") ?? "").trim();
  const outcome = String(formData.get("outcome") ?? "").trim();
  if (
    outcome !== "WORKED" &&
    outcome !== "NOT_WORKED" &&
    outcome !== "NOT_DONE"
  ) {
    return;
  }
  if (!evaluationId) return;

  await prisma.actionEvaluation.updateMany({
    where: {
      id: evaluationId,
      evaluatedInRetrospectiveId: retroId,
      evaluatedIn: { teamId, team: { memberships: { some: { userId: user.id } } } },
    },
    data: {
      outcome: outcome as ActionOutcome,
      source: "HUMAN",
      question: null,
    },
  });

  // 対応するアクションの状態を同期（効いた→完了、それ以外→追跡中）
  await prisma.action.updateMany({
    where: {
      evaluations: { some: { id: evaluationId } },
      team: { memberships: { some: { userId: user.id } } },
    },
    data: { status: outcome === "WORKED" ? "DONE" : "OPEN" },
  });

  revalidateRetro(teamId, retroId);
}

// アクションを次回に持ち越す（OPENに戻す）
export async function carryOverAction(
  teamId: string,
  retroId: string,
  formData: FormData,
) {
  const user = await requireUser();

  const actionId = String(formData.get("actionId") ?? "").trim();
  if (!actionId) return;

  await prisma.action.updateMany({
    where: {
      id: actionId,
      teamId,
      team: { memberships: { some: { userId: user.id } } },
    },
    data: { status: "OPEN" },
  });
  revalidateRetro(teamId, retroId);
}

// アクションを打ち切る（DROPPED）
export async function dropAction(
  teamId: string,
  retroId: string,
  formData: FormData,
) {
  const user = await requireUser();

  const actionId = String(formData.get("actionId") ?? "").trim();
  if (!actionId) return;

  await prisma.action.updateMany({
    where: {
      id: actionId,
      teamId,
      team: { memberships: { some: { userId: user.id } } },
    },
    data: { status: "DROPPED" },
  });
  revalidateRetro(teamId, retroId);
}

export type RunReflectionState = { error: string | null };

// AI問い返しを実行する（差別化の核）
// 付箋＋前回OPENアクション＋ナレッジを渡し、判定・問い返し・新アクション案を得て保存する。
// useActionState 用のシグネチャ。AI失敗時は例外を投げず error を返して画面を保つ。
export async function runReflection(
  teamId: string,
  retroId: string,
  _prev: RunReflectionState,
  _formData: FormData,
): Promise<RunReflectionState> {
  const user = await requireUser();

  const retro = await prisma.retrospective.findFirst({
    where: {
      id: retroId,
      teamId,
      team: { memberships: { some: { userId: user.id } } },
    },
    include: { notes: true },
  });
  if (!retro) return { error: "アクセス権がありません。" };

  // 前回ふりかえりの OPEN アクション（判定対象）
  const previousActions = retro.previousRetrospectiveId
    ? await prisma.action.findMany({
        where: { createdInRetrospectiveId: retro.previousRetrospectiveId, status: "OPEN" },
        select: { id: true, content: true },
      })
    : [];

  // ナレッジ：チームの過去アクションと最新の判定
  const past = await prisma.action.findMany({
    where: { teamId },
    include: { evaluations: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const input: ReflectionInput = {
    notes: retro.notes.map((n) => ({ kind: n.kind, content: n.content })),
    previousActions,
    knowledge: past.map((a) => ({
      action: a.content,
      outcome: a.evaluations[0]?.outcome ?? null,
      reason: a.evaluations[0]?.reason ?? null,
    })),
  };

  let result;
  try {
    result = await reflect(input);
  } catch (e) {
    console.error("reflect() failed:", e);
    return {
      error: "AIの応答を取得できませんでした。少し待ってからもう一度お試しください。",
    };
  }

  // Reflection を保存
  await prisma.reflection.create({
    data: {
      retrospectiveId: retroId,
      model: llmModelLabel(),
      questions: result.probes as unknown as Prisma.InputJsonValue,
      rawOutput: result as unknown as Prisma.InputJsonValue,
    },
  });

  // 前回アクションの判定を保存（AIが実在する前回アクションを指したものだけ）
  const validIds = new Set(previousActions.map((a) => a.id));
  for (const ev of result.evaluations) {
    if (!validIds.has(ev.actionId)) continue;
    await prisma.actionEvaluation.upsert({
      where: {
        actionId_evaluatedInRetrospectiveId: {
          actionId: ev.actionId,
          evaluatedInRetrospectiveId: retroId,
        },
      },
      create: {
        actionId: ev.actionId,
        evaluatedInRetrospectiveId: retroId,
        outcome: ev.outcome,
        source: "AI",
        reason: ev.reason,
        question: ev.question,
      },
      update: {
        outcome: ev.outcome,
        source: "AI",
        reason: ev.reason,
        question: ev.question,
      },
    });
    // 効いた → アクション完了
    if (ev.outcome === "WORKED") {
      await prisma.action.update({ where: { id: ev.actionId }, data: { status: "DONE" } });
    }
  }

  revalidateRetro(teamId, retroId);
  return { error: null };
}
