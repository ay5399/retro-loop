"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";

// チームを作成し、作成者をメンバーとして紐付ける
export async function createTeam(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const team = await prisma.team.create({
    data: {
      name,
      memberships: {
        create: { userId: user.id },
      },
    },
  });

  revalidatePath("/teams");
  redirect(`/teams/${team.id}`);
}
