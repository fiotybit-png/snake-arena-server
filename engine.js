// Snake Arena — regras do jogo (mesmas do jogo no navegador), versão para servidor.

export const WORLD_R = 2600;
export const START_MASS = 20;
export const TARGET_POP = 15;
const BASE_SPEED = 170;
const BOOST_MULT = 1.9;
const BOOST_COST = 9;
const SPACING = 7;
const FOOD_COUNT = 900;
const SHIELD_TIME = 3;
const KILL_BONUS_SCORE = 10;
const KILL_BONUS_MASS = 6;
const DROP_RATIO = 0.6;

export const PALETTE = [
  "#a855f7", "#22d3ee", "#f43f5e", "#facc15", "#34d399",
  "#fb923c", "#60a5fa", "#e879f9", "#a3e635", "#f472b6",
  "#2dd4bf", "#c084fc", "#fbbf24", "#38bdf8",
];
export const PATTERNS = ["solido", "listras", "degrade", "pontos"];

const BOT_NAMES = [
  "Víbora", "Naja", "Píton", "Jiboia", "Cascavel", "Sucuri", "Coral",
  "Mamba", "Surucucu", "Caninana", "Boipeva", "Jararaca", "Anaconda",
  "Serpentina", "Kobra", "Basilisco", "Hydra", "Medusa",
];

