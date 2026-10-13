/**
 * Moteur d'animation commun à toutes les pages.
 * GSAP + ScrollTrigger + Lenis, mêmes recettes que les sites Cas'Design et
 * Manoztralia : split maison, reveals par attribut, marquees réactifs au
 * scroll, habillage fixe, rideau de changement de page.
 *
 * Règle de performance : rien de ce qui est sous la ligne de flottaison n'est
 * préparé au chargement. Les reveals passent par un IntersectionObserver et
 * les scènes lourdes s'initialisent à l'approche (voir whenNear).
 */
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger);
ScrollTrigger.config({ ignoreMobileResize: true });

export { gsap, ScrollTrigger };

export const root = document.documentElement;
export const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
export const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;

export const $ = <T extends Element = HTMLElement>(s: string, c: ParentNode = document) =>
  c.querySelector<T>(s);
export const $$ = <T extends Element = HTMLElement>(s: string, c: ParentNode = document) =>
  Array.from(c.querySelectorAll<T>(s));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (lo: number, hi: number, v: number) => Math.min(hi, Math.max(lo, v));
export const norm = (v: number, a: number, b: number) => clamp(0, 1, (v - a) / (b - a));
export const smooth = (t: number) => t * t * (3 - 2 * t);

const CLEAR = "transform,opacity";

/** Appelle `fn` une seule fois, quand `el` approche de l'écran. */
export function whenNear(el: Element, fn: () => void, margin = "150% 0px") {
  const io = new IntersectionObserver((es) => {
    if (es.some((e) => e.isIntersecting)) { io.disconnect(); fn(); }
  }, { rootMargin: margin });
  io.observe(el);
}

/** Recalcule les positions des ScrollTriggers après la création tardive d'une scène. */
let refreshQueued = false;
export function queueRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    ScrollTrigger.sort();
    ScrollTrigger.refresh();
  });
}

/* ------------------------------------------------------------------ Lenis */
export let lenis: Lenis | null = null;

function setupLenis() {
  if (reduce) return;
  lenis = new Lenis({ lerp: 0.1 });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis!.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);

  // ancres internes
  document.addEventListener("click", (e) => {
    const a = (e.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute("href")!;
    if (id.length < 2) return;
    const target = document.querySelector<HTMLElement>(id);
    if (!target) return;
    e.preventDefault();
    lenis!.scrollTo(target, { duration: 1.4, offset: -80 });
  });
}

/* ------------------------------------------------------------- Split maison */
/**
 * Découpe le texte d'un élément en mots (et lettres si `chars`), chaque mot
 * dans un masque d'overflow. Les dégradés de texte sont reportés sur chaque
 * mot : un parent en background-clip:text ne peint pas ses enfants transformés.
 */
export function split(el: HTMLElement, chars = false): HTMLElement[] {
  if (el.dataset.split) return $$(chars ? ".c" : ".wi", el);
  el.dataset.split = "1";
  // aria-label n'est permis que sur les titres : ailleurs les mots restent lus tels quels
  const heading = /^H[1-6]$/.test(el.tagName);
  if (heading && !el.hasAttribute("aria-label")) {
    el.setAttribute("aria-label", (el.textContent || "").replace(/\s+/g, " ").trim());
  }
  const out: HTMLElement[] = [];

  const walk = (node: Node, inherit: string[]) => {
    Array.from(node.childNodes).forEach((n) => {
      if (n.nodeType === 3) {
        const text = n.textContent || "";
        if (!text.trim()) return;
        const frag = document.createDocumentFragment();
        text.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(" ")); return; }
          const w = document.createElement("span");
          w.className = "w";
          if (heading) w.setAttribute("aria-hidden", "true");
          const wi = document.createElement("span");
          wi.className = ["wi", ...inherit].join(" ");
          if (chars) {
            Array.from(part).forEach((ch) => {
              const c = document.createElement("span");
              c.className = "c";
              c.style.display = "inline-block";
              c.textContent = ch;
              wi.appendChild(c);
              out.push(c);
            });
          } else {
            wi.textContent = part;
            out.push(wi);
          }
          w.appendChild(wi);
          frag.appendChild(w);
        });
        n.parentNode!.replaceChild(frag, n);
      } else if (n.nodeType === 1) {
        const e = n as HTMLElement;
        if (e.matches("svg, img, br, .nosplit")) {
          if (e.matches(".nosplit")) out.push(e);
          return;
        }
        const next = [...inherit];
        if (e.classList.contains("text-gradient")) {
          e.classList.remove("text-gradient");
          next.push("text-gradient");
        }
        walk(e, next);
      }
    });
  };
  walk(el, el.classList.contains("text-gradient") ? ["text-gradient"] : []);
  if (el.classList.contains("text-gradient")) el.classList.remove("text-gradient");
  return out;
}

