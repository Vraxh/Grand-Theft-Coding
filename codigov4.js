// QuickDrop: plan de reparto para RunJS.
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
  costo_por_minuto_premium: 1,   // Evento 1. Por defecto 1.
};

// Un vehículo por fila. Usa "V1" o { id: "V1", capacidad: 50 }.
// Sin capacidad, el vehículo no tiene límite de peso.
const VEHICULOS = ["V1", "V2", "V3", "V4", "V5"];

// Un pedido por fila: [id, x, y, peso, premium].
// El campo premium es opcional. Acepta 1/0, true/false, "si"/"no".
// Si falta, el pedido no es premium.
const PEDIDOS = [
  [1, 8, 17, 2], [2, 1, 10, 20, 1], [3, 10, 3, 19], [4, 14, 12, 18],
  [5, 4, 3, 15], [6, 0, 12, 17], [7, 15, 5, 10], [8, 7, 4, 16],
  [9, 5, 5, 4], [10, 19, 6, 17], [11, 12, 15, 19], [12, 19, 7, 2],
  [13, 13, 14, 9], [14, 18, 8, 18, 1], [15, 5, 10, 6], [16, 6, 13, 4],
  [17, 11, 4, 1, 1], [18, 7, 15, 8], [19, 15, 8, 20], [20, 17, 6, 8],
  [21, 12, 3, 18, 1], [22, 19, 11, 16], [23, 9, 10, 9], [24, 19, 5, 15],
  [25, 12, 16, 8], [26, 6, 15, 2], [27, 4, 4, 6], [28, 0, 1, 1],
  [29, 9, 9, 14], [30, 7, 10, 17, 1], [31, 10, 10, 14], [32, 9, 19, 8],
  [33, 4, 1, 10], [34, 2, 1, 5], [35, 14, 4, 14], [36, 18, 6, 12, 1],
  [37, 17, 19, 10], [38, 1, 11, 18], [39, 14, 0, 10], [40, 5, 17, 15],
];

const OPCIONES = {
  iteraciones: 60000,   // Pasos de búsqueda por intento.
  reinicios: 3,         // Intentos por cantidad de vehículos.
  semilla: 7,
  // Cantidad de vehículos que prueba la búsqueda.
  // Para forzar exactamente 3: vehiculosMin 3 y vehiculosMax 3.
  // Para probar 3 y 4: vehiculosMin 3 y vehiculosMax 4.
  // null en vehiculosMax usa todos los vehículos cargados.
  vehiculosMin: 1,
  vehiculosMax: null,
};

// ---------- UTILIDADES ----------
const num = (v, d) =>
  v === null || v === undefined || v === "" || isNaN(Number(v)) ? d : Number(v);
const esPremium = (v) =>
  v === true || v === 1 || ["1", "true", "si", "sí"].includes(String(v).trim().toLowerCase());
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
    cPrem: num(MUNDO.costo_por_minuto_premium, 1),
  };
  const veh = VEHICULOS.map((v) => {
    const o = typeof v === "object" ? v : { id: v };
    const c = num(o.capacidad, Infinity);
    return { id: String(o.id), cap: c > 0 ? c : Infinity };
  });
  const pos = {}, peso = {}, prem = {};
  PEDIDOS.forEach(([id, x, y, w, pr]) => {
    if (x < 0 || x >= m.ancho || y < 0 || y >= m.alto) throw new Error(`Pedido ${id} fuera de la grilla.`);
    if (pos[id]) throw new Error(`Pedido ${id} repetido.`);
    pos[id] = [x, y];
    peso[id] = num(w, 0);
    prem[id] = esPremium(pr);
  });
  const ids = PEDIDOS.map((p) => p[0]);
  const capMax = Math.max(...veh.map((v) => v.cap));
  ids.forEach((i) => {
    if (peso[i] > capMax) throw new Error(`Pedido ${i} supera la capacidad máxima.`);
  });
  const hayCap = veh.some((v) => v.cap < Infinity);
  const premium = ids.filter((i) => prem[i]);
  return { m, veh, ids, pos, peso, prem, premium, hayCap };
}

