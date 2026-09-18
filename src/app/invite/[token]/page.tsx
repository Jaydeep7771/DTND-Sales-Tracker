import { getInvite } from "@/lib/actions";
import { isDemo } from "@/lib/data";
import AcceptInvite from "@/components/portal/AcceptInvite";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await getInvite(token);

  return (
    <div className="flex-1 flex items-center justify-center bg-sidebar p-6">
      <div className="bg-surface rounded-xl w-full max-w-[440px] p-7 flex flex-col gap-4 shadow-[0_24px_60px_rgba(15,27,43,.35)]">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-navy text-white flex items-center justify-center font-mono font-semibold">DT</div>
          <div className="leading-[1.15]">
            <div className="text-[15px] font-semibold">Dynamic Traders &amp; Distributors</div>
            <div className="text-[10.5px] tracking-[.09em] uppercase text-slate">Wholesale portal</div>
          </div>
        </div>

        {!invite ? (
          <>
            <div className="text-lg font-semibold">This invite link is no longer valid</div>
            <div className="text-[13px] text-slate">It may have been used already or regenerated. Ask Dynamic Traders for a new link, or <a href="/login">sign in</a> if you already set a password.</div>
          </>
        ) : (
          <AcceptInvite token={token} email={invite.email} company={invite.company_name ?? invite.email} demo={isDemo} />
        )}
      </div>
    </div>
  );
}
