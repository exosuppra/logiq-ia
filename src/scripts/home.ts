/**
 * Scènes de l'accueil. Chargé à la demande par motion.ts.
 * Même principe partout : un proxy { p } scrubbé + une fonction de rendu qui
 * calcule tout depuis les mesures du DOM.
 *
 * Seul le hero est préparé au chargement. Chaque autre scène n'est créée qu'à
 * l'approche de l'écran, pour ne rien faire payer au premier affichage.
 */
import { gsap, ScrollTrigger, lenis, reduce, fine, $, $$, lerp, clamp, norm, split, whenNear, queueRefresh } from "./motion";

const LEAN = 0.16; // inclinaison des rideaux obliques
const breathe = () => new Promise<void>((r) => setTimeout(r, 0));

/* La 3D (three.js + modèles) n'est chargée qu'à l'approche d'une scène qui en a besoin. */
type K3 = typeof import("./kart3d");
let k3: Promise<K3> | null = null;
const loadK3 = () => (k3 ??= import("./kart3d"));
const canWebGL = (() => {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
})();

/** Crée une scène quand son bloc approche, puis recale les ScrollTriggers. */
function scene(sel: string, init: (el: HTMLElement) => void, margin = "120% 0px") {
  const el = $(sel);
  if (!el) return;
  whenNear(el, () => { init(el); queueRefresh(); }, margin);
}

