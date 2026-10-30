// QuickDrop: plan de reparto para RunJS (v3).
// Edita MUNDO, VEHICULOS y PEDIDOS. Ejecuta el script completo.
// Lee el depósito de MUNDO. No supone (0,0).

// ---------- DATOS (carga manual) ----------
// Copia aquí el contenido de mundo.json.
const MUNDO = {
  grilla_ancho: 20,
  grilla_alto: 20,
  deposito_x: 0,
  deposito_y: 0,
  hora_salida: "08:00",
  tiempo_servicio: 5,
  tiempo_carga: 10,
  min_por_cuadra: 3,
  costo_por_cuadra: 3,
  costo_por_vehiculo: 60,
  costo_por_minuto_total: 1,
  costo_por_falla: 200,
};

// Un vehículo por fila. Usa "V1" o { id: "V1", capacidad: 50 }.
// Sin capacidad, el vehículo no tiene límite de peso.
const VEHICULOS = ["V1", "V2", "V3", "V4", "V5"];

// Un pedido por fila: [id, x, y, peso].
const PEDIDOS = [
  [1, 8, 17, 2], [2, 1, 10, 20], [3, 10, 3, 19], [4, 14, 12, 18],
  [5, 4, 3, 15], [6, 0, 12, 17], [7, 15, 5, 10], [8, 7, 4, 16],
  [9, 5, 5, 4], [10, 19, 6, 17], [11, 12, 15, 19], [12, 19, 7, 2],
  [13, 13, 14, 9], [14, 18, 8, 18], [15, 5, 10, 6], [16, 6, 13, 4],
  [17, 11, 4, 1], [18, 7, 15, 8], [19, 15, 8, 20], [20, 17, 6, 8],
  [21, 12, 3, 18], [22, 19, 11, 16], [23, 9, 10, 9], [24, 19, 5, 15],
  [25, 12, 16, 8], [26, 6, 15, 2], [27, 4, 4, 6], [28, 0, 1, 1],
  [29, 9, 9, 14], [30, 7, 10, 17], [31, 10, 10, 14], [32, 9, 19, 8],
  [33, 4, 1, 10], [34, 2, 1, 5], [35, 14, 4, 14], [36, 18, 6, 12],
  [37, 17, 19, 10], [38, 1, 11, 18], [39, 14, 0, 10], [40, 5, 17, 15],
];

const OPCIONES = {
  semilla: 7,
  // Cantidad de vehículos que prueba la búsqueda (null en vehiculosMax usa todos).
  // Cada prueba puede dejar vehículos sin usar si así sale más barato.
  vehiculosMin: 1,
  vehiculosMax: null,
  // Etapa 1: explora cada cantidad de vehículos.
  pruebaIter: 60000,
  pruebaReinicios: 2,
  // Etapa 2: profundiza en las cantidades más baratas.
  finalIter: 400000,
  finalReinicios: 6,
  finalCantidades: 2,
  // Tope de seguridad. Si se supera, la búsqueda corta y entrega lo mejor hallado.
  tiempoMaxMs: 9000,
};

// ---------- UTILIDADES ----------
const num = (v, d) =>
  v === null || v === undefined || v === "" || isNaN(Number(v)) ? d : Number(v);
const aMinutos = (h) => {
  const [a, b] = h.split(":").map(Number);
  return a * 60 + b;
};
const aHora = (m) =>
  String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

