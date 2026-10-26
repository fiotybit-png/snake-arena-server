// Snake Arena — servidor multiplayer.
// Roda as salas, as regras e os bots. Os jogadores só enviam a direção e o turbo.
import http from "node:http";
import { WebSocketServer } from "ws";
import { Game, leaderboard, WORLD_R, PALETTE, PATTERNS } from "./engine.js";

const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 30; // humanos por sala
const SIM_HZ = 60;
const SEND_HZ = 20;
const VIEW_W = 1800, VIEW_H = 1200; // metade da área visível enviada a cada jogador
const IDLE_KICK_S = 120; // desconecta quem fica 2 min sem enviar nada
// Ranking geral (top 5 da tela inicial). Sem SCORE_SECRET o ranking fica desligado.
const SCORE_URL = process.env.SCORE_URL || "https://snake.talisjoga.com/api/public/scores";
const SCORE_SECRET = process.env.SCORE_SECRET || "";

const rooms = new Map(); // id -> { id, game, clients:Set }
let nextRoom = 1;

function createRoom() {
  const room = { id: nextRoom++, game: new Game(), clients: new Set() };
  for (let i = 0; i < 14; i++) room.game.spawnBot();
  rooms.set(room.id, room);
  console.log(`[sala ${room.id}] criada`);
  return room;
}
function pickRoom() {
  let best = null;
  for (const r of rooms.values()) {
    if (r.clients.size < MAX_PLAYERS && (!best || r.clients.size > best.clients.size)) best = r;
  }
  return best ?? createRoom();
}

// ---------- ranking geral ----------
function submitScore(s) {
  if (!SCORE_SECRET || !s || s.bot || !(s.score > 0)) return;
  fetch(SCORE_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-score-secret": SCORE_SECRET },
    body: JSON.stringify({ name: s.name, score: Math.round(s.score), kills: s.kills, maxMass: Math.round(s.maxMass) }),
    signal: AbortSignal.timeout(8000),
  }).then((r) => { if (!r.ok) console.log(`[ranking] recusado: ${r.status}`); })
    .catch((e) => console.log(`[ranking] falhou: ${e.message}`));
}

// ---------- validação ----------
const HEX = /^#[0-9a-fA-F]{6}$/;
function cleanName(n) {
  const s = String(n ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 16);
  return s || "Jogador";
}
function cleanSkin(sk) {
  const color = HEX.test(sk?.color) ? sk.color : PALETTE[0];
  const color2 = HEX.test(sk?.color2) ? sk.color2 : PALETTE[1];
  const pattern = PATTERNS.includes(sk?.pattern) ? sk.pattern : "solido";
  return { color, color2, pattern };
}

// ---------- servidor HTTP (Render verifica se está vivo) ----------
const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/health") {
    let players = 0;
    for (const r of rooms.values()) players += r.clients.size;
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, players }));
    return;
  }
  res.writeHead(404); res.end();
});

const wss = new WebSocketServer({ server, maxPayload: 2048 });

wss.on("connection", (ws) => {
  const client = {
    ws, room: null, snake: null, name: "Jogador", skin: cleanSkin({}),
    lastMsg: Date.now(), msgCount: 0, msgWindow: Date.now(),
    cam: { x: 0, y: 0 }, deathSent: true,
  };

  const send = (obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };

  const spawn = () => {
    const g = client.room.game;
    client.snake = g.spawn(client.name, client.skin, false);
    client.deathSent = false;
    send({ t: "spawn", id: client.snake.id });
  };

  ws.on("message", (raw) => {
    const now = Date.now();
    client.lastMsg = now;
    // limite simples: no máximo 60 mensagens por segundo
    if (now - client.msgWindow > 1000) { client.msgWindow = now; client.msgCount = 0; }
    if (++client.msgCount > 60) return;

    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (!m || typeof m !== "object") return;

    if (m.t === "join" && !client.room) {
      client.name = cleanName(m.name);
      client.skin = cleanSkin(m.skin);
      client.room = pickRoom();
      client.room.clients.add(client);
      send({ t: "welcome", room: client.room.id, worldR: WORLD_R, maxPlayers: MAX_PLAYERS });
      spawn();
      console.log(`[sala ${client.room.id}] entrou ${client.name} (${client.room.clients.size}/${MAX_PLAYERS})`);
      return;
    }
    if (!client.room) return;

    if (m.t === "input" && client.snake?.alive) {
      const a = Number(m.a);
      if (Number.isFinite(a)) client.snake.targetAngle = a;
      client.snake.boosting = !!m.b;
    } else if (m.t === "respawn" && !client.snake?.alive) {
      spawn();
    } else if (m.t === "ping") {
      send({ t: "pong", c: m.c });
    }
  });

  ws.on("close", () => {
    const r = client.room;
    if (!r) return;
    r.clients.delete(client);
    if (client.snake?.alive) submitScore(client.snake); // saiu no meio da partida
    if (client.snake) client.snake.alive = false; // some do mapa
    console.log(`[sala ${r.id}] saiu ${client.name} (${r.clients.size}/${MAX_PLAYERS})`);
    if (r.clients.size === 0 && rooms.size > 1) { rooms.delete(r.id); console.log(`[sala ${r.id}] fechada`); }
  });
});