/* ============================================================ 1. Hero-fenêtre */
async function initHero() {
  const sec = $(".hero");
  const pin = $(".hero__pin");
  const slot = $(".hero__slot");
  const mover = $(".hero__mover");
  if (!sec || !pin || !slot || !mover) return;

  const hero = { p: 0 };
  const geo = { t: 0, r: 0, b: 0, l: 0, rad: 0, dx: 0, dy: 0, zoom: 0.62 };
  const badge = $(".hero__badge");
  const frames = [$(".hero__stage", pin)!, $(".hero__ring", pin)!];

  const measure = () => {
    const pr = pin.getBoundingClientRect();
    const sr = slot.getBoundingClientRect();
    geo.t = sr.top - pr.top;
    geo.l = sr.left - pr.left;
    geo.r = pr.right - sr.right;
    geo.b = pr.bottom - sr.bottom;
    geo.rad = Math.min(sr.width, sr.height) * 0.09;
    geo.dx = sr.left + sr.width / 2 - (pr.left + pr.width / 2);
    geo.dy = sr.top + sr.height / 2 - (pr.top + pr.height / 2);
    geo.zoom = clamp(0.5, 0.8, (sr.width / pr.width) * 1.7);
    if (badge) {
      badge.style.left = geo.l - badge.offsetWidth * 0.42 + "px";
      badge.style.top = pr.height - geo.b - badge.offsetHeight * 0.62 + "px";
    }
  };

  const render = () => {
    const q = 1 - hero.p;
    frames.forEach(({ style: s }) => {
      s.setProperty("--t", geo.t * q + "px");
      s.setProperty("--r", geo.r * q + "px");
      s.setProperty("--b", geo.b * q + "px");
      s.setProperty("--l", geo.l * q + "px");
      s.setProperty("--rad", geo.rad * q + "px");
      s.setProperty("--q", String(q));
    });
    mover.style.transform = `translate3d(${geo.dx * q}px,${geo.dy * q}px,0) scale(${1 - (1 - geo.zoom) * q})`;
  };

  // Préparation en étapes courtes, la main rendue au navigateur entre chacune.
  measure();
  render();
  await breathe();
  // les vignettes de la mosaïque n'entrent en jeu qu'ici : elles ne pèsent pas sur le premier affichage
  $$<HTMLImageElement>("img[data-src]", mover).forEach((img) => { img.src = img.dataset.src!; });
  sec.classList.add("is-ready");
  await breathe();

  const bWords = split($(".hero__b-title")!);

  const tl = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: {
      // la fenêtre est épinglée en CSS (position: sticky) : rien à calculer ici
      trigger: sec,
      start: "top top",
      end: "bottom bottom",
      scrub: reduce ? true : 0.7,
      invalidateOnRefresh: true,
      onRefresh: () => { measure(); render(); },
    },
  });
  tl.to(hero, { p: 1, duration: 0.72, ease: "power2.inOut", onUpdate: render }, 0)
    .to(".hero__a", { yPercent: -8, autoAlpha: 0, duration: 0.3, ease: "power1.in" }, 0.03)
    .to(".neural-bg", { autoAlpha: 0, duration: 0.3 }, 0.1)
    .fromTo([".hero__badge", ".hero__scroll"], { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.12, immediateRender: false }, 0)
    .fromTo(".hero__ring", { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.2, immediateRender: false }, 0.5)
    .to(".hero__veil", { opacity: 1, duration: 0.3 }, 0.42)
    // second écran : masqué en CSS au départ, états de départ explicites (rien ne transparaît avant l'heure)
    .fromTo(".hero__b", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.04 }, 0.55)
    .fromTo(".hero__b-kicker", { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.12 }, 0.58)
    .fromTo(bWords, { yPercent: 165 }, { yPercent: 0, duration: 0.2, stagger: 0.035, ease: "power3.out" }, 0.6)
    .fromTo(".hero__chips li", { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.12, stagger: 0.022, ease: "power2.out" }, 0.76)
    .to({}, { duration: 0.06 });

  await breathe();
  // la mosaïque s'anime au premier geste du visiteur (au chargement, l'image reste stable)
  const live = () => sec.classList.add("is-live");
  (["scroll", "pointermove", "touchstart", "keydown"] as const).forEach((ev) => addEventListener(ev, live, { once: true, passive: true }));
  // … et seulement lorsqu'elle est à l'écran
  new IntersectionObserver(([e]) => sec.classList.toggle("is-away", !e.isIntersecting)).observe(sec);

  // parallaxe souris sur la mosaïque
  if (fine && !reduce) {
    const dx = gsap.quickTo(".hero__drift", "x", { duration: 1.2, ease: "power3" });
    const dy = gsap.quickTo(".hero__drift", "y", { duration: 1.2, ease: "power3" });
    pin.addEventListener("pointermove", (e) => {
      dx((e.clientX / innerWidth - 0.5) * -34);
      dy((e.clientY / innerHeight - 0.5) * -24);
    });
  }

  // Entrée : le titre et le texte sont affichés dès le premier rendu (rien ne
  // retarde l'affichage) ; seuls le store de la fenêtre et le badge s'animent.
  gsap.timeline({ defaults: { ease: "expo.out" } })
    .to(".hero__shade", { yPercent: -101, duration: 0.9, ease: "expo.inOut" }, 0)
    .fromTo(".hero__badge", { scale: 0, rotate: -140 }, { scale: 1, rotate: 0, duration: 0.9, ease: "back.out(1.5)" }, 0.45)
    .fromTo(".hero__scroll", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6 }, 0.7);
}

/* ================================================================ 2. Manifeste */
function initManifesto(sec: HTMLElement) {
  const el = $("[data-manifesto]", sec);
  if (!el) return;
  const items = split(el);
  const tl = gsap.timeline({ scrollTrigger: { trigger: el, start: "top 80%", end: "bottom 55%", scrub: 0.6 } });
  items.forEach((it, i) => {
    if (it.classList.contains("pill-img")) {
      tl.fromTo(it, { scale: 0, rotate: -14 }, { scale: 1, rotate: 0, duration: 4, ease: "back.out(2.2)" }, i);
    } else {
      tl.fromTo(it, { opacity: 0.13 }, { opacity: 1, duration: 2.4, ease: "none" }, i);
    }
  });
}

