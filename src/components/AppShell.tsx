"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { NavigationProgress } from "@/components/NavigationProgress";
import { PermissionsProvider } from "@/components/PermissionsProvider";
import { ScrollToTopButton } from "@/components/ScrollToTopButton";
import { Sidebar } from "@/components/Sidebar";
import { UserSessionBar } from "@/components/UserSessionBar";
import {
  getProductForPath,
  isAppsLauncherPath,
} from "@/lib/products";
import type { SessionUser } from "@/lib/session";
import type { Role } from "@/lib/roles";

export function AppShell({
  children,
  user,
}: {
  children: React.ReactNode;
  user: SessionUser | null;
}) {
  const pathname = usePathname();
  const isLogin = pathname === "/login";
  const isPublicSign =
    pathname === "/sign" || pathname.startsWith("/sign/");
  const isLauncher = isAppsLauncherPath(pathname);
  const isProfil = pathname === "/profil" || pathname.startsWith("/profil/");
  const product = getProductForPath(pathname);

  if (isLogin || isPublicSign) {
    return (
      <div className="flex min-h-full w-full flex-1 flex-col">{children}</div>
    );
  }

  /** Écran Applications : plein écran, sans sidebar Finance */
  if (isLauncher) {
    return (
      <>
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        <PermissionsProvider user={user}>{children}</PermissionsProvider>
      </>
    );
  }

  /** Profil : barre légère sans menu produit */
  if (isProfil && !product) {
    return (
      <>
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        <Sidebar user={user} mode="profil" />
        <div className="flex min-w-0 flex-1 flex-col pt-14 lg:pt-0">
          {user && (
            <header className="sticky top-14 z-30 border-b border-[var(--border)] bg-[var(--card)]/95 px-4 py-3 backdrop-blur-md lg:top-0 lg:px-8">
              <UserSessionBar user={user} />
            </header>
          )}
          <main className="app-bg flex-1 overflow-auto">
            <PermissionsProvider user={user}>
              <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
                {children}
              </div>
            </PermissionsProvider>
          </main>
          <ScrollToTopButton />
        </div>
      </>
    );
  }

  return (
    <>
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      <Sidebar user={user} productId={product?.id ?? "finance"} />
      <div className="flex min-w-0 flex-1 flex-col pt-14 lg:pt-0">
        {user && (
          <header className="sticky top-14 z-30 border-b border-[var(--border)] bg-[var(--card)]/95 px-4 py-3 backdrop-blur-md lg:top-0 lg:px-8">
            <UserSessionBar user={user} />
          </header>
        )}
        <main className="app-bg flex-1 overflow-auto">
          <PermissionsProvider user={user}>
            <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
              {children}
            </div>
          </PermissionsProvider>
        </main>
        <ScrollToTopButton />
      </div>
    </>
  );
}

export type { SessionUser, Role };
