/**
 * Testa cep/host/decupa.jsx (ExtendScript) contra um Premiere simulado, com
 * QE DOM falso. Valida a lógica de razor + remoção com ripple; o comportamento
 * real do QE ainda precisa ser conferido dentro do Premiere.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const JSX = fs.readFileSync(path.join(__dirname, "../cep/host/decupa.jsx"), "utf8");
const TPS = 254016000000;

/** Coleção no estilo ExtendScript (numItems/numTracks + índice) sobre um array vivo. */
const collection = (arr, countName) =>
  new Proxy(arr, {
    get: (target, key) => (key === countName ? target.length : target[key]),
  });

function createPremiere() {
  const tracks = { video: [[]], audio: [[]] };
  const muted = [];
  const log = [];
  const markers = [];
  const files = new Set();
  const all = () => [...tracks.video, ...tracks.audio];

  function makeItem(start, end, name = "clipe") {
    const item = {
      name,
      selected: false,
      disabled: false,
      start: { seconds: start },
      end: { seconds: end },
      isSelected: () => item.selected,
      remove: (ripple) => {
        const s = item.start.seconds;
        const e = item.end.seconds;
        for (const tr of all()) {
          const i = tr.indexOf(item);
          if (i >= 0) tr.splice(i, 1);
        }
        log.push(`remove ${s}-${e}${ripple ? " ripple" : ""}`);
        if (!ripple) return;
        for (const tr of all()) {
          for (const it of tr) {
            if (it.start.seconds >= e - 1e-9) {
              it.start.seconds -= e - s;
              it.end.seconds -= e - s;
            }
          }
        }
      },
    };
    return item;
  }

  const razorTrack = (tr) => ({
    razor: (tc) => {
      const t = Number(String(tc).replace("TC:", ""));
      const i = tr.findIndex((it) => it.start.seconds < t && it.end.seconds > t);
      if (i < 0) return;
      const it = tr[i];
      tr.splice(i, 1, makeItem(it.start.seconds, t, it.name), makeItem(t, it.end.seconds, it.name));
    },
  });

  const trackObj = (arr, i, kind) => {
    const obj = { clips: collection(arr, "numItems") };
    if (kind === "audio") {
      obj.isMuted = () => Boolean(muted[i]);
      obj.setMute = (m) => {
        muted[i] = Boolean(m);
      };
    }
    return obj;
  };

  const sequence = {
    name: "Seq",
    sequenceID: "seq-1",
    get videoTracks() {
      return collection(tracks.video.map((t, i) => trackObj(t, i, "video")), "numTracks");
    },
    get audioTracks() {
      return collection(tracks.audio.map((t, i) => trackObj(t, i, "audio")), "numTracks");
    },
    get end() {
      const ends = all().flat().map((it) => it.end.seconds);
      return String(Math.round(Math.max(0, ...ends) * TPS));
    },
    getSelection: () => all().flat().filter((it) => it.selected),
    getSettings: () => ({ videoFrameRate: { seconds: 1 / 30 }, videoDisplayFormat: 101 }),
    exportAsMediaDirect: (out) => {
      log.push(`export muted=${JSON.stringify(tracks.audio.map((_, i) => Boolean(muted[i])))}`);
      files.add(out);
      return "";
    },
    markers: { createMarker: (s) => markers[markers.push({ start: s }) - 1] },
  };

  const ctx = {
    app: {
      version: "26.2.0",
      build: "1",
      encoder: { ENCODE_ENTIRE: 0 },
      project: {
        activeSequence: sequence,
        sequences: collection([sequence], "numSequences"),
        openSequence: () => true,
      },
      enableQE: () => {
        ctx.qe = {
          project: {
            getActiveSequence: () => ({
              get numVideoTracks() {
                return tracks.video.length;
              },
              get numAudioTracks() {
                return tracks.audio.length;
              },
              getVideoTrackAt: (i) => razorTrack(tracks.video[i]),
              getAudioTrackAt: (i) => razorTrack(tracks.audio[i]),
            }),
          },
        };
      },
    },
    Time: function Time() {
      this.seconds = 0;
      this.getFormatted = () => `TC:${this.seconds}`;
    },
    File: function File(p) {
      this.exists = files.has(p);
    },
  };
  vm.createContext(ctx);
  vm.runInContext(JSX, ctx);

  // Um clipe de 10s, vídeo + áudio (cam + voz).
  tracks.video[0].push(makeItem(0, 10, "cam"));
  tracks.audio[0].push(makeItem(0, 10, "cam"));
  const call = (fn, ...args) => JSON.parse(ctx[fn](...args));
  return { ctx, call, tracks, muted, markers, log, makeItem };
}

const spans = (tr) => tr.map((i) => [i.start.seconds, i.end.seconds]);