/* ============================================ 3. Couture : un kart tire la suite */
function initSeam(seam: HTMLElement) {
  const to = $(".kseam__to", seam)!;
  const flag = $(".kseam__flag", seam)!;
  const kart = $(".kseam__kart", seam)!;
  const canvas = $<HTMLCanvasElement>("canvas[data-gl]", seam);
  const st = { p: 0 };
  let w = 0, h = 0, kw = 0, kh = 0;
  let gl: import("./kart3d").Crossing | null = null;
  const measure = () => {
    w = seam.clientWidth; h = seam.clientHeight;
    kw = kart.offsetWidth; kh = kart.offsetHeight;
    gl?.resize();
  };
  const draw = () => {
    // le kart roule de droite à gauche ; derrière lui, la section suivante
    const X = lerp(1.18, -0.34, st.p) * w;
    const top = X + (LEAN * h) / 2, bot = X - (LEAN * h) / 2;
    to.style.clipPath = `polygon(${top}px 0, 100% 0, 100% 100%, ${bot}px 100%)`;
    flag.style.opacity = "1";
    flag.style.transform = `translate3d(${X}px,0,0) rotate(${Math.atan(LEAN)}rad)`;
    if (gl) {
      gl.place(0, X + w * 0.06, st.p);
      gl.render();
    } else {
      const bob = Math.sin(st.p * 46) * 3;
      kart.style.opacity = "1";
      kart.style.transform = `translate3d(${X - kw * 0.36}px,${h * 0.66 - kh * 0.8 + bob}px,0) rotate(${Math.sin(st.p * 23) * 1.4}deg)`;
    }
  };
  measure();
  draw();
  gsap.to(st, {
    p: 1,
    ease: "none",
    onUpdate: draw,
    scrollTrigger: {
      trigger: seam,
      start: "top 92%",
      end: "bottom 18%",
      scrub: reduce ? true : 0.5,
      invalidateOnRefresh: true,
      onRefresh: () => { measure(); draw(); },
    },
  });

  if (canvas && canWebGL) {
    loadK3().then((m) => {
      const c = m.createCrossing(canvas, ["boulon"], { frac: () => (innerWidth < 900 ? 0.4 : 0.23), ground: 0.6, lanes: [0] });
      c.ready.then(() => { gl = c; seam.classList.add("is-3d"); measure(); draw(); });
    }).catch(() => {});
  }
}

/* ============================================================ 4. Journal agents */
function initTerminal(sec: HTMLElement) {
  const lines = $$(".term__line", sec);
  if (!lines.length) return;
  ScrollTrigger.create({
    trigger: sec,
    start: "top 55%",
    end: "bottom 75%",
    scrub: true,
    onUpdate: (s) => {
      const n = Math.ceil(s.progress * (lines.length + 0.5));
      lines.forEach((l, i) => l.classList.toggle("is-on", i < n));
    },
  });
}

