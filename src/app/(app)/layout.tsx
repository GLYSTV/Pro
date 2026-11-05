import type { ReactNode } from "react";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { providers } from "@/db/schema";
import { Sidebar } from "@/components/sidebar";
import { logoutAction } from "@/app/(auth)/actions";
import { accountHost, requireProfile } from "@/lib/auth";
import { KIDS_CATEGORY_SLUG, listCategoriesWithCounts } from "@/lib/channels";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, profile } = await requireProfile();
  const [allCategories, [primary]] = await Promise.all([
    listCategoriesWithCounts(user.id),
    db
      .select({ expiresAt: providers.expiresAt })
      .from(providers)
      .where(and(eq(providers.userId, user.id), eq(providers.isPrimary, true)))
      .limit(1),
  ]);
  const categories = profile.isKids ? allCategories.filter((c) => c.slug === KIDS_CATEGORY_SLUG) : allCategories;
  const total = categories.reduce((sum, c) => sum + c.channelCount, 0);

  return (
    <>
      <Sidebar
        categories={categories}
        totalChannels={total}
        user={{
          name: user.name,
          username: user.username,
          host: accountHost(user),
          kind: user.kind,
          expiresAt: primary?.expiresAt ? primary.expiresAt.toISOString() : null,
        }}
        profile={{ id: profile.id, name: profile.name, avatar: profile.avatar, color: profile.color, isKids: profile.isKids }}
        logoutAction={logoutAction}
      />
      <div className="lg:pl-64">
        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </>
  );
}
