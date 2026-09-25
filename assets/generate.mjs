// Tarantula mark, modelled in 3D and projected (orthographic, 3/4 from slightly above), drawn in
// flat brand colours. node assets/generate.mjs -> assets/tarantula.svg + assets/tarantula-neon.svg
import { writeFileSync } from 'node:fs';
const DIR = new URL('.', import.meta.url);
const rad = d => d * Math.PI / 180;
const r = n => Math.round(n * 10) / 10;

const C = {
  ink: '#140F22', base: '#43306B', shade: '#2A1D47', hi: '#6A52A3', fur: '#8D77C9',
  far: '#34255A', farShade: '#241942', farHi: '#4E3C80',
  knee: '#FFA629', farKnee: '#D9780F',
  eye: '#FF2B45', eyeCore: '#FFE1E5', fang: '#F3EEFB', sticker: '#EFEAFA',
};

// ---- camera ----
const PSI = rad(48), PHI = rad(34), S = 2.05;
const proj = ([x, y, z]) => {
  const xr = x * Math.cos(PSI) - y * Math.sin(PSI), yr = x * Math.sin(PSI) + y * Math.cos(PSI);
  return [S * xr, S * (yr * Math.sin(PHI) - z * Math.cos(PHI))];
};
const VIEW = [Math.cos(PHI) * Math.sin(PSI), Math.cos(PHI) * Math.cos(PSI), Math.sin(PHI)];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const norm = a => { const l = Math.hypot(...a); return a.map(v => v / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// projected outline of the linear image of a unit ball: {cx, cy, rx, ry, rot(rad)}
function shadowOf(c, vecs) {
  const [cx, cy] = proj(c);
  let m00 = 0, m01 = 0, m11 = 0;
  for (const v of vecs) { const p = proj(v); m00 += p[0] * p[0]; m01 += p[0] * p[1]; m11 += p[1] * p[1]; }
  const tr = (m00 + m11) / 2, det = Math.sqrt(((m00 - m11) / 2) ** 2 + m01 ** 2);
  return { cx, cy, rx: Math.sqrt(tr + det), ry: Math.sqrt(Math.max(0, tr - det)), rot: 0.5 * Math.atan2(2 * m01, m00 - m11) };
}
const ellipsoid = (c, [a, b, h]) => shadowOf(c, [[a, 0, 0], [0, b, 0], [0, 0, h]]);
const ellEl = (e, attrs) => `<ellipse cx="${r(e.cx)}" cy="${r(e.cy)}" rx="${r(e.rx)}" ry="${r(e.ry)}" transform="rotate(${r(e.rot * 180 / Math.PI)} ${r(e.cx)} ${r(e.cy)})" ${attrs}/>`;
const onEll = (e, t, k = 1) => {
  const x = e.rx * k * Math.cos(t), y = e.ry * k * Math.sin(t), c = Math.cos(e.rot), s = Math.sin(e.rot);
  return [e.cx + x * c - y * s, e.cy + x * s + y * c];
};
function furBlob(e, n, depth, seed) {
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * Math.PI;
    out.push(onEll(e, t), onEll(e, t + Math.PI / n * 0.9, 1 + depth * (0.5 + rnd())));
  }
  return out.map(p => `${r(p[0])},${r(p[1])}`).join(' ');
}
// point on an ellipsoid surface in direction d (unit sphere param), with its normal
function surf(c, ax, d) {
  const p = [c[0] + ax[0] * d[0], c[1] + ax[1] * d[1], c[2] + ax[2] * d[2]];
  return { p, n: norm([d[0] / ax[0], d[1] / ax[1], d[2] / ax[2]]) };
}

// ---- model: x forward, y toward the viewer's side, z up ----
const ABD = { c: [-48, 0, 30], ax: [46, 40, 30] };
const CARA = { c: [35, 0, 22], ax: [44, 38, 16] };
const TUB = { c: [58, 0, 35], ax: [15, 17, 8] };
// [coxa x, yaw, femur, patella+tibia, metatarsus+tarsus, ground reach]
const LEGS = [
  [58, 35, 45, 45, 40, 94],
  [46, 75, 40, 40, 37, 80],
  [32, 112, 38, 38, 39, 78],
  [18, 148, 47, 47, 48, 96],
];
const WID = [14, 13.5, 13, 10, 4.5]; // at coxa, knee, patella end, tibia end, tip
const COXA = { y: 26, z: 16 }, BETA = 66;

function legPose(cox, tip, a, b, c, beta) {
  const th = Math.atan2(tip[1] - cox[1], tip[0] - cox[0]), R = Math.hypot(tip[0] - cox[0], tip[1] - cox[1]);
  const T = [R - c * Math.cos(rad(beta)), tip[2] + c * Math.sin(rad(beta))];
  const tz = T[1] - cox[2];
  const d = Math.min(Math.hypot(T[0], tz), a + b - 0.5), g = Math.atan2(tz, T[0]);
  const al = Math.acos((a * a + d * d - b * b) / (2 * a * d));
  const K = [a * Math.cos(g + al), cox[2] + a * Math.sin(g + al)];
  const P = [K[0] + (T[0] - K[0]) * 0.3, K[1] + (T[1] - K[1]) * 0.3];
  const w = ([q, z]) => [cox[0] + q * Math.cos(th), cox[1] + q * Math.sin(th), z];
  return [cox, w(K), w(P), w(T), tip];
}

// ---- timing: set A steps, set B steps, then everything holds ----
// fractions of the cycle: set A steps 0-.36, set B .25-.61 (overlapping), then a ~0.55 s hold
const DUR = 1.4, STEP = 0.36, OFFSET = 0.25;
const STEP_FRAMES = 10;
let NO_HAIR = false;
const ease = s => s * s * (3 - 2 * s);

function limbs() {
  const out = [];
  LEGS.forEach(([x, yaw, a, b, c, reach], i) => {
    for (const side of [1, -1]) {
      const cox = [x, side * COXA.y, COXA.z], y0 = rad(yaw) * side;
      const rest = [cox[0] + reach * Math.cos(y0), cox[1] + reach * Math.sin(y0), 0];
      const set = (i % 2 === 0) === (side === 1) ? 0 : 1; // alternating tetrapod
      out.push({ near: side === 1, i, set, w: WID, pose: s => {
        const h = 15 * Math.sin(Math.PI * ease(s)), f = 4 * Math.sin(Math.PI * ease(s));
        return legPose(cox, [rest[0] + f, rest[1], h], a, b, c, BETA - h * 1.2);
      } });
    }
  });
  for (const side of [1, -1]) {
    const cox = [72, side * 13, 13], y0 = rad(22) * side;
    const rest = [cox[0] + 46 * Math.cos(y0), cox[1] + 46 * Math.sin(y0), 0];
    out.push({ near: side === 1, palp: true, set: side === 1 ? 0 : 1, w: [7, 6.8, 6.5, 5.5, 3], pose: s => {
      const h = 6 * Math.sin(Math.PI * ease(s));
      return legPose(cox, [rest[0] + 2 * Math.sin(Math.PI * ease(s)), rest[1], h], 22, 22, 18, 50 - h);
    } });
  }
  return out;
}

// tapered capsule between two projected points
function capsule(A, B, wa, wb) {
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1, u = [(B[0] - A[0]) / L, (B[1] - A[1]) / L], n = [-u[1], u[0]];
  const ra = wa / 2, rb = wb / 2;
  return `M${r(A[0] + n[0] * ra)} ${r(A[1] + n[1] * ra)}L${r(B[0] + n[0] * rb)} ${r(B[1] + n[1] * rb)}` +
    `A${r(rb)} ${r(rb)} 0 0 0 ${r(B[0] - n[0] * rb)} ${r(B[1] - n[1] * rb)}` +
    `L${r(A[0] - n[0] * ra)} ${r(A[1] - n[1] * ra)}A${r(ra)} ${r(ra)} 0 0 0 ${r(A[0] + n[0] * ra)} ${r(A[1] + n[1] * ra)}z`;
}
function limbPaths(J3, w) {
  const J = J3.map(proj), W = w.map(v => v * S);
  const segs = [0, 1, 2, 3].map(i => capsule(J[i], J[i + 1], W[i], W[i + 1]));
  let hi = '', hair = '';
  [0, 2, 3].forEach(i => {
    const [A, B] = [J[i], J[i + 1]], L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
    const u = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
    let n = [-u[1], u[0]]; if (n[1] > 0) n = [-n[0], -n[1]];
    const o = (W[i] + W[i + 1]) / 2 * 0.2;
    hi += `M${r(A[0] + u[0] * L * .15 + n[0] * o)} ${r(A[1] + u[1] * L * .15 + n[1] * o)}L${r(B[0] - u[0] * L * .15 + n[0] * o)} ${r(B[1] - u[1] * L * .15 + n[1] * o)}`;
    const k = i === 3 ? 3 : 4;
    for (let j = 0; j < k; j++) {
      const t = (j + 0.6) / (k + 0.2), sd = j % 2 ? 1 : -1, wd = (W[i] + (W[i + 1] - W[i]) * t) / 2;
      const px = A[0] + (B[0] - A[0]) * t + n[0] * sd * wd, py = A[1] + (B[1] - A[1]) * t + n[1] * sd * wd;
      hair += `M${r(px)} ${r(py)}l${r((n[0] * sd * .8 + u[0] * .6) * 6)} ${r((n[1] * sd * .8 + u[1] * .6) * 6)}`;
    }
  });
  return [...segs, hi, hair];
}

function drawLimb(l, animated) {
  const far = !l.near;
  const fills = [far ? C.far : C.base, far ? C.farKnee : C.knee, far ? C.far : C.base, far ? C.far : C.base];
  const rest = limbPaths(l.pose(!animated && process.env.TEST && l.set === 0 ? 0.5 : 0), l.w);
  let anim = () => '';
  if (animated) {
    const t0 = l.set * OFFSET, keys = [], vals = [];
    if (t0 > 0) { keys.push(0); vals.push(rest); }
    for (let f = 0; f <= STEP_FRAMES; f++) { keys.push(t0 + STEP * f / STEP_FRAMES); vals.push(limbPaths(l.pose(f / STEP_FRAMES), l.w)); }
    keys.push(1); vals.push(rest);
    const kt = keys.map(k => +k.toFixed(4)).join(';');
    anim = i => `<animate attributeName="d" dur="${DUR}s" repeatCount="indefinite" keyTimes="${kt}" values="${vals.map(v => v[i]).join(';')}"/>`;
  }
  const el = (i, attrs) => animated ? `<path ${attrs} d="${rest[i]}">${anim(i)}</path>` : `<path ${attrs} d="${rest[i]}"/>`;
  let s = '<g>';
  if (!NO_HAIR) s += el(5, `fill="none" stroke="${far ? C.farHi : C.fur}" stroke-width="1.6" stroke-linecap="round"`);
  for (const i of [3, 2, 1, 0]) s += el(i, `fill="${fills[i]}"`);
  s += el(4, `fill="none" stroke="${far ? C.farHi : C.hi}" stroke-width="2.6" stroke-linecap="round" stroke-opacity=".9"`);
  return s + '</g>';
}

// ---- body ----
function abdomen() {
  const e = ellipsoid(ABD.c, ABD.ax);
  let s = `<polygon points="${furBlob(e, 52, 0.09, 99)}" fill="${C.base}"/>`;
  s += `<clipPath id="ab">${ellEl(e, '')}</clipPath><g clip-path="url(#ab)" stroke="none">`;
  const low = shadowOf(add(ABD.c, [0, 12, -22]), [[ABD.ax[0], 0, 0], [0, ABD.ax[1], 0], [0, 0, ABD.ax[2]]]);
  s += ellEl(low, `fill="${C.shade}"`);
  const top = surf(ABD.c, ABD.ax, norm([0.1, -0.25, 1]));
  s += ellEl(shadowOf(top.p, [[22, 0, 0], [0, 16, 0], [0, 0, 3]]), `fill="${C.hi}"`);
  // hair flicks lying back along the visible surface
  let d = '', seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 60; i++) {
    const dir = norm([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 1.6 - 0.4]);
    const { p, n } = surf(ABD.c, ABD.ax, dir);
    if (dot(n, VIEW) < 0.25) continue;
    const a = proj(p), b = proj(add(p, norm(add([-1, 0, -0.35], n, -dot([-1, 0, -0.35], n))), 6));
    d += `M${r(a[0])} ${r(a[1])}L${r(b[0])} ${r(b[1])}`;
  }
  s += `<path d="${d}" stroke="${C.fur}" stroke-width="1.6" stroke-linecap="round" opacity=".55"/></g>`;
  return s;
}