/* ------------------------------------------------------- Reveals déclaratifs */
const REVEAL_SEL = "[data-reveal], main h2:not([data-noreveal]), [data-count], [data-line], .foot-word";

function kindOf(el: HTMLElement) {
  return el.dataset.reveal || (el.tagName === "H2" ? "words" : "");
}

/** Joue l'entrée d'un lot d'éléments arrivés ensemble à l'écran. */
function play(batch: HTMLElement[]) {
  const group: Record<string, HTMLElement[]> = {};
  batch.forEach((el) => {
    if (el.dataset.count) count(el);
    if (el.hasAttribute("data-line")) gsap.fromTo(el, { scaleX: 0 }, { scaleX: 1, transformOrigin: "0 50%", duration: 1.4, ease: "expo.out" });
    const k = kindOf(el);
    if (k) (group[k] ??= []).push(el);
  });

  group.words?.forEach((el) => {
    const words = split(el);
    gsap.set(el, { visibility: "visible" });
    gsap.from(words, { yPercent: 150, rotate: 3, duration: 1.15, ease: "expo.out", stagger: 0.05 });
  });
  group.chars?.forEach((el) => {
    const chars = split(el, true);
    gsap.set(el, { visibility: "visible" });
    gsap.from(chars, { yPercent: 165, duration: 1.1, ease: "expo.out", stagger: 0.022 });
  });
  if (group.fade) {
    gsap.fromTo(group.fade, { y: 40, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 1.1, ease: "power3.out", stagger: 0.09, clearProps: CLEAR });
  }
  if (group.tilt) {
    gsap.fromTo(group.tilt, { y: 90, rotation: 4, autoAlpha: 0 }, { y: 0, rotation: 0, autoAlpha: 1, duration: 1.3, ease: "expo.out", stagger: 0.1, clearProps: CLEAR });
  }
  group.img?.forEach((el) => {
    gsap.set(el, { visibility: "visible" });
    gsap.fromTo(el, { clipPath: "inset(100% 0% 0% 0% round 24px)" }, { clipPath: "inset(0% 0% 0% 0% round 24px)", duration: 1.5, ease: "expo.out", clearProps: "clipPath" });
    const img = el.matches("img") ? null : $("img", el);
    if (img) gsap.from(img, { scale: 1.35, duration: 1.9, ease: "expo.out" });
  });
  group.pop?.forEach((el) => {
    gsap.set(el, { visibility: "visible" });
    gsap.from(el, { scale: 0, rotate: Number(el.dataset.popRotate ?? -14), duration: 0.9, ease: "back.out(1.8)", delay: Number(el.dataset.delay ?? 0) });
  });
  group.rise?.forEach((el) => {
    fitWord(el);
    gsap.set(el, { visibility: "visible" });
    gsap.from(el, { yPercent: 105, duration: 1.5, ease: "expo.out" });
  });
}

function count(el: HTMLElement) {
  const to = parseFloat(el.dataset.count || "0");
  const dec = parseInt(el.dataset.dec || "0", 10);
  const fmt = (v: number) => v.toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  if (reduce) { el.textContent = fmt(to); return; }
  const o = { v: 0 };
  gsap.to(o, { v: to, duration: 2.2, ease: "power3.out", onUpdate: () => (el.textContent = fmt(o.v)) });
}