test("cep: sem seleção devolve null", () => {
  const p = createPremiere();
  assert.deepEqual(p.call("decupa_getSelection"), { ok: true, data: null });
});

test("cep: acha o clipe de áudio selecionado, seu intervalo e sua trilha", () => {
  const p = createPremiere();
  p.tracks.audio.push([p.makeItem(0, 30, "musica")]);
  p.tracks.audio[0][0].selected = true;
  p.tracks.video[0][0].selected = true;
  const res = p.call("decupa_getSelection");
  assert.equal(res.ok, true);
  assert.deepEqual(res.data, {
    sequenceId: "seq-1",
    sequenceName: "Seq",
    name: "cam",
    clips: 1,
    start: 0,
    end: 10,
    trackIndices: [0],
  });
});

test("cep: exporta com só a trilha do clipe audível e restaura os mutes", () => {
  const p = createPremiere();
  p.tracks.audio.push([p.makeItem(0, 30, "musica")], [p.makeItem(0, 30, "sfx")]);
  p.muted[0] = true; // trilha do clipe estava mutada
  p.muted[2] = true;
  const res = p.call("decupa_exportAudio", "/tmp/a.wav", "/p/wav.epr", "0");
  assert.equal(res.ok, true);
  assert.ok(p.log.includes("export muted=[false,true,true]"), p.log.join("\n"));
  assert.deepEqual(p.muted.map(Boolean), [true, false, true]);
});

test("cep: exportação sem arquivo gerado vira erro legível", () => {
  const p = createPremiere();
  p.ctx.app.project.activeSequence.exportAsMediaDirect = () => "falhou";
  const res = p.call("decupa_exportAudio", "/tmp/b.wav", "/p/wav.epr", "0");
  assert.equal(res.ok, false);
  assert.match(res.error, /não gerou o arquivo/);
});

test("cep: remover corta com o razor do QE e fecha os buracos (ripple)", () => {
  const p = createPremiere();
  const regions = JSON.stringify([
    [6, 8],
    [2, 3],
  ]);
  const res = p.call("decupa_apply", regions, "remove", 0);
  assert.deepEqual(res, { ok: true, data: { done: 2 } });
  // 10s - 2s - 1s = 7s, em 3 pedaços contíguos, vídeo e áudio iguais
  assert.deepEqual(spans(p.tracks.video[0]), [[0, 2], [2, 5], [5, 7]]);
  assert.deepEqual(spans(p.tracks.audio[0]), [[0, 2], [2, 5], [5, 7]]);
  // em cada região, só a última remoção usa ripple
  assert.deepEqual(
    p.log.filter((l) => l.startsWith("remove")),
    ["remove 6-8", "remove 6-8 ripple", "remove 2-3", "remove 2-3 ripple"]
  );
});

test("cep: trava de segurança dispara quando a sequência não encolhe", () => {
  const p = createPremiere();
  // Simula um Premiere em que o ripple não fecha o buraco: tudo vira "lift".
  const ctx = p.ctx;
  const realApply = ctx.decupa_rippleRemove;
  ctx.decupa_rippleRemove = (pieces) => {
    for (const piece of pieces) piece.remove(false, true);
  };
  const res = p.call("decupa_apply", JSON.stringify([[2, 3]]), "remove", 0);
  ctx.decupa_rippleRemove = realApply;
  assert.equal(res.ok, false);
  assert.match(res.error, /não fechou o buraco/);
});

test("cep: desativar corta mas não move nada", () => {
  const p = createPremiere();
  const res = p.call("decupa_apply", JSON.stringify([[4, 5]]), "disable", 0);
  assert.equal(res.ok, true);
  assert.deepEqual(spans(p.tracks.video[0]), [[0, 4], [4, 5], [5, 10]]);
  assert.deepEqual(p.tracks.video[0].map((i) => i.disabled), [false, true, false]);
  assert.deepEqual(p.tracks.audio[0].map((i) => i.disabled), [false, true, false]);
});

test("cep: só marcar cria marcadores numerados com início e fim", () => {
  const p = createPremiere();
  const res = p.call("decupa_apply", JSON.stringify([[6, 8], [2, 3]]), "mark", 10);
  assert.deepEqual(res, { ok: true, data: { done: 2 } });
  assert.deepEqual(
    p.markers.map((m) => [m.name, m.start, m.end]),
    [
      ["Silêncio 11", 6, 8],
      ["Silêncio 12", 2, 3],
    ]
  );
  assert.equal(p.tracks.video[0].length, 1); // nada cortado
});

test("cep: lib/silence.js é a mesma cópia do plugin UXP", () => {
  const a = fs.readFileSync(path.join(__dirname, "../plugin/lib/silence.js"), "utf8");
  const b = fs.readFileSync(path.join(__dirname, "../cep/lib/silence.js"), "utf8");
  assert.equal(b, a, "rode: cp plugin/lib/silence.js cep/lib/silence.js");
});