function carapace() {
  const e = ellipsoid(CARA.c, CARA.ax);
  let s = `<polygon points="${furBlob(e, 40, 0.05, 31)}" fill="${C.base}"/>`;
  s += `<clipPath id="cp">${ellEl(e, '')}</clipPath><g clip-path="url(#cp)" stroke="none">`;
  s += ellEl(shadowOf(add(CARA.c, [4, 14, -12]), [[CARA.ax[0], 0, 0], [0, CARA.ax[1], 0], [0, 0, CARA.ax[2]]]), `fill="${C.shade}"`);
  s += ellEl(shadowOf(surf(CARA.c, CARA.ax, norm([-0.2, -0.2, 1])).p, [[18, 0, 0], [0, 12, 0], [0, 0, 1]]), `fill="${C.hi}" opacity=".8"`);
  // radial striations from the fovea
  const fov = [CARA.c[0] - 8, 0];
  let d = '';
  for (let k = 0; k < 10; k++) {
    const a = rad(k * 36 + 18); let pen = false;
    for (let j = 0; j <= 6; j++) {
      const f = 0.14 + 0.66 * j / 6, x = fov[0] + CARA.ax[0] * f * Math.cos(a), y = CARA.ax[1] * f * Math.sin(a);
      const q = 1 - ((x - CARA.c[0]) / CARA.ax[0]) ** 2 - (y / CARA.ax[1]) ** 2;
      const z = CARA.c[2] + CARA.ax[2] * Math.sqrt(Math.max(0, q));
      const nrm = norm([(x - CARA.c[0]) / CARA.ax[0] ** 2, y / CARA.ax[1] ** 2, (z - CARA.c[2]) / CARA.ax[2] ** 2]);
      if (dot(nrm, VIEW) < 0.2 || (x > TUB.c[0] - TUB.ax[0] && Math.abs(y) < TUB.ax[1])) { pen = false; continue; }
      const p = proj([x, y, z]); d += (pen ? 'L' : 'M') + r(p[0]) + ' ' + r(p[1]); pen = true;
    }
  }
  s += `<path d="${d}" stroke="${C.ink}" stroke-width="1.6" opacity=".35" fill="none" stroke-linecap="round"/></g>`;
  const f = proj([fov[0], 0, CARA.c[2] + CARA.ax[2]]);
  s += `<ellipse cx="${r(f[0])}" cy="${r(f[1])}" rx="4" ry="1.8" fill="${C.ink}" stroke="none" opacity=".7"/>`;
  return s;
}