function initReveals() {
  const els = $$(REVEAL_SEL);
  const armed = new Set<HTMLElement>();

  // 1. Armement : l'élément est masqué quand il arrive juste sous l'écran.
  //    Tant qu'on ne s'en approche pas, il reste visible dans la page (robots
  //    d'indexation, lecteurs d'écran) : rien n'est caché « au cas où ».
  const arm = new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      arm.unobserve(e.target);
      const el = e.target as HTMLElement;
      const vh = e.rootBounds?.height ?? innerHeight;
      if (e.boundingClientRect.top < vh * 0.98 || !kindOf(el)) return; // déjà à l'écran : pas de clignotement
      armed.add(el);
      el.style.visibility = "hidden";
    }),
    { rootMargin: "0px 0px 70% 0px" },
  );

  // 2. Entrée : l'animation se joue quand l'élément entre vraiment à l'écran.
  const io = new IntersectionObserver(
    (entries) => {
      const enter: HTMLElement[] = [];
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target as HTMLElement;
        io.unobserve(el);
        arm.unobserve(el);
        if (armed.delete(el) || el.dataset.count || el.hasAttribute("data-line")) enter.push(el);
        else if (el.classList.contains("foot-word")) fitWord(el);
      });
      if (enter.length) play(enter);
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  els.forEach((el) => { arm.observe(el); io.observe(el); });

  // Filet : en bas de page, ce qui reste armé dans la dernière bande de l'écran est joué.
  addEventListener("scroll", () => {
    if (!armed.size || innerHeight + scrollY < document.documentElement.scrollHeight - 4) return;
    const rest = [...armed].filter((el) => el.getBoundingClientRect().top < innerHeight);
    rest.forEach((el) => { armed.delete(el); io.unobserve(el); });
    if (rest.length) play(rest);
  }, { passive: true });

  // Dérive en parallaxe pendant la traversée de la section.
  if (!reduce) {
    $$("[data-float]").forEach((el) => {
      const host = el.closest("section") || el;
      whenNear(host, () => {
        const amt = Number(el.dataset.float) || 60;
        gsap.fromTo(el, { y: amt }, { y: -amt, ease: "none", scrollTrigger: { trigger: host, start: "top bottom", end: "bottom top", scrub: true } });
      }, "100% 0px");
    });
  }
}

/* ---------------------------------------------------------------- Marquees */
type Mq = { el: HTMLElement; track: HTMLElement; half: number; x: number; speed: number; dir: number; visible: boolean; hover: number; hoverTo: number };
const marquees: Mq[] = [];
let mqTicking = false;

function buildMarquee(m: Mq) {
  const first = $(".mq__group", m.track)!;
  $$(".mq__group", m.track).slice(1).forEach((g) => g.remove());
  m.half = first.getBoundingClientRect().width;
  if (!m.half) return;
  const n = Math.ceil((innerWidth * 1.3) / m.half) + 1;
  for (let i = 0; i < n; i++) {
    const c = first.cloneNode(true) as HTMLElement;
    c.setAttribute("aria-hidden", "true");
    m.track.appendChild(c);
  }
}

function tickMarquees() {
  if (mqTicking || reduce) return;
  mqTicking = true;
  let boost = 1, way = 1;
  gsap.ticker.add((_t, dt) => {
    const v = lenis ? lenis.velocity : 0;
    if (Math.abs(v) > 0.6) way = v < 0 ? -1 : 1;
    boost = lerp(boost, way * (1 + Math.min(Math.abs(v) * 0.11, 6)), 0.08);
    const step = Math.min(dt, 60) / 1000;
    marquees.forEach((m) => {
      if (!m.visible || !m.half) return;
      m.hover = lerp(m.hover, m.hoverTo, 0.08);
      m.x -= m.speed * m.dir * boost * m.hover * step;
      if (m.x <= -m.half) m.x += m.half;
      else if (m.x > 0) m.x -= m.half;
      m.track.style.transform = `translate3d(${m.x}px,0,0)`;
    });
  });
}

function initMarquees() {
  $$(".mq").forEach((el) => {
    const track = $(".mq__track", el);
    if (!track) return;
    // construit (clones compris) seulement à l'approche
    whenNear(el, () => {
      const m: Mq = {
        el, track, half: 0, x: 0,
        speed: Number(el.dataset.speed) || 70,
        dir: Number(el.dataset.dir) || 1,
        visible: false, hover: 1, hoverTo: 1,
      };
      buildMarquee(m);
      marquees.push(m);
      new IntersectionObserver(([e]) => (m.visible = e.isIntersecting), { rootMargin: "120px" }).observe(el);
      if (fine && el.hasAttribute("data-pause")) {
        el.addEventListener("pointerenter", () => (m.hoverTo = 0.15));
        el.addEventListener("pointerleave", () => (m.hoverTo = 1));
      }
      tickMarquees();
    }, "100% 0px");
  });
}

