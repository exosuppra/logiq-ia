/**
 * Les karts de Kartoche en vraie 3D (three.js).
 * Les modèles viennent du jeu : carrosserie, quatre roues et pilote assis,
 * assemblés depuis les FBX du projet Unreal puis exportés en GLB compressé.
 * Chargé à la demande, uniquement quand une scène 3D approche de l'écran.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const FOV = 26;
const TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const KART_LEN = 1.9;

let loader: GLTFLoader | null = null;
const cache = new Map<string, Promise<THREE.Group>>();

function loadModel(id: string): Promise<THREE.Group> {
  if (!loader) {
    const draco = new DRACOLoader();
    draco.setDecoderPath("/draco/");
    loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
  }
  if (!cache.has(id)) {
    cache.set(id, loader.loadAsync(`/models/kart-${id}.glb`).then((g) => g.scene));
  }
  return cache.get(id)!.then((scene) => scene.clone(true));
}

let blob: THREE.Texture | null = null;
function blobTexture() {
  if (blob) return blob;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, "rgba(0,0,0,0.5)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  blob = new THREE.CanvasTexture(c);
  return blob;
}

/** Un kart posé dans une scène : cap, roues qui tournent, ombre portée. */
export class Kart {
  root = new THREE.Group(); // position et cap dans le monde
  body = new THREE.Group(); // roulis / tangage de la caisse
  private wheels: { o: THREE.Object3D; sign: number; r: number }[] = [];

  constructor(model: THREE.Group) {
    this.body.add(model);
    this.root.add(this.body);
    model.traverse((o) => {
      if (!/^wheel_[FR][LR]$/.test(o.name)) return;
      const box = new THREE.Box3().setFromObject(o);
      const r = (box.max.y - box.min.y) / 2 || 0.22;
      // les roues droites sont retournées de 180° : leur axe local est inversé
      this.wheels.push({ o, sign: o.name.endsWith("R") ? 1 : -1, r });
    });
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.9, 2.1),
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.012;
    this.root.add(shadow);
  }

  /** Fait rouler les roues pour une distance parcourue (mètres, vers l'avant). */
  roll(dist: number) {
    this.wheels.forEach((w) => w.o.rotateZ((w.sign * dist) / w.r));
  }
}

class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
  w = 1;
  h = 1;

  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.96;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.85;
    const key = new THREE.DirectionalLight(0xfff1dc, 2.6);
    key.position.set(3, 6, 5);
    this.scene.add(key, new THREE.HemisphereLight(0xffffff, 0x4c3a72, 0.3));
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

export type Crossing = {
  ready: Promise<void>;
  /** x : position à l'écran (px, repère du canvas) ; lane : couloir (0 = devant) ; t : phase d'animation */
  place: (i: number, x: number, t: number) => void;
  resize: () => void;
  render: () => void;
};

/**
 * Peloton qui traverse l'écran de droite à gauche. `frac` : part de la largeur
 * occupée par un kart au premier plan ; `ground` : hauteur du sol à l'écran (0 haut, 1 bas).
 */
export function createCrossing(
  canvas: HTMLCanvasElement,
  ids: string[],
  opts: { frac: () => number; ground: number; lanes: number[] },
): Crossing {
  const stage = new Stage(canvas);
  const karts: (Kart | null)[] = ids.map(() => null);
  const last: number[] = ids.map(() => NaN);
  let dist = 10;

  const resize = () => {
    stage.resize();
    const aspect = stage.w / stage.h;
    dist = opts.lanes[0] + KART_LEN / opts.frac() / (2 * aspect * TAN);
    const camY = dist * 0.09 + 0.45; // caméra basse : vue de côté plutôt que plongeante
    stage.camera.position.set(0, camY, dist);
    // vise le point qui place l'origine du sol exactement à la hauteur demandée
    const ndc = 1 - opts.ground * 2; // -1 bas … 1 haut
    const o = new THREE.Vector3();
    let lo = -dist, hi = dist;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      stage.camera.lookAt(0, mid, 0);
      stage.camera.updateMatrixWorld();
      if (o.set(0, 0, 0).project(stage.camera).y > ndc) lo = mid; else hi = mid;
    }
  };

  const place = (i: number, x: number, t: number) => {
    const k = karts[i];
    if (!k) return;
    const z = opts.lanes[i % opts.lanes.length];
    const aspect = stage.w / stage.h;
    const wx = (x / stage.w - 0.5) * 2 * aspect * TAN * (dist - z);
    if (!Number.isNaN(last[i])) k.roll(last[i] - wx); // avance vers la gauche
    last[i] = wx;
    k.root.position.set(wx, 0, z);
    // presque de profil, nez vers la gauche : les quatre roues restent bien
    // distinctes (de trois-quarts, la roue arrière passait derrière l'avant)
    k.root.rotation.y = Math.PI + 0.16 + Math.sin(t * 7 + i * 2.1) * 0.05;
    k.body.rotation.x = Math.sin(t * 11 + i) * 0.035; // roulis
    k.body.position.y = Math.abs(Math.sin(t * 26 + i * 1.3)) * 0.035; // cahots
  };

  const ready = Promise.all(
    ids.map((id, i) =>
      loadModel(id).then((m) => {
        const k = new Kart(m);
        karts[i] = k;
        stage.scene.add(k.root);
      }),
    ),
  ).then(() => { resize(); });

  resize();
  return { ready, place, resize, render: () => stage.render() };
}