// eight eyes on the tubercle, laid out like the real thing (seen from above):
//   front row  ALE  AME AME  ALE    big round medians in the middle, oval laterals at the corners
//   back row   PLE  PME PME  PLE    small; laterals face outward, so the far ones foreshorten
const EYES = [ // [forward, sideways] as fractions of the tubercle's axes, radius across, radius along
  [0.45, 0.28, 3.3, 3.3], [0.45, -0.28, 3.3, 3.3],   // anterior medians
  [0.36, 0.7, 3.0, 2.1], [0.36, -0.7, 3.0, 2.1],     // anterior laterals
  [-0.25, 0.36, 1.8, 1.5], [-0.25, -0.36, 1.8, 1.5], // posterior medians
  [-0.36, 0.7, 2.6, 1.8], [-0.36, -0.7, 2.6, 1.8],   // posterior laterals
];
function eyes(animated, neon = false) {
  let s = neon ? '' : ellEl(ellipsoid(TUB.c, TUB.ax), `fill="${C.shade}" stroke-width="2"`);
  for (const [fx, fy, ru, rv] of EYES) {
    const d = norm([fx, fy, Math.sqrt(1 - fx * fx - fy * fy)]);
    const { p, n } = surf(TUB.c, TUB.ax, [fx, fy, Math.sqrt(1 - fx * fx - fy * fy)]);
    if (dot(n, VIEW) < 0.05) continue;
    const t1 = norm(cross([1, 0, 0], n)), t2 = cross(n, t1);
    const e = shadowOf(add(p, n, 0.5), [t1.map(v => v * ru), t2.map(v => v * rv)]);
    const set = fy > 0 ? 'ea' : 'eb';
    const cp = onEll(e, -2.2, 0.4);
    s += `<g class="${animated ? set : ''}">` +
      ellEl({ ...e, rx: e.rx * 1.3, ry: e.ry * 1.3 }, `fill="${C.eye}" stroke="none" filter="url(#glow)" opacity=".9"`) +
      ellEl(e, `fill="${C.eye}" stroke-width="${neon ? 0 : 1.6}"`) +
      ellEl({ ...e, cx: cp[0], cy: cp[1], rx: e.rx * 0.35, ry: e.ry * 0.35 }, `fill="${C.eyeCore}" stroke="none"`) + '</g>';
  }
  return s;
}