function crearRandom(semilla) {
  let a = semilla >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- MODELO ----------
function crearProblema() {
  const m = {
    ancho: num(MUNDO.grilla_ancho, 20),
    alto: num(MUNDO.grilla_alto, 20),
    dep: [num(MUNDO.deposito_x, 0), num(MUNDO.deposito_y, 0)],
    salida: MUNDO.hora_salida || "08:00",
    servicio: num(MUNDO.tiempo_servicio, 0),
    carga: num(MUNDO.tiempo_carga, 0),
    minCuadra: num(MUNDO.min_por_cuadra, 1),
    cCuadra: num(MUNDO.costo_por_cuadra, 0),
    cVeh: num(MUNDO.costo_por_vehiculo, 0),
    cMin: num(MUNDO.costo_por_minuto_total, 0),
    cFalla: num(MUNDO.costo_por_falla, 0),
  };
  const veh = VEHICULOS.map((v) => {
    const o = typeof v === "object" ? v : { id: v };
    const c = num(o.capacidad, Infinity);
    return { id: String(o.id), cap: c > 0 ? c : Infinity };
  });
  const pos = {}, peso = {};
  PEDIDOS.forEach(([id, x, y, w]) => {
    if (x < 0 || x >= m.ancho || y < 0 || y >= m.alto) throw new Error(`Pedido ${id} fuera de la grilla.`);
    if (pos[id]) throw new Error(`Pedido ${id} repetido.`);
    pos[id] = [x, y];
    peso[id] = num(w, 0);
  });
  const ids = PEDIDOS.map((q) => q[0]);
  const capMax = veh.length ? Math.max(...veh.map((v) => v.cap)) : 0;
  const hayCap = veh.some((v) => v.cap < Infinity);
  // Un pedido que ningún vehículo puede llevar falla siempre: no se asigna.
  const imposibles = ids.filter((i) => peso[i] > capMax);
  const activos = ids.filter((i) => peso[i] <= capMax);
  // Índices internos: 0..n-1 son pedidos y n es el depósito (también marca un nuevo viaje).
  const n = activos.length, DEP = n, M = n + 1;
  const px = activos.map((i) => pos[i][0]).concat(m.dep[0]);
  const py = activos.map((i) => pos[i][1]).concat(m.dep[1]);
  const w = Float64Array.from(activos.map((i) => peso[i]).concat(0));
  const dm = new Int32Array(M * M);
  for (let a = 0; a < M; a++)
    for (let b = 0; b < M; b++) dm[a * M + b] = Math.abs(px[a] - px[b]) + Math.abs(py[a] - py[b]);
  return { m, veh, ids, pos, peso, hayCap, imposibles, activos, n, DEP, M, px, py, w, dm };
}

// Recorre la secuencia de un vehículo (pedidos y marcas de depósito) y deja en r
// distancia, cantidad de pedidos, tiempo y si respeta la capacidad en cada viaje.
function escanear(p, seq, cap, r) {
  const { dm, w, M, DEP, m } = p;
  let pos = DEP, d = 0, carga = 0, nOrd = 0, mk = 0, ok = true;
  for (let q = 0; q < seq.length; q++) {
    const s = seq[q];
    d += dm[pos * M + s];
    pos = s;
    if (s === DEP) { mk++; carga = 0; }
    else { nOrd++; carga += w[s]; if (carga > cap) ok = false; }
  }
  d += dm[pos * M + DEP];
  r.n = nOrd;
  r.d = nOrd ? d : 0;
  r.t = nOrd ? d * m.minCuadra + nOrd * m.servicio + mk * m.carga : 0;
  r.ok = ok;
}

// ---------- BÚSQUEDA (recocido simulado con evaluación incremental) ----------
function solucionInicial(p, K) {
  const seqs = Array.from({ length: K }, () => []);
  const carga = new Array(K).fill(0);
  const ang = (i) => Math.atan2(p.py[i] - p.py[p.DEP], p.px[i] - p.px[p.DEP]);
  const orden = Array.from({ length: p.n }, (_, i) => i).sort((a, b) => ang(a) - ang(b));
  for (let idx = 0; idx < orden.length; idx++) {
    const i = orden[idx];
    let k = Math.floor((idx * K) / orden.length);
    if (p.veh[k].cap < p.w[i]) k = p.veh.slice(0, K).findIndex((v) => v.cap >= p.w[i]);
    if (k < 0) return null;
    if (!p.hayCap) { seqs[k].push(i); continue; }
    if (carga[k] + p.w[i] <= p.veh[k].cap) { seqs[k].push(i); carga[k] += p.w[i]; }
    else { seqs[k].push(p.DEP, i); carga[k] = p.w[i]; }
  }
  return seqs;
}

// Quita marcas de depósito al inicio, al final o repetidas: solo suman costo.
function limpiar(p, s) {
  let w = 0;
  for (let r = 0; r < s.length; r++) {
    const v = s[r];
    if (v === p.DEP && (w === 0 || s[w - 1] === p.DEP)) continue;
    s[w++] = v;
  }
  if (w > 0 && s[w - 1] === p.DEP) w--;
  s.length = w;
}

function recocido(p, K, iteraciones, semilla, limite) {
  const inicial = solucionInicial(p, K);
  if (!inicial) return null;
  const rnd = crearRandom(semilla);
  const ent = (x) => Math.floor(rnd() * x);
  const { n, DEP, m } = p;
  const caps = p.veh.slice(0, K).map((v) => v.cap);
  const escala = Math.max(m.cCuadra + m.cMin * m.minCuadra, 1);
  const T0 = 3 * escala, T1 = 0.05 * escala;

  let seqs = inicial;
  let pool = [];
  const donde = new Int32Array(n);
  const Dk = new Float64Array(K), Nk = new Float64Array(K), Tk = new Float64Array(K);
  const r1 = { n: 0, d: 0, t: 0, ok: true }, r2 = { n: 0, d: 0, t: 0, ok: true };
  let sumD = 0, usados = 0;
  const costo = (sD, uu, mx, fl) => m.cCuadra * sD + m.cVeh * uu + m.cMin * mx + m.cFalla * fl;

  for (let k = 0; k < K; k++) {
    escanear(p, seqs[k], caps[k], r1);
    Dk[k] = r1.d; Nk[k] = r1.n; Tk[k] = r1.t;
    sumD += r1.d;
    if (r1.n) usados++;
    seqs[k].forEach((s) => { if (s !== DEP) donde[s] = k; });
  }
  const maxT0 = Math.max(0, ...Array.from(Tk));
  let cAct = costo(sumD, usados, maxT0, 0);
  let cMej = cAct, mejor = seqs.map((s) => s.slice()), mejorPool = [];

  // Evalúa un candidato que cambia el vehículo a (y opcionalmente b y el pool).
  const candidato = (a, sa, b, sb, np) => {
    escanear(p, sa, caps[a], r1);
    if (!r1.ok) return Infinity;
    let sD = sumD + r1.d - Dk[a], uu = usados + (r1.n > 0) - (Nk[a] > 0);
    if (b >= 0) {
      escanear(p, sb, caps[b], r2);
      if (!r2.ok) return Infinity;
      sD += r2.d - Dk[b];
      uu += (r2.n > 0) - (Nk[b] > 0);
    }
    let mx = 0;
    for (let k = 0; k < K; k++) {
      const t = k === a ? r1.t : k === b ? r2.t : Tk[k];
      if (t > mx) mx = t;
    }
    return costo(sD, uu, mx, np ? np.length : pool.length);
  };

  const aplicar = (a, sa, b, sb, np) => {
    seqs[a] = sa;
    sumD += r1.d - Dk[a]; usados += (r1.n > 0) - (Nk[a] > 0);
    Dk[a] = r1.d; Nk[a] = r1.n; Tk[a] = r1.t;
    sa.forEach((s) => { if (s !== DEP) donde[s] = a; });
    if (b >= 0) {
      seqs[b] = sb;
      sumD += r2.d - Dk[b]; usados += (r2.n > 0) - (Nk[b] > 0);
      Dk[b] = r2.d; Nk[b] = r2.n; Tk[b] = r2.t;
      sb.forEach((s) => { if (s !== DEP) donde[s] = b; });
    }
    if (np) { pool = np; pool.forEach((s) => { donde[s] = K; }); }
  };

  const mover = () => {
    const mov = rnd();
    if (mov < 0.45 || (!p.hayCap && mov >= 0.95)) {
      // Mueve un tramo de 1 a 3 pedidos seguidos a otra posición (o al pool).
      const i = ent(n), a = donde[i];
      let sa = null, np = null, seg;
      if (a === K) {
        np = pool.filter((x) => x !== i);
        seg = [i];
      } else {
        sa = seqs[a].slice();
        const q = sa.indexOf(i);
        const L = 1 + ent(3);
        let e = q + 1;
        while (e < sa.length && e - q < L && sa[e] !== DEP) e++;
        seg = sa.splice(q, e - q);
        if (rnd() < 0.5) seg.reverse();
      }
      let b = ent(K);
      if (a !== K && rnd() < 0.02) b = K;
      if (b === K) {
        if (a === K) return null;
        if (p.hayCap) limpiar(p, sa);
        return [a, sa, -1, null, pool.concat(seg)];
      }
      if (a === K) {
        const sb = seqs[b].slice();
        sb.splice(ent(sb.length + 1), 0, ...seg);
        return [b, sb, -1, null, np];
      }
      if (b === a) {
        sa.splice(ent(sa.length + 1), 0, ...seg);
        if (p.hayCap) limpiar(p, sa);
        return [a, sa, -1, null, null];
      }
      const sb = seqs[b].slice();
      sb.splice(ent(sb.length + 1), 0, ...seg);
      if (p.hayCap) { limpiar(p, sa); limpiar(p, sb); }
      return [a, sa, b, sb, null];
    }
    if (mov < 0.6) {
      // Intercambia dos pedidos.
      const i = ent(n), j = ent(n);
      if (i === j) return null;
      const a = donde[i], b = donde[j];
      if (a === K && b === K) return null;
      if (a === b) {
        const sa = seqs[a].slice();
        const qi = sa.indexOf(i), qj = sa.indexOf(j);
        sa[qi] = j; sa[qj] = i;
        return [a, sa, -1, null, null];
      }
      if (a === K) {
        const sb = seqs[b].slice();
        sb[sb.indexOf(j)] = i;
        return [b, sb, -1, null, pool.map((x) => (x === i ? j : x))];
      }
      if (b === K) {
        const sa = seqs[a].slice();
        sa[sa.indexOf(i)] = j;
        return [a, sa, -1, null, pool.map((x) => (x === j ? i : x))];
      }
      const sa = seqs[a].slice(), sb = seqs[b].slice();
      sa[sa.indexOf(i)] = j;
      sb[sb.indexOf(j)] = i;
      return [a, sa, b, sb, null];
    }
    if (mov < 0.8) {
      // Invierte un tramo de una ruta (2-opt).
      const a = ent(K);
      if (seqs[a].length < 2) return null;
      let x = ent(seqs[a].length), y = ent(seqs[a].length);
      if (x === y) return null;
      if (x > y) { const t = x; x = y; y = t; }
      const sa = seqs[a].slice();
      for (let lo = x, hi = y; lo < hi; lo++, hi--) { const t = sa[lo]; sa[lo] = sa[hi]; sa[hi] = t; }
      return [a, sa, -1, null, null];
    }
    if (mov < 0.95) {
      // Intercambia las colas de dos rutas: reparte la carga entre vehículos.
      if (K < 2) return null;
      const a = ent(K);
      let b = ent(K - 1);
      if (b >= a) b++;
      const A = seqs[a], B = seqs[b];
      const xa = ent(A.length + 1), xb = ent(B.length + 1);
      const sa = A.slice(0, xa).concat(B.slice(xb));
      const sb = B.slice(0, xb).concat(A.slice(xa));
      if (p.hayCap) { limpiar(p, sa); limpiar(p, sb); }
      return [a, sa, b, sb, null];
    }
    // Agrega o quita una vuelta al depósito (solo con capacidad).
    const a = ent(K);
    const sa = seqs[a].slice();
    if (rnd() < 0.5) {
      if (sa.length < 2) return null;
      sa.splice(1 + ent(sa.length - 1), 0, DEP);
    } else {
      const qs = [];
      sa.forEach((s, q) => { if (s === DEP) qs.push(q); });
      if (!qs.length) return null;
      sa.splice(qs[ent(qs.length)], 1);
    }
    limpiar(p, sa);
    return [a, sa, -1, null, null];
  };

  if (n === 0) return { costo: cAct, seqs: mejor, pool: [], cortado: false };

  // El pool arranca vacío: todos los pedidos están asignados.
  let cortado = false;
  for (let it = 0; it < iteraciones; it++) {
    if ((it & 1023) === 0 && Date.now() > limite) { cortado = true; break; }
    const c = mover();
    if (!c) continue;
    const cNew = candidato(c[0], c[1], c[2], c[3], c[4]);
    let acepta = cNew <= cAct;
    if (!acepta && cNew !== Infinity) {
      const temp = T0 * Math.pow(T1 / T0, it / iteraciones);
      acepta = rnd() < Math.exp((cAct - cNew) / temp);
    }
    if (acepta) {
      aplicar(c[0], c[1], c[2], c[3], c[4]);
      cAct = cNew;
      if (cAct < cMej) { cMej = cAct; mejor = seqs.map((s) => s.slice()); mejorPool = pool.slice(); }
    }
  }
  return { costo: cMej, seqs: mejor, pool: mejorPool, cortado };
}

// Prueba cada cantidad de vehículos y profundiza en las más baratas.
function resolver(p) {
  const NV = p.veh.length;
  if (NV === 0) return { sol: null, comparacion: [], cortado: false };
  const minV = Math.max(1, OPCIONES.vehiculosMin || 1);
  const maxV = Math.min(NV, OPCIONES.vehiculosMax || NV);
  if (minV > maxV) throw new Error("vehiculosMin es mayor que vehiculosMax.");
  const limite = Date.now() + OPCIONES.tiempoMaxMs;
  const porK = new Map();
  let mejor = null, cortado = false;
  const extra = p.m.cFalla * p.imposibles.length;
  const correr = (K, iter, semilla) => {
    const r = recocido(p, K, iter, semilla, limite);
    if (!r) return;
    if (r.cortado) cortado = true;
    r.costo += extra;
    if (!porK.has(K) || r.costo < porK.get(K).costo) porK.set(K, r);
    if (!mejor || r.costo < mejor.costo) mejor = r;
  };
  for (let K = minV; K <= maxV; K++)
    for (let i = 0; i < OPCIONES.pruebaReinicios; i++)
      correr(K, OPCIONES.pruebaIter, OPCIONES.semilla + 1000 * K + i);
  const mejores = [...porK.entries()]
    .sort((a, b) => a[1].costo - b[1].costo)
    .slice(0, OPCIONES.finalCantidades)
    .map((e) => e[0]);
  mejores.forEach((K) => {
    for (let i = 0; i < OPCIONES.finalReinicios; i++)
      correr(K, OPCIONES.finalIter, OPCIONES.semilla + 7000 + 1000 * K + i);
  });
  const comparacion = [...porK.entries()].sort((a, b) => a[0] - b[0]).map(([K, r]) => ({ vehiculos: K, costo: r.costo }));
  return { sol: mejor, comparacion, cortado };
}

// ---------- PLAN ----------
function construirRutas(p, sol) {
  const rutas = [];
  if (!sol) return rutas;
  sol.seqs.forEach((seq, k) => {
    const paradas = seq.map((s) => (s === p.DEP ? "DEPOSITO" : p.activos[s]));
    if (!paradas.some((s) => s !== "DEPOSITO")) return;
    rutas.push({ vehiculo: p.veh[k].id, paradas });
  });
  return rutas;
}

// Comprueba las condiciones de validez de la guía (y la capacidad, si hay).
function esValido(p, rutas) {
  const vistosV = new Set(), vistosP = new Set();
  const idsV = new Set(p.veh.map((v) => v.id));
  for (const r of rutas) {
    if (!idsV.has(r.vehiculo) || vistosV.has(r.vehiculo)) return false;
    vistosV.add(r.vehiculo);
    const cap = p.veh.find((v) => v.id === r.vehiculo).cap;
    let carga = 0;
    for (const s of r.paradas) {
      if (s === "DEPOSITO") { carga = 0; continue; }
      if (p.pos[s] === undefined || vistosP.has(s)) return false;
      vistosP.add(s);
      carga += p.peso[s];
      if (carga > cap) return false;
    }
  }
  return true;
}

// Plan trivial y válido: un solo vehículo, ordenado por ángulo, en viajes según capacidad.
function planDeRespaldo(p) {
  if (!p.veh.length) return [];
  const k = p.veh.reduce((b, v, i) => (v.cap > p.veh[b].cap ? i : b), 0);
  const ang = (i) => Math.atan2(p.pos[i][1] - p.m.dep[1], p.pos[i][0] - p.m.dep[0]);
  const orden = [...p.activos].sort((a, b) => ang(a) - ang(b));
  const paradas = [];
  let carga = 0;
  orden.forEach((i) => {
    if (carga + p.peso[i] > p.veh[k].cap) { paradas.push("DEPOSITO"); carga = 0; }
    paradas.push(i);
    carga += p.peso[i];
  });
  return paradas.length ? [{ vehiculo: p.veh[k].id, paradas }] : [];
}

// Simula el plan con las reglas de la guía.
function simular(p, rutas) {
  const m = p.m, t0 = aMinutos(m.salida);
  let cuadras = 0, makespan = 0, entregados = 0;
  const detalle = rutas.map((r) => {
    let pos = m.dep, t = 0;
    r.paradas.forEach((s) => {
      const destino = s === "DEPOSITO" ? m.dep : p.pos[s];
      const d = dist(pos, destino);
      cuadras += d;
      t += d * m.minCuadra;
      t += s === "DEPOSITO" ? m.carga : m.servicio;
      if (s !== "DEPOSITO") entregados++;
      pos = destino;
    });
    const dv = dist(pos, m.dep);
    cuadras += dv;
    t += dv * m.minCuadra;
    makespan = Math.max(makespan, t);
    return { vehiculo: r.vehiculo, pedidos: r.paradas.filter((s) => s !== "DEPOSITO").length, regresa: aHora(t0 + t) };
  });
  const fallas = p.ids.length - entregados;
  const c = {
    dist: cuadras * m.cCuadra, veh: rutas.length * m.cVeh,
    tiempo: makespan * m.cMin, fallas: fallas * m.cFalla,
  };
  return { cuadras, makespan, fallas, entregados, detalle, c, total: c.dist + c.veh + c.tiempo + c.fallas };
}

// ---------- EJECUCIÓN ----------
const p = crearProblema();
const inicio = Date.now();
const { sol, comparacion, cortado } = resolver(p);
let rutas = construirRutas(p, sol);
let r = simular(p, rutas);
if (!esValido(p, rutas)) {
  console.log("ADVERTENCIA: el plan optimizado no pasó la validación. Se usa el plan de respaldo.");
  rutas = planDeRespaldo(p);
  r = simular(p, rutas);
}
const txt = (x) => (typeof x === "string" ? `"${x}"` : x);

console.log(`Depósito: (${p.m.dep}) · Salida: ${p.m.salida}`);
if (cortado) console.log("AVISO: la búsqueda se cortó por el tope de tiempo; el plan es el mejor hallado hasta ese momento.");
if (p.imposibles.length) console.log(`AVISO: ${p.imposibles.length} pedido(s) superan la capacidad de todos los vehículos y fallan.`);
console.log("\n--- COSTO POR CANTIDAD DE VEHÍCULOS (como máximo) ---");
console.table(comparacion);
console.log("\n--- PLAN JSON ---");
console.log(
  '{ "rutas": [\n' +
    rutas.map((q) => `  { "vehiculo": "${q.vehiculo}", "paradas": [${q.paradas.map(txt).join(", ")}] }`).join(",\n") +
    "\n] }"
);
console.log("\n--- PLAN CSV ---");
console.log("vehiculo,parada\n" + rutas.flatMap((q) => q.paradas.map((s) => `${q.vehiculo},${s}`)).join("\n"));
console.log("\n--- RESULTADO ---");
console.table(r.detalle);
console.log(`COSTO TOTAL: ${r.total}`);
console.log(`distancia ${r.cuadras} cuadras × ${p.m.cCuadra} = ${r.c.dist}`);
console.log(`vehículos ${rutas.length} usados (costo fijo) = ${r.c.veh}`);
console.log(`tiempo ${r.makespan} min × ${p.m.cMin} = ${r.c.tiempo}`);
console.log(`fallas ${r.fallas} × ${p.m.cFalla} = ${r.c.fallas}`);
console.log(`Entregas: ${r.entregados}/${p.ids.length}`);
console.log(`Tiempo de búsqueda: ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
