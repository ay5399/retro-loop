"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";

// 指定チームのメンバーであることを確認する（違えば /teams へ戻す）
async function requireMembership(teamId: string, userId: string) {
  const membership = await prisma.membership.findUnique({
    where: { userId_teamId: { userId, teamId } },
  });
  if (!membership) redirect("/teams");
}

// ふりかえりを作成する。前回ふりかえり（同チームの直近）を自動でリンクする。
export async function createRetrospective(teamId: string, formData: FormData) {
  const user = await requireUser();
  await requireMembership(teamId, user.id);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  // 直近のふりかえり＝新規作成分の「前回」
  const previous = await prisma.retrospective.findFirst({
    where: { teamId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  const retro = await prisma.retrospective.create({
    data: {
      teamId,
      name,
      previousRetrospectiveId: previous?.id ?? null,
    },
  });

  revalidatePath(`/teams/${teamId}`);
  redirect(`/teams/${teamId}/retros/${retro.id}`);
}