function chelicerae() {
  let s = '';
  for (const side of [-1, 1]) {
    const c = [80, side * 9, 13], ax = [12, 8.5, 10];
    s += ellEl(ellipsoid(c, ax), `fill="${side < 0 ? C.shade : C.base}"`);
    if (side > 0) s += ellEl(shadowOf(surf(c, ax, norm([0.3, 0.3, 1])).p, [[5, 0, 0], [0, 3.5, 0], [0, 0, 1]]), `fill="${C.hi}" stroke="none"`);
    // fang: tucked under the front, curving back
    const b1 = proj(add(c, [7, -side * 1, -8])), b2 = proj(add(c, [1, side * 3, -9])), tp = proj(add(c, [-2, -side * 2, -19]));
    s += `<path d="M${r(b1[0])} ${r(b1[1])}Q${r(tp[0] + 4)} ${r(tp[1] - 6)} ${r(tp[0])} ${r(tp[1])}Q${r(b2[0])} ${r(b2[1] + 4)} ${r(b2[0])} ${r(b2[1])}z" fill="${C.fang}" stroke-width="1.8"/>`;
  }
  return s;
}

// ---- assemble ----
function build(animated) {
  const L = limbs();
  const leg = (i, near) => L.find(l => !l.palp && l.i === i && l.near === near);
  const palp = near => L.find(l => l.palp && l.near === near);
  const both = arr => animated
    ? `<g class="anim">${arr.map(l => drawLimb(l, true)).join('')}</g><g class="still">${arr.map(l => drawLimb(l, false)).join('')}</g>`
    : arr.map(l => drawLimb(l, false)).join('');
  let s = '';
  s += both([leg(3, false), leg(2, false), leg(1, false), leg(0, false), palp(false)]);
  s += `<g class="bob">${abdomen()}</g>`;
  s += both([leg(3, true), leg(2, true)]);
  s += `<g class="bob">${carapace()}${eyes(animated)}${chelicerae()}</g>`;
  s += both([leg(1, true), palp(true), leg(0, true)]);
  return s;
}