// ---------- estado enviado a cada jogador ----------
const round = (n) => Math.round(n);

function snapshotFor(client, room, lb, withFood) {
  const g = room.game;
  const me = client.snake;
  if (me?.alive) client.cam = { x: me.segs[0].x, y: me.segs[0].y };
  const { x: cx, y: cy } = client.cam;
  const minX = cx - VIEW_W, maxX = cx + VIEW_W, minY = cy - VIEW_H, maxY = cy + VIEW_H;

  const snakes = [];
  for (const s of g.snakes) {
    if (!s.alive) continue;
    let visible = false;
    for (let i = 0; i < s.segs.length; i += 4) {
      const p = s.segs[i];
      if (p.x > minX && p.x < maxX && p.y > minY && p.y < maxY) { visible = true; break; }
    }
    if (!visible) continue;
    const pts = [];
    for (let i = 0; i < s.segs.length; i += 2) pts.push(round(s.segs[i].x), round(s.segs[i].y));
    snakes.push({
      i: s.id, n: s.name, b: s.bot ? 1 : 0, k: s.skin,
      m: Math.round(s.mass * 10) / 10, a: Math.round(s.angle * 100) / 100,
      bo: s.boosting ? 1 : 0, sh: Math.round(s.shield * 10) / 10, p: pts,
    });
  }
  const foods = withFood ? [] : undefined;
  if (withFood) for (const f of g.foods) {
    if (f.x > minX && f.x < maxX && f.y > minY && f.y < maxY) foods.push(round(f.x), round(f.y), Math.round(f.r * 10) / 10, f.hue);
  }
  const heads = [];
  for (const s of g.snakes) if (s.alive) heads.push(s.id, round(s.segs[0].x), round(s.segs[0].y));

  return {
    t: "state",
    me: me ? { id: me.id, alive: me.alive, score: me.score, kills: me.kills, mass: Math.round(me.mass), shield: me.shield } : null,
    rank: me?.alive ? lb.findIndex((s) => s.id === me.id) + 1 : 0,
    total: lb.length,
    top: lb.slice(0, 10).map((s) => ({ i: s.id, n: s.name, b: s.bot ? 1 : 0, s: s.score, k: s.kills })),
    snakes, foods, heads,
  };
}

// ---------- loop do jogo ----------
let sendAcc = 0;
let sendN = 0;
let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  sendAcc += dt;
  const sendNow = sendAcc >= 1 / SEND_HZ;
  if (sendNow) { sendAcc = 0; sendN++; }

  for (const room of rooms.values()) {
    const g = room.game;
    g.step(dt);

    // avisa quem morreu
    for (const e of g.events) {
      if (e.type !== "kill") continue;
      for (const c of room.clients) {
        if (c.snake && c.snake.id === e.victim && !c.deathSent) {
          c.deathSent = true;
          const s = c.snake;
          submitScore(s);
          c.ws.readyState === 1 && c.ws.send(JSON.stringify({
            t: "dead", score: s.score, kills: s.kills, maxMass: Math.round(s.maxMass),
            time: Math.round(s.diedAt - s.bornAt), killer: e.killer,
          }));
        }
        if (c.snake && c.snake.id === e.killer && c.ws.readyState === 1) {
          c.ws.send(JSON.stringify({ t: "kill", victim: e.victim }));
        }
      }
    }
    g.events = [];

    if (sendNow && room.clients.size) {
      const lb = leaderboard(g);
      const withFood = sendN % 4 === 0; // comida vai 5x por segundo
      for (const c of room.clients) {
        if (c.ws.readyState === 1 && c.ws.bufferedAmount < 512 * 1024) c.ws.send(JSON.stringify(snapshotFor(c, room, lb, withFood)));
      }
    }
  }
}, 1000 / SIM_HZ);

// derruba conexões paradas
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) for (const c of r.clients) {
    if (now - c.lastMsg > IDLE_KICK_S * 1000) c.ws.terminate();
  }
}, 10000);

createRoom();
server.listen(PORT, () => console.log(`Snake Arena servidor na porta ${PORT}`));