/* ================================================================== 5. Manga AI */
function initManga(sec: HTMLElement) {
  const stage = $("[data-book]", sec);
  if (!stage) return;
  const book = $(".book", stage)!;
  const coverImg = $<HTMLImageElement>(".book__cover-img", stage)!;
  const buttons = $$<HTMLButtonElement>(".shelf button", sec);

  // le livre pivote puis s'ouvre sur deux vraies planches à mesure qu'on descend
  const o = { v: 0 };
  gsap.to(o, {
    v: 1,
    ease: "power1.inOut",
    onUpdate: () => book.style.setProperty("--open", o.v.toFixed(4)),
    scrollTrigger: { trigger: stage, start: "top 62%", end: "top 12%", scrub: reduce ? true : 0.8 },
  });
  gsap.timeline({ scrollTrigger: { trigger: stage, start: "top 30%", once: true } })
    .from(".manga__stamp", { scale: 3.4, rotation: 40, autoAlpha: 0, duration: 0.42, ease: "power4.in" })
    .to(".manga__stamp", { scale: 1.08, duration: 0.09, yoyo: true, repeat: 1, ease: "power1.out" })
    .to(stage, { y: 6, duration: 0.07, yoyo: true, repeat: 1 }, "<");

  // changer de manga : la jaquette se referme le temps d'un rebond, avec la nouvelle couverture
  buttons.forEach((b) =>
    b.addEventListener("click", () => {
      if (b.getAttribute("aria-pressed") === "true") return;
      buttons.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      const src = `/show/mg-cover-${b.dataset.cover}.webp`;
      const pre = new Image();
      pre.onload = () => {
        if (reduce) { coverImg.src = src; return; }
        gsap.timeline()
          .to(stage, { scaleX: 0, duration: 0.3, ease: "power2.in" })
          .add(() => { coverImg.src = src; })
          .to(stage, { scaleX: 1, duration: 0.8, ease: "elastic.out(1, 0.6)" });
      };
      pre.src = src;
    }),
  );

  // comparateur crayonné / couleur
  $$("[data-cmp]", sec).forEach((fig) => {
    const box = $(".cmp__box", fig)!;
    const set = (x: number) => {
      const v = clamp(4, 96, x);
      box.style.setProperty("--x", v + "%");
      box.setAttribute("aria-valuenow", String(Math.round(v)));
    };
    const fromEvent = (e: PointerEvent) => {
      const r = box.getBoundingClientRect();
      set(((e.clientX - r.left) / r.width) * 100);
    };
    let drag = false;
    box.addEventListener("pointerdown", (e) => { drag = true; box.setPointerCapture(e.pointerId); fromEvent(e); });
    box.addEventListener("pointermove", (e) => { if (drag) fromEvent(e); });
    box.addEventListener("pointerup", () => (drag = false));
    box.addEventListener("pointercancel", () => (drag = false));
    box.addEventListener("keydown", (e) => {
      const cur = parseFloat(box.style.getPropertyValue("--x")) || 50;
      if (e.key === "ArrowLeft") set(cur - 5);
      if (e.key === "ArrowRight") set(cur + 5);
    });
    if (!reduce) {
      const stt = { x: 96 };
      gsap.timeline({ scrollTrigger: { trigger: box, start: "top 70%", once: true } })
        .fromTo(stt, { x: 96 }, { x: 22, duration: 1.5, ease: "expo.inOut", onUpdate: () => set(stt.x) })
        .to(stt, { x: 50, duration: 1.1, ease: "expo.out", onUpdate: () => set(stt.x) });
    }
  });
}

/* ============================================ 6. Sites : défilement horizontal */
function initSites(sec: HTMLElement) {
  const track = $(".sites__track", sec);
  const idx = $(".sites__idx", sec);
  if (!track) return;
  const plates = $$(".plate", track);
  const pad = (n: number) => String(n).padStart(2, "0");

  gsap.from(plates, {
    y: 120, autoAlpha: 0, rotation: 6, duration: 1.4, ease: "expo.out", stagger: 0.09,
    scrollTrigger: { trigger: sec, start: "top 60%", once: true },
  });

  const mm = gsap.matchMedia();
  mm.add("(min-width: 901px)", () => {
    sec.classList.remove("is-native");
    const dist = () => Math.max(0, track.scrollWidth - innerWidth);
    const tw = gsap.to(track, {
      x: () => -dist(),
      ease: "none",
      scrollTrigger: {
        trigger: sec, start: "top top", end: () => "+=" + dist(),
        pin: ".sites__pin", scrub: reduce ? true : 0.6, anticipatePin: 1, invalidateOnRefresh: true, refreshPriority: 3,
      },
    });
    plates.forEach((p, i) => {
      ScrollTrigger.create({
        trigger: p, containerAnimation: tw, start: "left 55%", end: "right 55%",
        onToggle: (s) => { if (s.isActive && idx) idx.textContent = pad(i + 1); },
      });
      const img = $(".plate__shot img", p);
      if (img && !reduce) {
        gsap.fromTo(img, { xPercent: -5 }, { xPercent: 5, ease: "none", scrollTrigger: { trigger: p, containerAnimation: tw, start: "left right", end: "right left", scrub: true } });
      }
    });
  });
  mm.add("(max-width: 900px)", () => {
    // sur mobile : défilement natif aimanté, pas d'épinglage
    sec.classList.add("is-native");
    const vp = $(".sites__viewport", sec)!;
    const onScroll = () => {
      const c = vp.scrollLeft + vp.clientWidth / 2;
      let best = 0, bd = Infinity;
      plates.forEach((p, i) => {
        const d = Math.abs(p.offsetLeft + p.offsetWidth / 2 - c);
        if (d < bd) { bd = d; best = i; }
      });
      if (idx) idx.textContent = pad(best + 1);
    };
    vp.addEventListener("scroll", onScroll, { passive: true });
    return () => vp.removeEventListener("scroll", onScroll);
  });
}