// Una solución es una lista por vehículo. Cada vehículo tiene viajes.
// Un viaje es una lista de pedidos entre dos visitas al depósito.
function evaluar(p, sol) {
  const m = p.m;
  let usados = 0, cuadras = 0, makespan = 0, minPrem = 0;
  sol.forEach((viajes) => {
    const vs = viajes.filter((v) => v.length);
    if (!vs.length) return;
    usados++;
    let t = 0, pos = m.dep;
    vs.forEach((v, n) => {
      if (n > 0) {
        // Parada DEPOSITO: vuelve al depósito y carga.
        const d = dist(pos, m.dep);
        cuadras += d;
        t += d * m.minCuadra + m.carga;
        pos = m.dep;
      }
      v.forEach((i) => {
        const d = dist(pos, p.pos[i]);
        cuadras += d;
        t += d * m.minCuadra;
        if (p.prem[i]) minPrem += t;   // Minutos hasta que empieza la entrega.
        t += m.servicio;
        pos = p.pos[i];
      });
    });
    const d = dist(pos, m.dep);
    cuadras += d;
    t += d * m.minCuadra;
    makespan = Math.max(makespan, t);
  });
  const costoDist = cuadras * m.cCuadra;
  const costoVeh = usados * m.cVeh;
  const costoTiempo = makespan * m.cMin;
  const costoPrem = minPrem * m.cPrem;
  return { costo: costoDist + costoVeh + costoTiempo + costoPrem, usados, cuadras, makespan, minPrem, costoDist, costoVeh, costoTiempo, costoPrem };
}

const copiar = (sol) => sol.map((vs) => vs.map((v) => v.slice()));
const pesoViaje = (p, v) => v.reduce((s, i) => s + p.peso[i], 0);
// Sin capacidad, un vehículo hace un solo viaje: volver al depósito solo suma costo.
const normalizar = (p, sol) =>
  sol.map((vs) => {
    const f = vs.filter((v) => v.length);
    return p.hayCap ? f : f.length ? [f.flat()] : [];
  });

function solucionInicial(p) {
  const n = p.veh.length;
  const sol = Array.from({ length: n }, () => []);
  const ang = (i) => Math.atan2(p.pos[i][1] - p.m.dep[1], p.pos[i][0] - p.m.dep[0]);
  const orden = [...p.ids].sort((a, b) => ang(a) - ang(b));
  orden.forEach((i, idx) => {
    let k = Math.floor((idx * n) / orden.length);
    if (p.veh[k].cap < p.peso[i]) k = p.veh.findIndex((v) => v.cap >= p.peso[i]);
    const viajes = sol[k];
    const ultimo = viajes[viajes.length - 1];
    if (ultimo && pesoViaje(p, [...ultimo, i]) <= p.veh[k].cap) ultimo.push(i);
    else viajes.push([i]);
  });
  return sol;
}

// ---------- BÚSQUEDA (recocido simulado) ----------
function optimizar(p, iteraciones, semilla) {
  const rnd = crearRandom(semilla);
  const entero = (n) => Math.floor(rnd() * n);
  let actual = normalizar(p, solucionInicial(p));
  let cAct = evaluar(p, actual).costo;
  let mejor = copiar(actual), cMej = cAct;
  const t0 = 10, t1 = 0.05;

  Array.from({ length: iteraciones }).forEach((_, it) => {
    const temp = t0 * Math.pow(t1 / t0, it / iteraciones);
    let cand = copiar(actual);
    const mov = rnd();

    if (mov < 0.04) {
      // Junta todos los viajes de un vehículo en otro.
      const k1 = entero(cand.length), k2 = entero(cand.length);
      if (k1 === k2 || !cand[k1].length) return;
      cand[k2].push(...cand[k1]);
      cand[k1] = [];
    } else if (mov < 0.12 && p.premium.length) {
      // Pone un pedido premium al inicio de la ruta de un vehículo.
      const i = p.premium[entero(p.premium.length)];
      cand.forEach((vs) => vs.forEach((v) => {
        const idx = v.indexOf(i);
        if (idx >= 0) v.splice(idx, 1);
      }));
      const k = entero(cand.length);
      cand[k] = cand[k].filter((v) => v.length);
      if (!cand[k].length) cand[k].push([i]);
      else cand[k][0].unshift(i);
    } else if (mov < 0.6) {
      // Mueve un tramo de 1 a 3 pedidos seguidos a otra posición.
      const ki = entero(cand.length);
      const vi = cand[ki].filter((v) => v.length);
      if (!vi.length) return;
      const orig = vi[entero(vi.length)];
      const ini = entero(orig.length);
      const tramo = orig.splice(ini, 1 + entero(Math.min(3, orig.length - ini)));
      if (rnd() < 0.5) tramo.reverse();
      const k = entero(cand.length);
      cand[k] = cand[k].filter((v) => v.length);
      if (!cand[k].length || (p.hayCap && rnd() < 0.1)) cand[k].push(tramo);
      else {
        const v = cand[k][entero(cand[k].length)];
        v.splice(entero(v.length + 1), 0, ...tramo);
      }
    } else if (mov < 0.8) {
      // Intercambia dos pedidos.
      const a = p.ids[entero(p.ids.length)];
      const b = p.ids[entero(p.ids.length)];
      if (a === b) return;
      let pa = null, pb = null;
      cand.forEach((vs, k) => vs.forEach((v, j) => {
        if (v.includes(a)) pa = [k, j, v.indexOf(a)];
        if (v.includes(b)) pb = [k, j, v.indexOf(b)];
      }));
      cand[pa[0]][pa[1]][pa[2]] = b;
      cand[pb[0]][pb[1]][pb[2]] = a;
    } else {
      // Invierte un tramo de un viaje (2-opt).
      const k = entero(cand.length);
      if (!cand[k].length) return;
      const v = cand[k][entero(cand[k].length)];
      if (v.length < 2) return;
      let x = entero(v.length), y = entero(v.length);
      if (x === y) return;
      if (x > y) [x, y] = [y, x];
      v.splice(x, y - x + 1, ...v.slice(x, y + 1).reverse());
    }

    cand = normalizar(p, cand);
    // Exige usar todos los vehículos de este intento.
    if (cand.filter((vs) => vs.length).length < p.veh.length) return;
    if (!cand.every((vs, k) => vs.every((v) => pesoViaje(p, v) <= p.veh[k].cap))) return;
    const cNew = evaluar(p, cand).costo;
    if (cNew <= cAct || rnd() < Math.exp((cAct - cNew) / temp)) {
      actual = cand;
      cAct = cNew;
      if (cAct < cMej) { mejor = copiar(actual); cMej = cAct; }
    }
  });
  return mejor;
}