/* ---------------------------------------------------------------- Habillage */
function initChrome() {
  const bar = $(".pg-bar");
  const hud = $(".hud");
  const hudFill = $(".hud__fill");
  const hudNum = $(".hud__num");
  const hudName = $(".hud__name");
  const header = $("#site-header");

  // progression, en-tête qui se range en descente, HUD
  ScrollTrigger.create({
    start: 0,
    end: "max",
    onUpdate: (s) => {
      if (bar) bar.style.transform = `scaleX(${s.progress})`;
      if (hudFill) hudFill.style.transform = `scaleX(${s.progress})`;
      if (hudNum) hudNum.textContent = String(Math.round(s.progress * 100)).padStart(2, "0") + " %";
      const y = s.scroll();
      header?.classList.toggle("is-hidden", s.direction === 1 && y > innerHeight * 0.5);
      hud?.classList.toggle("is-on", y > innerHeight * 0.6);
    },
  });

  // HUD : nom de la section qui traverse le milieu de l'écran
  const sections = $$("[data-section]");
  if (hudName && sections.length) {
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => {
        if (!e.isIntersecting) return;
        const sec = e.target as HTMLElement;
        hudName.textContent = `${String(sections.indexOf(sec) + 1).padStart(2, "0")} — ${sec.dataset.section}`;
      }),
      { rootMargin: "-48% 0px -48% 0px" },
    );
    sections.forEach((s) => io.observe(s));
  }

  if (!fine || reduce) return;

  // curseur
  const cur = $(".cur");
  if (cur) {
    root.classList.add("has-cursor");
    const label = $(".cur__label", cur)!;
    const x = gsap.quickTo(cur, "x", { duration: 0.3, ease: "power3" });
    const y = gsap.quickTo(cur, "y", { duration: 0.3, ease: "power3" });
    addEventListener("pointermove", (e) => { x(e.clientX); y(e.clientY); }, { passive: true });
    document.addEventListener("pointerover", (e) => {
      const t = e.target as Element;
      const lab = t.closest<HTMLElement>("[data-cursor]");
      cur.classList.toggle("is-label", !!lab);
      if (lab) label.textContent = lab.dataset.cursor || "";
      cur.classList.toggle("is-link", !lab && !!t.closest("a, button, summary, [role='button']"));
    });
  }

  // boutons magnétiques, tilt 3D, cartes à remplissage : par délégation, sans rien mesurer au chargement
  document.addEventListener("pointerover", (e) => {
    const t = e.target as Element;
    const mag = t.closest<HTMLElement>("[data-magnet]:not([data-armed])");
    if (mag) {
      mag.dataset.armed = "1";
      const mx = gsap.quickTo(mag, "x", { duration: 0.9, ease: "elastic.out(1, 0.45)" });
      const my = gsap.quickTo(mag, "y", { duration: 0.9, ease: "elastic.out(1, 0.45)" });
      mag.addEventListener("pointermove", (ev) => {
        const r = mag.getBoundingClientRect();
        mx((ev.clientX - (r.left + r.width / 2)) * 0.32);
        my((ev.clientY - (r.top + r.height / 2)) * 0.32);
      });
      mag.addEventListener("pointerleave", () => { mx(0); my(0); });
    }
    const tilt = t.closest<HTMLElement>("[data-tilt]:not([data-armed])");
    if (tilt) {
      tilt.dataset.armed = "1";
      gsap.set(tilt, { transformPerspective: 1300 });
      const rx = gsap.quickTo(tilt, "rotationX", { duration: 0.6, ease: "power3" });
      const ry = gsap.quickTo(tilt, "rotationY", { duration: 0.6, ease: "power3" });
      tilt.addEventListener("pointermove", (ev) => {
        const r = tilt.getBoundingClientRect();
        ry(((ev.clientX - r.left) / r.width - 0.5) * 12);
        rx(-((ev.clientY - r.top) / r.height - 0.5) * 12);
      });
      tilt.addEventListener("pointerleave", () => { rx(0); ry(0); });
    }
    const fill = t.closest<HTMLElement>(".fillcard");
    if (fill && !fill.contains(e.relatedTarget as Node)) {
      const r = fill.getBoundingClientRect();
      fill.style.setProperty("--mx", e.clientX - r.left + "px");
      fill.style.setProperty("--my", e.clientY - r.top + "px");
    }
  });
  document.addEventListener("pointerout", (e) => {
    const fill = (e.target as Element).closest<HTMLElement>(".fillcard");
    if (fill && !fill.contains(e.relatedTarget as Node)) {
      const r = fill.getBoundingClientRect();
      fill.style.setProperty("--mx", e.clientX - r.left + "px");
      fill.style.setProperty("--my", e.clientY - r.top + "px");
    }
  });
}