// bounds from every pose the legs reach
const pts = [];
for (const l of limbs()) for (let f = 0; f <= STEP_FRAMES; f++) for (const p of l.pose(f / STEP_FRAMES)) pts.push(proj(p));
for (const e of [ellipsoid(ABD.c, ABD.ax)]) for (let t = 0; t < 6.3; t += 0.2) pts.push(onEll(e, t, 1.1));
const M = 16;
const minX = Math.min(...pts.map(p => p[0])) - M, maxX = Math.max(...pts.map(p => p[0])) + M;
const minY = Math.min(...pts.map(p => p[1])) - M, maxY = Math.max(...pts.map(p => p[1])) + M + 6;
const VW = r(maxX - minX), VH = r(maxY - minY);
const ground = shadowOf([-10, 0, 0], [[118, 0, 0], [0, 78, 0], [0, 0, 0.01]]);

const STYLE = `<style>
.still{display:none}
.bob,.ea,.eb{transform-box:fill-box;transform-origin:center}
.bob{animation:bob ${DUR}s ease-in-out infinite;transform-box:view-box}
@keyframes bob{0%,61%,100%{transform:translateY(0)}18%,43%{transform:translateY(-1.4px)}30%{transform:translateY(-.8px)}}
.ea{animation:ba ${DUR}s ease-in-out infinite}.eb{animation:bb ${DUR}s ease-in-out infinite}
@keyframes ba{0%,10%,26%,100%{transform:scaleY(1)}18%{transform:scaleY(.08)}}
@keyframes bb{0%,35%,51%,100%{transform:scaleY(1)}43%{transform:scaleY(.08)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}.anim{display:none}.still{display:inline}}
</style>`;
const DEFS = `<defs>
<filter id="sticker" x="-10%" y="-10%" width="120%" height="120%">
<feMorphology in="SourceAlpha" operator="dilate" radius="3.5" result="d"/>
<feFlood flood-color="${C.sticker}"/><feComposite in2="d" operator="in" result="o"/>
<feMerge><feMergeNode in="o"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="glow" x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="3"/></filter>
<filter id="soft" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="6"/></filter>
</defs>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r(minX)} ${r(minY)} ${VW} ${VH}" width="${VW}" height="${VH}" role="img" aria-label="tarantula">` +
  `<title>tarantula</title>${STYLE}${DEFS}` +
  `<g transform="matrix(-1 0 0 1 ${r(minX + maxX)} 0)">` + // face left
  ellEl(ground, 'fill="#000" opacity=".22" filter="url(#soft)"') +
  `<g filter="url(#sticker)" stroke="${C.ink}" stroke-width="2.2" stroke-linejoin="round">${build(true)}</g></g></svg>`;
