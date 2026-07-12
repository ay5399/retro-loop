import {
  approveJoinRequest,
  rejectJoinRequest,
  regenerateJoinToken,
  setJoinApproval,
} from "./actions";
import { CopyLinkButton } from "./copy-link-button";

type Member = { id: string; email: string | null; name: string | null };
type PendingRequest = { id: string; name: string | null; email: string | null };
type Props = {
  teamId: string;
  members: Member[];
  pendingRequests: PendingRequest[];
  joinToken: string;
  joinApproval: boolean;
  baseUrl: string;
};

export function MembersSection({
  teamId,
  members,
  pendingRequests,
  joinToken,
  joinApproval,
  baseUrl,
}: Props) {
  const approveForTeam = approveJoinRequest.bind(null, teamId);
  const rejectForTeam = rejectJoinRequest.bind(null, teamId);
  const regenerateForTeam = regenerateJoinToken.bind(null, teamId);
  const setApprovalForTeam = setJoinApproval.bind(null, teamId);

  const joinLink = `${baseUrl}/join/${joinToken}`;

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold">メンバー</h2>
        <span className="eyebrow">Members &amp; access</span>
      </div>

      {/* メンバー一覧 */}
      <div className="card space-y-3 p-5">
        <p className="eyebrow">Members</p>
        <ul className="divide-y divide-line">
          {members.length === 0 ? (
            <li className="py-2 text-sm text-muted">メンバーがいません。</li>
          ) : null}
          {members.map((member) => (
            <li
              key={member.id}
              data-member-row
              data-member-id={member.id}
              className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0"
            >
              <span className="font-display font-medium">
                {member.name ?? member.email ?? "（名前未設定）"}
              </span>
              {member.name && member.email ? (
                <span className="text-sm text-muted">{member.email}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      {/* 参加リンク（固定URL） */}
      <div className="card space-y-3 p-5" data-join-link-card>
        <p className="eyebrow">Join link</p>
        <p className="text-sm text-muted">
          このリンクを共有すると、開いた人が参加を申請できます。
        </p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-xs text-muted">
            {joinLink}
          </code>
          <CopyLinkButton link={joinLink} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          {/* 承認要否トグル */}
          <form action={setApprovalForTeam} className="flex items-center gap-2">
            <input type="hidden" name="approval" value={joinApproval ? "false" : "true"} />
            <span className="text-sm">
              参加の承認：
              <span className="font-medium">{joinApproval ? "必要" : "不要（即参加）"}</span>
            </span>
            <button type="submit" className="btn btn-ghost btn-sm" data-toggle-approval>
              {joinApproval ? "承認なしにする" : "承認制にする"}
            </button>
          </form>

          {/* リンク再生成 */}
          <form action={regenerateForTeam}>
            <button type="submit" className="btn btn-ghost btn-sm" data-regenerate-link>
              リンクを再生成
            </button>
          </form>
        </div>
        {!joinApproval ? (
          <p className="text-xs text-warn">
            承認不要のため、リンクを知っている人は誰でも即メンバーになります。
          </p>
        ) : null}
      </div>

      {/* 参加申請（承認待ち） */}
      {pendingRequests.length > 0 ? (
        <div className="card space-y-3 p-5" data-pending-requests>
          <p className="eyebrow">Join requests</p>
          <ul className="divide-y divide-line">
            {pendingRequests.map((req) => (
              <li
                key={req.id}
                data-request-id={req.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <span className="min-w-0 truncate font-medium">
                  {req.name ?? req.email ?? "（名前未設定）"}
                  {req.name && req.email ? (
                    <span className="ml-2 text-sm text-muted">{req.email}</span>
                  ) : null}
                </span>
                <div className="flex shrink-0 gap-2">
                  <form action={approveForTeam}>
                    <input type="hidden" name="requestId" value={req.id} />
                    <button type="submit" className="btn btn-primary btn-sm" data-approve>
                      承認
                    </button>
                  </form>
                  <form action={rejectForTeam}>
                    <input type="hidden" name="requestId" value={req.id} />
                    <button type="submit" className="btn btn-ghost btn-sm" data-reject>
                      却下
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
