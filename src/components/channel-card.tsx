import Link from "next/link";
import { Play } from "lucide-react";
import { ChannelLogo } from "@/components/channel-logo";
import { FavoriteButton } from "@/components/favorite-button";
import { TimeText } from "@/components/time-text";
import type { ChannelListItem } from "@/lib/channels";
import type { Program } from "@/db/schema";
import { countryFlag, programProgress } from "@/lib/utils";

export function ChannelCard({
  channel,
  nowPlaying,
}: {
  channel: ChannelListItem;
  nowPlaying?: Program | null;
}) {
  const progress = nowPlaying ? programProgress(nowPlaying.startTime, nowPlaying.endTime) : 0;

  return (
    <article className="group animate-fade-in relative flex flex-col overflow-hidden rounded-2xl border border-white/5 bg-surface-2/80 transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-xl hover:shadow-brand/10">
      {/* Full-card link (kept outside of other interactive elements) */}
      <Link href={`/watch/${channel.id}`} className="absolute inset-0 z-10 rounded-2xl" aria-label={`Ver ${channel.name}`} />

      <div className="relative aspect-[16/10] w-full overflow-hidden bg-gradient-to-br from-surface-3 to-surface-2">
        <div className="absolute inset-0 grid place-items-center p-6">
          <ChannelLogo
            name={channel.name}
            logoUrl={channel.logoUrl}
            className="h-full w-full max-h-24 bg-transparent"
            textClassName="text-3xl"
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />
        <div className="absolute inset-0 grid place-items-center opacity-0 transition group-hover:opacity-100">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-white/90 text-surface shadow-lg">
            <Play className="ml-0.5 h-5 w-5 fill-current" />
          </span>
        </div>
        <div className="absolute top-2 left-2 flex items-center gap-1.5">
          {channel.channelNumber != null && (
            <span className="rounded-md bg-black/50 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white/80">
              {channel.channelNumber}
            </span>
          )}
          <span className="flex items-center gap-1 rounded-md bg-red-600/90 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-white uppercase">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            Live
          </span>
        </div>
        <FavoriteButton channelId={channel.id} initial={channel.isFavorite} className="absolute top-2 right-2 z-20" />
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-1 font-semibold text-white" title={channel.name}>
            {channel.name}
          </h3>
          {channel.country && (
            <span className="shrink-0 text-base leading-none" title={channel.country}>
              {countryFlag(channel.country)}
            </span>
          )}
        </div>
        <p className="line-clamp-1 text-xs text-slate-400">
          {channel.categoryName ?? channel.groupTitle ?? "Sin categoría"}
          {channel.language ? ` · ${channel.language.toUpperCase()}` : ""}
        </p>
        {nowPlaying ? (
          <div className="mt-auto pt-1">
            <p className="line-clamp-1 text-xs text-slate-300">
              <span className="text-brand-2">Ahora:</span> {nowPlaying.title}
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand to-brand-2"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-[10px] tabular-nums text-slate-500">
                <TimeText date={nowPlaying.startTime} />–<TimeText date={nowPlaying.endTime} />
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}