writeFileSync(new URL('tarantula.svg', DIR), svg);

// neon: the outer contour of the whole silhouette as a red tube, plus the eyes
const NEON = '#FF2B45';
const neonDefs = `<defs>
<filter id="neon" x="-10%" y="-10%" width="120%" height="120%">
<feMorphology in="SourceAlpha" operator="dilate" radius="2.4" result="d"/>
<feComposite in="d" in2="SourceAlpha" operator="out" result="ring"/>
<feFlood flood-color="${NEON}"/><feComposite in2="ring" operator="in" result="line"/>
<feFlood flood-color="${NEON}" flood-opacity=".07"/><feComposite in2="SourceAlpha" operator="in" result="fill"/>
<feGaussianBlur in="line" stdDeviation="4" result="g1"/><feGaussianBlur in="line" stdDeviation="11" result="g2"/>
<feFlood flood-color="#FFC2CB"/><feComposite in2="ring" operator="in" result="core"/>
<feMorphology in="core" operator="erode" radius=".6" result="hot"/>
<feMerge><feMergeNode in="fill"/><feMergeNode in="g2"/><feMergeNode in="g1"/><feMergeNode in="line"/><feMergeNode in="hot"/></feMerge></filter>
<filter id="glow" x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="3"/></filter>
</defs>`;
const neon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r(minX)} ${r(minY)} ${VW} ${VH}" width="${VW}" height="${VH}" role="img" aria-label="tarantula, neon outline">` +
  `<title>tarantula</title>${STYLE}${neonDefs}<g transform="matrix(-1 0 0 1 ${r(minX + maxX)} 0)">` +
  `<g filter="url(#neon)">${(NO_HAIR = true, build(true))}</g><g class="bob" stroke="none">${eyes(true, true)}</g></g></svg>`;
writeFileSync(new URL('tarantula-neon.svg', DIR), neon);
console.log('neon bytes', neon.length);
// footer: small, still, neon. No style block, so nothing animates
const footer = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r(minX)} ${r(minY)} ${VW} ${VH}" width="${VW}" height="${VH}" role="img" aria-label="tarantula">` +
  `${neonDefs}<g transform="matrix(-1 0 0 1 ${r(minX + maxX)} 0)">` +
  `<g filter="url(#neon)">${build(false)}</g><g stroke="none">${eyes(false, true)}</g></g></svg>`;
writeFileSync(new URL('tarantula-footer.svg', DIR), footer);
console.log('footer bytes', footer.length);

console.log('bytes', svg.length, 'viewBox', r(minX), r(minY), VW, VH);