export type Viewer = { ready: Promise<void>; show: (i: number) => void; setActive: (on: boolean) => void; resize: () => void };

/** Présentoir : un kart sur son plateau, qu'on fait tourner à la souris ou au doigt. */
export function createViewer(canvas: HTMLCanvasElement, ids: string[], reduce: boolean): Viewer {
  const stage = new Stage(canvas);
  const pivot = new THREE.Group();
  stage.scene.add(pivot);
  const karts: Kart[] = [];
  let current = 0;
  let active = false;
  let raf = 0;
  let yaw = -0.7, vel = 0.35, dragging = false, px = 0, pop = 1;
  let prev = performance.now();

  // plateau tournant
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.6, 0.12, 64),
    new THREE.MeshStandardMaterial({ color: 0x22192e, roughness: 0.35, metalness: 0.2 }),
  );
  disc.position.y = -0.06;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.53, 0.035, 12, 96),
    new THREE.MeshStandardMaterial({ color: 0xf2b632, roughness: 0.3, metalness: 0.4, emissive: 0xf2b632, emissiveIntensity: 0.25 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.01;
  pivot.add(disc, ring);

  const resize = () => {
    stage.resize();
    const aspect = stage.w / stage.h;
    const d = Math.max(5.9, 4.2 / (2 * aspect * TAN));
    stage.camera.position.set(0, d * 0.3 + 0.3, d);
    stage.camera.lookAt(0, 0.36, 0);
  };

  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    if (!dragging) {
      vel += ((reduce ? 0 : 0.35) - vel) * Math.min(1, dt * 1.6); // revient à sa vitesse de croisière
      yaw += vel * dt;
    }
    pop += (1 - pop) * Math.min(1, dt * 9);
    pivot.rotation.y = yaw;
    const k = karts[current];
    if (k) {
      k.root.scale.setScalar(0.6 + 0.4 * pop);
      if (!reduce) {
        k.roll(dt * 2.2);
        k.body.position.y = Math.sin(now / 420) * 0.012;
      }
    }
    stage.render();
    if (active) raf = requestAnimationFrame(frame);
  };

  const setActive = (on: boolean) => {
    if (on === active) return;
    active = on;
    cancelAnimationFrame(raf);
    if (on) { prev = performance.now(); raf = requestAnimationFrame(frame); }
  };

  const show = (i: number) => {
    if (!karts[i]) return;
    karts.forEach((k, j) => k && (k.root.visible = j === i));
    current = i;
    pop = 0;
    vel = 3.4; // petit tour d'honneur à chaque changement de pilote
    if (!active) stage.render();
  };

  canvas.style.touchAction = "pan-y";
  canvas.style.cursor = "grab";
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true; px = e.clientX; vel = 0;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = "grabbing";
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - px;
    px = e.clientX;
    yaw += dx * 0.011;
    vel = dx * 0.5;
  });
  const end = () => { dragging = false; canvas.style.cursor = "grab"; };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  const ready = Promise.all(
    ids.map((id, i) =>
      loadModel(id).then((m) => {
        const k = new Kart(m);
        k.root.visible = i === 0;
        karts[i] = k;
        pivot.add(k.root);
      }),
    ),
  ).then(() => { resize(); stage.render(); });

  resize();
  return { ready, show, setActive, resize };
}