/* ======================================= 7. La course : les karts tirent le rideau */
function initRace(sec: HTMLElement) {
  const pin = $(".race__pin", sec);
  if (!pin) return;
  const b = $(".race__b", pin)!;
  const flag = $(".race__flag", pin)!;
  const dust = $(".race__dust", pin)!;
  const karts = $$(".race__kart", pin);
  const canvas = $<HTMLCanvasElement>("canvas[data-gl]", pin);
  // peloton : retard de chaque kart derrière le rideau (en largeurs d'écran) et hauteur (repli 2D)
  const pack = [
    { dx: 0.02, y: 0.7 },
    { dx: 0.3, y: 0.56 },
    { dx: 0.56, y: 0.42 },
  ];
  const st = { p: 0 };
  let w = 0, h = 0;
  let gl: import("./kart3d").Crossing | null = null;
  const sizes: { kw: number; kh: number }[] = [];
  const measure = () => {
    w = pin.clientWidth; h = pin.clientHeight;
    karts.forEach((k, i) => (sizes[i] = { kw: k.offsetWidth, kh: k.offsetHeight }));
    gl?.resize();
  };

  const aWords = split($(".race__a .race__big", pin)!);
  const bWords = split($(".race__b .race__big", pin)!);

  const draw = () => {
    const X = lerp(1.14, -1.2, st.p) * w;
    const top = X + (LEAN * h) / 2, bot = X - (LEAN * h) / 2;
    b.style.clipPath = `polygon(${top}px 0, 100% 0, 100% 100%, ${bot}px 100%)`;
    flag.style.opacity = "1";
    flag.style.transform = `translate3d(${X}px,0,0) rotate(${Math.atan(LEAN)}rad)`;
    dust.style.opacity = String(norm(st.p, 0.05, 0.3) * (1 - norm(st.p, 0.75, 1)));
    pack.forEach((pk, i) => {
      // chacun a sa cadence : ils se doublent pendant la traversée
      const sway = Math.sin(st.p * 9 + i * 1.7) * 0.07 * w;
      const x = X + pk.dx * w + sway;
      if (gl) {
        gl.place(i, x + w * 0.08, st.p * 1.6);
      } else if (karts[i]) {
        const s = sizes[i];
        const k = karts[i];
        k.style.opacity = "1";
        k.style.transform = `translate3d(${x - s.kw * 0.3}px,${pk.y * h - s.kh * 0.5 + Math.sin(st.p * 40 + i * 2) * 4}px,0) rotate(${Math.sin(st.p * 20 + i) * 2}deg) scale(${0.7 + pk.y * 0.5})`;
        k.style.zIndex = String(4 + Math.round(pk.y * 10));
      }
    });
    gl?.render();
  };

  measure();
  draw();

  const tl = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: {
      trigger: sec, start: "top top", end: () => "+=" + innerHeight * (innerWidth < 900 ? 1.5 : 2),
      pin, scrub: reduce ? true : 0.7, anticipatePin: 1, invalidateOnRefresh: true, refreshPriority: 2,
      onRefresh: () => { measure(); draw(); },
    },
  });
  tl.to(st, { p: 1, duration: 1, onUpdate: draw }, 0)
    .from(aWords, { yPercent: 150, duration: 0.1, stagger: 0.02, ease: "power3.out" }, 0)
    .from(".race__logo", { scale: 0, rotate: -24, duration: 0.16, ease: "back.out(2)" }, 0.5)
    .from(bWords, { yPercent: 160, duration: 0.14, stagger: 0.025, ease: "power3.out" }, 0.58)
    .to({}, { duration: 0.08 });

  if (canvas && canWebGL) {
    loadK3().then((m) => {
      const c = m.createCrossing(canvas, ["picante", "boulon", "marina"], {
        frac: () => (innerWidth < 900 ? 0.46 : 0.28), ground: 0.6, lanes: [1.6, -1.6, -4.8],
      });
      c.ready.then(() => { gl = c; pin.classList.add("is-3d"); measure(); draw(); });
    }).catch(() => {});
  }
}

