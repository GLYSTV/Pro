"use client";

import { useState } from "react";
import { cn, initials } from "@/lib/utils";

const PALETTE = [
  "from-violet-500/40 to-fuchsia-500/30",
  "from-sky-500/40 to-indigo-500/30",
  "from-emerald-500/40 to-teal-500/30",
  "from-amber-500/40 to-orange-500/30",
  "from-rose-500/40 to-pink-500/30",
  "from-cyan-500/40 to-blue-500/30",
];

export function ChannelLogo({
  name,
  logoUrl,
  className,
  textClassName,
}: {
  name: string;
  logoUrl: string | null | undefined;
  className?: string;
  textClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  const hue = name.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % PALETTE.length;

  if (!logoUrl || failed) {
    return (
      <div
        className={cn(
          "grid place-items-center rounded-xl bg-gradient-to-br font-bold tracking-wide text-white/90",
          PALETTE[hue],
          className,
        )}
        aria-label={name}
      >
        <span className={cn("select-none", textClassName)}>{initials(name)}</span>
      </div>
    );
  }

  return (
    <div className={cn("grid place-items-center overflow-hidden rounded-xl bg-white/[0.06] p-2", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoUrl}
        alt={name}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-full w-full object-contain drop-shadow"
      />
    </div>
  );
}