/* --------------------------------------------- Rideau de changement de page */
function initPageWipe() {
  const wipe = $(".wipe");
  if (!wipe || reduce) return;
  let leaving = false;
  wipe.addEventListener("animationend", () => root.classList.remove("is-arriving"));

  // l'image du kart n'est chargée qu'au premier geste du visiteur
  const kart = $<HTMLImageElement>(".wipe__kart", wipe);
  const arm = () => {
    if (kart && kart.dataset.src) { kart.src = kart.dataset.src; delete kart.dataset.src; }
  };
  addEventListener("pointerdown", arm, { once: true, passive: true });
  addEventListener("pointermove", arm, { once: true, passive: true });
  addEventListener("keydown", arm, { once: true });

  document.addEventListener("click", (e) => {
    if (leaving || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest<HTMLAnchorElement>("a[href]");
    if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search) return; // simple ancre
    e.preventDefault();
    leaving = true;
    arm();
    try { sessionStorage.setItem("lq-wipe", "1"); } catch {}
    lenis?.stop();
    root.classList.remove("is-arriving");
    root.classList.add("is-leaving");
    gsap.fromTo(wipe, { xPercent: 104, x: 0 }, {
      xPercent: 0,
      duration: 0.7,
      ease: "power3.inOut",
      onComplete: () => { location.href = url.href; },
    });
  });

  // retour arrière servi depuis le cache du navigateur : on range le rideau
  addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    leaving = false;
    root.classList.remove("is-leaving");
    gsap.set(wipe, { xPercent: 104 });
    lenis?.start();
  });
}

/* ------------------------------------------------------------ FAQ <details> */
function initDetails() {
  document.addEventListener("toggle", (e) => {
    const d = e.target as HTMLDetailsElement;
    if (d.tagName !== "DETAILS") return;
    const p = $(":scope > :not(summary)", d);
    if (d.open && p && !reduce) gsap.from(p, { height: 0, autoAlpha: 0, duration: 0.6, ease: "power3.out", clearProps: "height,opacity,visibility" });
    queueRefresh();
  }, true);
}

/* ------------------------------------------------------- Mot géant du footer */
function fitWord(el: HTMLElement) {
  el.style.fontSize = "";
  const w = el.scrollWidth;
  const avail = el.parentElement!.clientWidth;
  if (!w) return;
  el.style.fontSize = ((parseFloat(getComputedStyle(el).fontSize) * avail) / w) * 0.985 + "px";
}

/* -------------------------------------------------------------------- Boot */
/** Rend la main au navigateur entre deux étapes : aucune tâche longue au démarrage. */
const breathe = () => new Promise<void>((r) => setTimeout(r, 0));

async function main() {
  setupLenis();

  if (document.body.dataset.page === "home") {
    const home = await import("./home");
    await breathe();
    home.initHome();
  }
  await breathe();
  initReveals();
  await breathe();
  initMarquees();
  initChrome();
  await breathe();
  initPageWipe();
  initDetails();
  root.classList.add("motion-ready");

  let t = 0;
  addEventListener("resize", () => {
    clearTimeout(t);
    t = window.setTimeout(() => { marquees.forEach(buildMarquee); $$(".foot-word").forEach(fitWord); }, 200);
  });
}

main().catch((err) => {
  // Le site doit rester lisible quoi qu'il arrive.
  console.error(err);
  root.classList.add("motion-failed");
});