/* ============================================================== 8. Jeux vidéo */
function initGames(sec: HTMLElement) {
  // Kartoche : présentoir 3D
  const stage = $("[data-kshow]", sec);
  const canvas = stage && $<HTMLCanvasElement>("canvas", stage);
  const picks = $$<HTMLButtonElement>(".pilots button", sec);
  if (stage && canvas && canWebGL) {
    loadK3().then((m) => {
      const v = m.createViewer(canvas, ["boulon", "picante", "marina"], reduce);
      v.ready.then(() => {
        stage.classList.add("is-3d");
        new IntersectionObserver(([e]) => v.setActive(e.isIntersecting), { threshold: 0.05 }).observe(stage);
        new ResizeObserver(() => v.resize()).observe(stage);
        picks.forEach((b, i) =>
          b.addEventListener("click", () => {
            picks.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
            v.show(i);
          }),
        );
      });
    }).catch(() => {});
  }

  // cartes de jeu : les captures s'enchaînent par un volet oblique
  $$("[data-shots]", sec).forEach((card, ci) => {
    const imgs = $$<HTMLImageElement>(".game__shots .game__img", card);
    const dots = $$(".game__dots i", card);
    if (imgs.length < 2) return;
    let cur = 0, busy = false, timer = 0;
    const go = () => {
      if (busy) return;
      const next = (cur + 1) % imgs.length;
      const img = imgs[next];
      const run = () => {
        busy = true;
        img.classList.add("is-in");
        const o = { v: 0 };
        gsap.to(o, {
          v: 1,
          duration: reduce ? 0.01 : 1,
          ease: "expo.inOut",
          onUpdate: () => {
            const a = lerp(-25, 125, o.v), b = lerp(-50, 100, o.v);
            img.style.clipPath = `polygon(0 0, ${a}% 0, ${b}% 100%, 0 100%)`;
          },
          onComplete: () => {
            imgs[cur].classList.remove("is-on");
            img.classList.remove("is-in");
            img.classList.add("is-on");
            img.style.clipPath = "";
            dots.forEach((d, i) => d.classList.toggle("is-on", i === next));
            cur = next;
            busy = false;
          },
        });
      };
      if (img.complete && img.naturalWidth) run();
      else { img.loading = "eager"; img.addEventListener("load", run, { once: true }); }
    };
    new IntersectionObserver(([e]) => {
      clearInterval(timer);
      if (e.isIntersecting && !reduce) timer = window.setInterval(go, 3600 + ci * 450);
    }, { threshold: 0.35 }).observe(card);
    if (fine) card.addEventListener("pointerenter", go);
  });

  if (!fine) return;
  $$(".game--torch", sec).forEach((el) => {
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", e.clientX - r.left + "px");
      el.style.setProperty("--my", e.clientY - r.top + "px");
    });
  });
}

