"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/*
 * The site's motion, in one place (fun.tsx has the markup it moves):
 *   doodles (.mk-doodle) draw themselves once they're on screen (data-seen);
 *   floating pieces ([data-float]) drift against the scroll, by their depth;
 *   cards marked data-tilt lean towards the pointer.
 * With reduced motion none of it runs: doodles are simply drawn and nothing moves. Until this runs (or
 * without script) everything shows as drawn: the root only gets .mk-motion here.
 */
export function MarketingMotion() {
  const pathname = usePathname();
  useEffect(() => {
    const root = document.querySelector(".mk-root");
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      root.classList.remove("mk-motion");
      return;
    }
    root.classList.add("mk-motion");

    // Doodles: drawn once seen.
    const seen = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.setAttribute("data-seen", "");
          seen.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    const watchDoodles = () => root.querySelectorAll(".mk-doodle:not([data-seen])").forEach((el) => seen.observe(el));
    watchDoodles();

    // Floating pieces: offset by how far their centre is from the middle of the screen.
    let floats = Array.from(root.querySelectorAll<HTMLElement>("[data-float]"));
    let frame = 0;
    const place = () => {
      frame = 0;
      const mid = window.innerHeight / 2;
      for (const el of floats) {
        const r = el.getBoundingClientRect();
        if (r.bottom < -200 || r.top > window.innerHeight + 200) continue;
        const depth = Number(el.dataset.float) || 0.1;
        const off = (r.top + r.height / 2 - mid) * depth;
        el.style.translate = `0 ${Math.round(-off)}px`;
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    // Parts rendered later (lazy sections, client-side content) get the same treatment.
    let pending = 0;
    const added = new MutationObserver(() => {
      if (pending) return;
      pending = window.setTimeout(() => {
        pending = 0;
        watchDoodles();
        floats = Array.from(root.querySelectorAll<HTMLElement>("[data-float]"));
        onScroll();
      }, 100);
    });
    added.observe(root, { childList: true, subtree: true });

    // Tilt: a few degrees towards the pointer, back when it leaves.
    const fine = window.matchMedia("(pointer: fine)").matches;
    const onMove = (e: PointerEvent) => {
      const card = (e.target as Element | null)?.closest<HTMLElement>("[data-tilt]");
      if (!card) return;
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      const max = Number(card.dataset.tilt) || 3;
      card.style.transform = `perspective(900px) rotateX(${(-y * max).toFixed(2)}deg) rotateY(${(x * max).toFixed(2)}deg) translateY(-2px)`;
    };
    const onLeave = (e: PointerEvent) => {
      const card = (e.target as Element | null)?.closest<HTMLElement>("[data-tilt]");
      if (card && !card.contains(e.relatedTarget as Node | null)) card.style.transform = "";
    };
    if (fine) {
      root.addEventListener("pointermove", onMove as EventListener, { passive: true });
      root.addEventListener("pointerout", onLeave as EventListener, { passive: true });
    }

    return () => {
      seen.disconnect();
      added.disconnect();
      if (pending) clearTimeout(pending);
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
      root.removeEventListener("pointermove", onMove as EventListener);
      root.removeEventListener("pointerout", onLeave as EventListener);
    };
  }, [pathname]);
  return null;
}