// ---------- PLAN ----------
function construirRutas(p, sol) {
  const rutas = [];
  sol.forEach((viajes, k) => {
    const vs = viajes.filter((v) => v.length);
    if (!vs.length) return;
    const paradas = [];
    vs.forEach((v, n) => {
      if (n > 0) paradas.push("DEPOSITO");
      paradas.push(...v);
    });
    rutas.push({ vehiculo: p.veh[k].id, paradas });
  });
  return rutas;
}

// Simula el plan con las reglas de la guía.
function simular(p, rutas) {
  const m = p.m, t0 = aMinutos(m.salida);
  let cuadras = 0, makespan = 0, entregados = 0, minPrem = 0;
  const detalle = rutas.map((r) => {
    let pos = m.dep, t = 0;
    r.paradas.forEach((s) => {
      const destino = s === "DEPOSITO" ? m.dep : p.pos[s];
      const d = dist(pos, destino);
      cuadras += d;
      t += d * m.minCuadra;
      if (s !== "DEPOSITO" && p.prem[s]) minPrem += t;   // Empieza la entrega.
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
    prem: minPrem * m.cPrem,
  };
  return { cuadras, makespan, minPrem, fallas, entregados, detalle, c, total: c.dist + c.veh + c.tiempo + c.fallas + c.prem };
}

// ---------- EJECUCIÓN ----------
const p = crearProblema();
let mejorSol = null, mejorCosto = Infinity;
const minV = Math.max(1, OPCIONES.vehiculosMin || 1);
const maxV = Math.min(p.veh.length, OPCIONES.vehiculosMax || p.veh.length);
if (minV > maxV) throw new Error("vehiculosMin es mayor que vehiculosMax.");
const comparacion = [];
// Cada intento usa exactamente N vehículos. Se queda con el plan más barato.
Array.from({ length: maxV - minV + 1 }, (_, n) => minV + n).forEach((cantidad) => {
  const pk = { ...p, veh: p.veh.slice(0, cantidad) };
  let mejorN = Infinity;
  Array.from({ length: OPCIONES.reinicios }).forEach((_, i) => {
    const s = optimizar(pk, OPCIONES.iteraciones, OPCIONES.semilla + 100 * cantidad + i);
    const c = evaluar(p, s).costo;
    mejorN = Math.min(mejorN, c);
    if (c < mejorCosto) { mejorSol = s; mejorCosto = c; }
  });
  comparacion.push({ vehiculos: cantidad, costo: mejorN });
});

const rutas = construirRutas(p, mejorSol);
const r = simular(p, rutas);
const txt = (x) => (typeof x === "string" ? `"${x}"` : x);

console.log(`Depósito: (${p.m.dep}) · Salida: ${p.m.salida}`);
console.log("\n--- COSTO POR CANTIDAD DE VEHÍCULOS ---");
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
console.log(`premium ${r.minPrem} min × ${p.m.cPrem} = ${r.c.prem}`);
console.log(`fallas ${r.fallas} × ${p.m.cFalla} = ${r.c.fallas}`);
console.log(`Entregas: ${r.entregados}/${p.ids.length}`);