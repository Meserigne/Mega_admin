"use client";

import { ChevronUp } from "lucide-react";
import { useEffect, useState } from "react";

/** Bouton fixe pour remonter en haut du contenu scrollable. */
export function ScrollToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const main = document.querySelector("main.app-bg") as HTMLElement | null;
    const target: HTMLElement | Window = main ?? window;

    const getScrollTop = () =>
      main ? main.scrollTop : window.scrollY || document.documentElement.scrollTop;

    const onScroll = () => setVisible(getScrollTop() > 240);

    onScroll();
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => {
        const main = document.querySelector("main.app-bg") as HTMLElement | null;
        if (main) {
          main.scrollTo({ top: 0, behavior: "smooth" });
        } else {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      }}
      className="fixed bottom-6 left-6 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--card)] text-[var(--foreground)] shadow-[var(--shadow-md)] transition-all hover:scale-105 hover:border-[var(--c-blue-400)] hover:bg-[var(--c-blue-50)]"
      aria-label="Remonter en haut"
      title="Remonter en haut"
    >
      <ChevronUp className="h-5 w-5" />
    </button>
  );
}
