import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { WatchView } from "@/components/watch-view";
import { getAuth, requireProfile } from "@/lib/auth";
import { getChannel, getZapList, KIDS_CATEGORY_SLUG } from "@/lib/channels";
import { ensureEpg, getUpcoming } from "@/lib/epg";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return { title: "Canal" };
  try {
    const auth = await getAuth();
    if (!auth.user || !auth.profile) return { title: "Canal" };
    const channel = await getChannel(id, auth.user.id, auth.profile.id);
    return { title: channel ? channel.name : "Canal" };
  } catch {
    return { title: "Canal" };
  }
}

export default async function WatchPage({ params }: { params: Params }) {
  const { user, profile } = await requireProfile();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const channel = await getChannel(id, user.id, profile.id);
  if (!channel || !channel.isActive) notFound();
  if (profile.isKids && channel.categorySlug !== KIDS_CATEGORY_SLUG) redirect("/");

  const now = new Date();
  const [zapList] = await Promise.all([
    getZapList(user.id, channel.categoryId, profile.id, profile.isKids),
    ensureEpg([{ id: channel.id, categorySlug: channel.categorySlug }], now, new Date(now.getTime() + 12 * 3600 * 1000)),
  ]);
  const schedule = await getUpcoming(channel.id, now, 8);
  const nowPlaying = schedule.find((p) => p.startTime.getTime() <= now.getTime()) ?? null;
  const upcoming = schedule.filter((p) => p.startTime.getTime() > now.getTime());

  return (
    <div className="space-y-4" data-tv-zap>
      <Link
        href={channel.categorySlug ? `/?category=${channel.categorySlug}` : "/"}
        className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" /> Volver al catálogo
      </Link>
      <WatchView
        channel={channel}
        zapList={zapList}
        nowPlaying={nowPlaying}
        upcoming={upcoming}
        canRecord={!profile.isKids}
      />
    </div>
  );
}
