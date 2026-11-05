"use client";

import { Heart } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";

export function FavoriteButton({
  channelId,
  initial,
  size = "sm",
  className,
  showLabel = false,
}: {
  channelId: number;
  initial: boolean;
  size?: "sm" | "md";
  className?: string;
  showLabel?: boolean;
}) {
  const [isFavorite, setIsFavorite] = useState(initial);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = !isFavorite;
    setIsFavorite(next);
    try {
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId }),
      });
      if (!res.ok) throw new Error("fallo");
      const data = (await res.json()) as { isFavorite: boolean };
      setIsFavorite(data.isFavorite);
      startTransition(() => router.refresh());
    } catch {
      setIsFavorite(!next);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={isFavorite}
      aria-label={isFavorite ? "Quitar de favoritos" : "Añadir a favoritos"}
      title={isFavorite ? "Quitar de favoritos" : "Añadir a favoritos"}
      className={cn(
        "inline-flex items-center gap-2 rounded-full transition",
        size === "sm" ? "p-2" : "px-4 py-2 text-sm font-medium",
        isFavorite
          ? "bg-rose-500/20 text-rose-300 hover:bg-rose-500/30"
          : "bg-black/40 text-slate-200 hover:bg-black/60 hover:text-white",
        className,
      )}
    >
      <Heart className={cn(size === "sm" ? "h-4 w-4" : "h-4.5 w-4.5", isFavorite && "fill-current")} />
      {showLabel && (isFavorite ? "En favoritos" : "Añadir a favoritos")}
    </button>
  );
}