export function radiusOf(mass) {
  return Math.min(8 + Math.sqrt(mass) * 0.55, 30);
}
function segCountOf(mass) {
  return Math.floor(8 + mass * 0.9);
}
function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class Game {
  constructor() {
    this.snakes = [];
    this.foods = [];
    this.time = 0;
    this.nextId = 1;
    this.events = [];
    this.botRespawnTimer = 0;
    for (let i = 0; i < FOOD_COUNT; i++) this.foods.push(this.randFood());
  }

  randFood(x, y, v) {
    let px = x, py = y;
    if (px === undefined || py === undefined) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * (WORLD_R - 40);
      px = Math.cos(a) * d;
      py = Math.sin(a) * d;
    }
    const val = v ?? 1 + Math.random() * 1.5;
    return { x: px, y: py, v: val, r: 3 + val * 1.6, hue: Math.floor(Math.random() * 360) };
  }

  safeSpawn() {
    let best = { x: 0, y: 0 }, bestD = -1;
    for (let t = 0; t < 30; t++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * (WORLD_R - 400);
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      let minD = Infinity;
      for (const s of this.snakes) {
        if (!s.alive) continue;
        for (let i = 0; i < s.segs.length; i += 4) {
          const dd = Math.hypot(s.segs[i].x - x, s.segs[i].y - y);
          if (dd < minD) minD = dd;
        }
      }
      if (minD > 600) return { x, y };
      if (minD > bestD) { bestD = minD; best = { x, y }; }
    }
    return best;
  }

  spawn(name, skin, bot) {
    const p = this.safeSpawn();
    const angle = Math.random() * Math.PI * 2;
    const segs = [];
    for (let i = 0; i < segCountOf(START_MASS); i++) {
      segs.push({ x: p.x - Math.cos(angle) * i * SPACING, y: p.y - Math.sin(angle) * i * SPACING });
    }
    const s = {
      id: this.nextId++, name, bot, skill: bot ? 0.3 + Math.random() * 0.7 : 1, skin, segs,
      angle, targetAngle: angle, boosting: false, mass: START_MASS, maxMass: START_MASS,
      score: 0, kills: 0, alive: true, shield: SHIELD_TIME, bornAt: this.time, diedAt: 0,
      thinkT: 0, wanderA: angle,
    };
    this.snakes.push(s);
    return s;
  }

  spawnBot() {
    const used = new Set(this.snakes.filter((s) => s.alive).map((s) => s.name));
    const pool = BOT_NAMES.filter((n) => !used.has(n));
    const name = pool[Math.floor(Math.random() * pool.length)] ?? "Bot";
    const c = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const c2 = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    this.spawn(name, { color: c, color2: c2, pattern: PATTERNS[Math.floor(Math.random() * 4)] }, true);
  }

  maintainPopulation(dt) {
    this.snakes = this.snakes.filter((s) => s.alive);
    const humans = this.snakes.filter((s) => !s.bot).length;
    const bots = this.snakes.filter((s) => s.bot).length;
    const wantBots = Math.max(0, TARGET_POP - humans);
    if (bots < wantBots) {
      this.botRespawnTimer -= dt;
      if (this.botRespawnTimer <= 0) {
        this.spawnBot();
        this.botRespawnTimer = 1.2;
      }
    } else if (bots > wantBots) {
      // mais humanos entraram: remove o menor bot
      const smallest = this.snakes.filter((s) => s.bot).sort((a, b) => a.mass - b.mass)[0];
      if (smallest) this.snakes = this.snakes.filter((s) => s !== smallest);
    }
  }

  thinkBot(s, dt) {
    s.thinkT -= dt;
    if (s.thinkT > 0) return;
    s.thinkT = 0.08 + (1 - s.skill) * 0.2;
    const h = s.segs[0];
    const r = radiusOf(s.mass);
    const look = 90 + r * 4 + s.skill * 80;
    let danger = false;
    const distC = Math.hypot(h.x, h.y);
    if (distC > WORLD_R - look - 60) danger = true;
    const ax = h.x + Math.cos(s.angle) * look, ay = h.y + Math.sin(s.angle) * look;
    for (const o of this.snakes) {
      if (!o.alive || o === s || o.shield > 0) continue;
      for (let i = 0; i < o.segs.length; i += 2) {
        const sg = o.segs[i];
        if (Math.abs(sg.x - ax) < look && Math.abs(sg.y - ay) < look) {
          if (Math.hypot(sg.x - ax, sg.y - ay) < look * 0.7) { danger = true; break; }
        }
      }
      if (danger) break;
    }
    if (danger) {
      let bestA = s.angle, bestScore = -Infinity;
      for (let k = 0; k < 12; k++) {
        const a = s.angle + ((k - 6) / 6) * Math.PI;
        const px = h.x + Math.cos(a) * look, py = h.y + Math.sin(a) * look;
        let minD = WORLD_R - Math.hypot(px, py);
        for (const o of this.snakes) {
          if (!o.alive || o === s) continue;
          for (let i = 0; i < o.segs.length; i += 3) {
            const d = Math.hypot(o.segs[i].x - px, o.segs[i].y - py);
            if (d < minD) minD = d;
          }
        }
        const sc = minD - Math.abs(angleDiff(s.angle, a)) * 20;
        if (sc > bestScore) { bestScore = sc; bestA = a; }
      }
      s.targetAngle = bestA;
      s.boosting = s.skill > 0.7 && s.mass > START_MASS + 10 && Math.random() < 0.3;
      return;
    }
    if (s.skill > 0.6 && s.mass > 40) {
      for (const o of this.snakes) {
        if (!o.alive || o === s || o.shield > 0) continue;
        const oh = o.segs[0];
        const d = Math.hypot(oh.x - h.x, oh.y - h.y);
        if (d < 300 && o.mass < s.mass) {
          const px = oh.x + Math.cos(o.angle) * 120, py = oh.y + Math.sin(o.angle) * 120;
          s.targetAngle = Math.atan2(py - h.y, px - h.x);
          s.boosting = d < 200 && s.mass > START_MASS + 15;
          return;
        }
      }
    }
    let best = null, bestV = 0;
    const range = 350 + s.skill * 250;
    for (const f of this.foods) {
      const dx = f.x - h.x, dy = f.y - h.y;
      if (Math.abs(dx) > range || Math.abs(dy) > range) continue;
      const d = Math.hypot(dx, dy);
      const v = f.v / (d + 30);
      if (v > bestV) { bestV = v; best = f; }
    }
    s.boosting = false;
    if (best) s.targetAngle = Math.atan2(best.y - h.y, best.x - h.x);
    else {
      s.wanderA += (Math.random() - 0.5) * 0.8;
      s.targetAngle = s.wanderA;
    }
  }

  kill(victim, killer) {
    victim.alive = false;
    victim.diedAt = this.time;
    const total = victim.mass * DROP_RATIO;
    const n = Math.max(6, Math.min(80, Math.floor(victim.segs.length / 2)));
    const per = total / n;
    for (let i = 0; i < n; i++) {
      const sg = victim.segs[Math.floor((i / n) * victim.segs.length)];
      this.foods.push(this.randFood(sg.x + (Math.random() - 0.5) * 20, sg.y + (Math.random() - 0.5) * 20, Math.min(per, 6)));
    }
    if (killer) {
      killer.kills++;
      killer.score += KILL_BONUS_SCORE;
      killer.mass += KILL_BONUS_MASS;
    }
    this.events.push({ type: "kill", killer: killer?.id ?? null, victim: victim.id });
  }

  step(dt) {
    this.time += dt;
    const alive = this.snakes.filter((s) => s.alive);

    for (const s of alive) {
      if (s.bot) this.thinkBot(s, dt);
      if (s.shield > 0) s.shield = Math.max(0, s.shield - dt);
      const r = radiusOf(s.mass);
      const turn = (4.2 - r * 0.06) * dt;
      const d = angleDiff(s.angle, s.targetAngle);
      s.angle += Math.max(-turn, Math.min(turn, d));
      let speed = BASE_SPEED;
      if (s.boosting && s.mass > START_MASS + 0.5) {
        speed *= BOOST_MULT;
        s.mass = Math.max(START_MASS, s.mass - BOOST_COST * dt);
        if (Math.random() < dt * 8) {
          const t = s.segs[s.segs.length - 1];
          this.foods.push(this.randFood(t.x, t.y, 0.8));
        }
      }
      const h = s.segs[0];
      s.segs[0] = { x: h.x + Math.cos(s.angle) * speed * dt, y: h.y + Math.sin(s.angle) * speed * dt };
      for (let i = 1; i < s.segs.length; i++) {
        const p = s.segs[i - 1], c = s.segs[i];
        const dx = c.x - p.x, dy = c.y - p.y;
        const dist = Math.hypot(dx, dy) || 1;
        if (dist > SPACING) {
          c.x = p.x + (dx / dist) * SPACING;
          c.y = p.y + (dy / dist) * SPACING;
        }
      }
      const want = segCountOf(s.mass);
      while (s.segs.length < want) {
        const t = s.segs[s.segs.length - 1];
        s.segs.push({ x: t.x, y: t.y });
      }
      if (s.segs.length > want) s.segs.length = want;
      if (s.mass > s.maxMass) s.maxMass = s.mass;
    }

    for (const s of alive) {
      if (s.shield > 0) continue;
      const h = s.segs[0];
      const reach = radiusOf(s.mass) + 14;
      for (let i = this.foods.length - 1; i >= 0; i--) {
        const f = this.foods[i];
        const dx = f.x - h.x, dy = f.y - h.y;
        if (Math.abs(dx) > reach + f.r || Math.abs(dy) > reach + f.r) continue;
        if (dx * dx + dy * dy < (reach + f.r) * (reach + f.r)) {
          s.mass += f.v;
          s.score += Math.round(f.v * 2);
          this.foods.splice(i, 1);
          if (!s.bot) this.events.push({ type: "eat", id: s.id });
        }
      }
    }
    while (this.foods.length < FOOD_COUNT) this.foods.push(this.randFood());

    const CELL = 80;
    const grid = new Map();
    const key = (cx, cy) => cx * 100003 + cy;
    for (const s of alive) {
      if (s.shield > 0) continue;
      const r = radiusOf(s.mass);
      for (let i = 1; i < s.segs.length; i++) {
        const sg = s.segs[i];
        const k = key(Math.floor(sg.x / CELL), Math.floor(sg.y / CELL));
        let arr = grid.get(k);
        if (!arr) grid.set(k, (arr = []));
        arr.push({ s, x: sg.x, y: sg.y, r });
      }
    }
    const dead = new Map();
    for (let i = 0; i < alive.length; i++) {
      const a = alive[i];
      if (a.shield > 0) continue;
      for (let j = i + 1; j < alive.length; j++) {
        const b = alive[j];
        if (b.shield > 0) continue;
        const d = Math.hypot(a.segs[0].x - b.segs[0].x, a.segs[0].y - b.segs[0].y);
        if (d < radiusOf(a.mass) + radiusOf(b.mass)) {
          dead.set(a, null);
          dead.set(b, null);
        }
      }
    }
    for (const s of alive) {
      if (dead.has(s)) continue;
      const h = s.segs[0];
      const r = radiusOf(s.mass);
      if (Math.hypot(h.x, h.y) + r > WORLD_R) { dead.set(s, null); continue; }
      if (s.shield > 0) continue;
      const cx = Math.floor(h.x / CELL), cy = Math.floor(h.y / CELL);
      outer: for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const arr = grid.get(key(gx, gy));
          if (!arr) continue;
          for (const e of arr) {
            if (e.s === s) continue;
            const dx = e.x - h.x, dy = e.y - h.y;
            const rr = e.r + r * 0.8;
            if (dx * dx + dy * dy < rr * rr) {
              dead.set(s, e.s);
              break outer;
            }
          }
        }
      }
    }
    for (const [victim, killer] of dead) this.kill(victim, killer);

    this.maintainPopulation(dt);
  }
}

export function leaderboard(g) {
  return g.snakes.filter((s) => s.alive).sort((a, b) => b.score - a.score || b.kills - a.kills);
}