/* ================================== 9. Méthode : le robot trace la route */
function initRoute(map: HTMLElement) {
  const svg = $<SVGSVGElement>(".route__svg", map)!;
  const ghost = $<SVGPathElement>(".route__ghost", map)!;
  const path = $<SVGPathElement>(".route__path", map)!;
  const bot = $(".route__bot", map)!;
  const steps = $$(".rstep", map);
  const dots = steps.map((s) => $(".rstep__dot", s)!);
  const st = { p: 0 };
  let len = 0;
  let marks: number[] = [];

  const build = () => {
    const mr = map.getBoundingClientRect();
    svg.setAttribute("viewBox", `0 0 ${mr.width} ${mr.height}`);
    const pts = dots.map((d) => {
      const r = d.getBoundingClientRect();
      return { x: r.left - mr.left + r.width / 2, y: r.top - mr.top + r.height / 2 };
    });
    if (pts.length < 2) return;
    const sway = Math.min(mr.width * 0.16, 190);
    let d = `M ${pts[0].x} ${pts[0].y - 46} L ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dir = i % 2 ? 1 : -1;
      const my = (b.y - a.y) / 2;
      d += ` C ${a.x + sway * dir} ${a.y + my * 0.55}, ${b.x + sway * dir} ${b.y - my * 0.55}, ${b.x} ${b.y}`;
    }
    const last = pts[pts.length - 1];
    d += ` L ${last.x} ${last.y + 46}`;
    ghost.setAttribute("d", d);
    path.setAttribute("d", d);
    len = path.getTotalLength();
    path.style.strokeDasharray = String(len);
    // longueur d'arc de chaque étape, trouvée par dichotomie sur la hauteur
    marks = pts.map((p) => {
      let lo = 0, hi = len;
      for (let i = 0; i < 22; i++) {
        const m = (lo + hi) / 2;
        if (path.getPointAtLength(m).y < p.y) lo = m; else hi = m;
      }
      return (lo + hi) / 2;
    });
  };

  const draw = () => {
    if (!len) return;
    const l = len * st.p;
    const a = path.getPointAtLength(Math.max(0, l - 2));
    const b = path.getPointAtLength(Math.min(len, l + 2));
    path.style.strokeDashoffset = String(len - l);
    const ang = clamp(-24, 24, (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI - 90);
    bot.style.opacity = String(Math.min(1, st.p * 30, (1 - st.p) * 30));
    bot.style.transform = `translate3d(${(a.x + b.x) / 2}px,${(a.y + b.y) / 2}px,0) rotate(${-ang}deg)`;
    steps.forEach((s, i) => s.classList.toggle("is-on", l >= marks[i] - 6));
  };

  build();
  draw();
  gsap.to(st, {
    p: 1,
    ease: "none",
    onUpdate: draw,
    scrollTrigger: {
      trigger: map, start: "top 62%", end: "bottom 60%", scrub: reduce ? true : 0.5,
      invalidateOnRefresh: true, onRefresh: () => { build(); draw(); },
    },
  });
}

/* ========================================================================= CTA */
function initCta(sec: HTMLElement) {
  const media = $(".cta__media", sec);
  if (!media) return;
  gsap.fromTo(media, { clipPath: "inset(10% 7% 10% 7% round 48px)" }, {
    clipPath: "inset(0% 0% 0% 0% round 0px)",
    ease: "none",
    scrollTrigger: { trigger: sec, start: "top 88%", end: "top 8%", scrub: true },
  });
}

/** Le hero tout de suite ; le reste à l'approche, dans l'ordre de la page. */
export function initHome() {
  initHero();
  scene(".manifesto", initManifesto);
  scene("[data-kseam]", initSeam, "250% 0px");
  scene(".agents", initTerminal);
  scene(".manga", initManga);
  scene(".sites", initSites);
  scene(".race", initRace, "250% 0px");
  scene(".games", initGames, "250% 0px");
  scene("[data-route]", initRoute);
  scene(".cta", initCta);

  // Les sections différées (.cv) prennent leur vraie hauteur en approchant de
  // l'écran : on recale alors les positions des scènes déjà créées.
  const ro = new ResizeObserver(() => queueRefresh());
  $$(".cv").forEach((el) => ro.observe(el));
  void lenis;
}
