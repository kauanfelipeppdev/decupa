/**
 * Testa lib/premiere.js contra uma timeline simulada (sem Premiere).
 * Serve para validar a lógica de razor + remoção com ripple; o comportamento
 * real da API ainda precisa ser conferido dentro do Premiere.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

/* ---------- timeline simulada ---------- */
function createMock() {
  const tracks = { VIDEO: [[]], AUDIO: [[]] };
  const log = [];
  const T = (s) => ({ seconds: s, alignToNearestFrame: () => T(s) });

  function makeItem(start, end) {
    const item = {
      start,
      end,
      disabled: false,
      getStartTime: async () => T(item.start),
      getEndTime: async () => T(item.end),
      createSetDisabledAction: (v) => () => (item.disabled = v),
    };
    return item;
  }
  const allTracks = () => [...tracks.VIDEO, ...tracks.AUDIO];

  const editor = {
    createRazorAllTracksAction: (media, time) => () => {
      log.push(`razor ${media} ${time.seconds}`);
      for (const tr of tracks[media]) {
        const i = tr.findIndex((it) => it.start < time.seconds && it.end > time.seconds);
        if (i >= 0) {
          const it = tr[i];
          tr.splice(i, 1, makeItem(it.start, time.seconds), makeItem(time.seconds, it.end));
        }
      }
    },
    createRemoveItemsAction: (sel, ripple) => () => {
      const items = sel.items;
      const start = Math.min(...items.map((i) => i.start));
      const end = Math.max(...items.map((i) => i.end));
      const dur = end - start;
      for (const tr of allTracks()) {
        for (let k = tr.length - 1; k >= 0; k--) if (items.includes(tr[k])) tr.splice(k, 1);
        if (ripple) for (const it of tr) if (it.start >= end - 1e-9) { it.start -= dur; it.end -= dur; }
      }
      log.push(`remove ${start}-${end}`);
    },
  };

  const trackObj = (arr) => ({ getTrackItems: async () => [...arr] });
  const sequence = {
    name: "Seq",
    guid: { toString: () => "seq-1" },
    getVideoTrackCount: async () => tracks.VIDEO.length,
    getAudioTrackCount: async () => tracks.AUDIO.length,
    getVideoTrack: async (i) => trackObj(tracks.VIDEO[i]),
    getAudioTrack: async (i) => trackObj(tracks.AUDIO[i]),
    getSettings: async () => ({ getVideoFrameRate: async () => 30 }),
  };
  const project = {
    lockedAccess: (fn) => fn(),
    executeTransaction: (cb) => {
      const actions = [];
      cb({ addAction: (a) => actions.push(a) });
      actions.forEach((a) => a());
      return true;
    },
  };

  const ppro = {
    Constants: {
      MediaType: { VIDEO: "VIDEO", AUDIO: "AUDIO" },
      TrackItemType: { CLIP: 1 },
    },
    TickTime: { createWithSeconds: T },
    SequenceEditor: { getEditor: () => editor },
    TrackItemSelection: {
      createEmptySelection: (cb) => {
        const sel = { items: [], addItem: (i) => sel.items.push(i) };
        cb(sel);
        return true;
      },
    },
  };

  // Um clipe de 10s, vídeo + áudio.
  tracks.VIDEO[0].push(makeItem(0, 10));
  tracks.AUDIO[0].push(makeItem(0, 10));
  return { ppro, project, sequence, tracks, log };
}

function loadPremiereWith(ppro) {
  const original = Module._load;
  Module._load = function (request, ...rest) {
    if (request === "premierepro") return ppro;
    if (request === "uxp") return {};
    if (request === "fs") return {};
    return original.call(this, request, ...rest);
  };
  delete require.cache[require.resolve("../plugin/lib/premiere.js")];
  try {
    return require("../plugin/lib/premiere.js");
  } finally {
    Module._load = original;
  }
}

const spans = (tr) => tr.map((i) => [i.start, i.end]);

test("modo remover: corta, remove e fecha os buracos (ripple)", async () => {
  const m = createMock();
  const premiere = loadPremiereWith(m.ppro);
  const silences = [
    { start: 2, end: 3 },
    { start: 6, end: 8 },
  ];
  const { done } = await premiere.applySilences(m.project, m.sequence, silences, "remove");
  assert.equal(done, 2);
  // 10s - 1s - 2s = 7s, em 3 pedaços contíguos
  assert.deepEqual(spans(m.tracks.VIDEO[0]), [[0, 2], [2, 5], [5, 7]]);
  assert.deepEqual(spans(m.tracks.AUDIO[0]), [[0, 2], [2, 5], [5, 7]]);
  // processou do fim para o começo
  assert.match(m.log[0], /razor VIDEO 8/);
});

test("modo desativar: corta mas não move nada", async () => {
  const m = createMock();
  const premiere = loadPremiereWith(m.ppro);
  await premiere.applySilences(m.project, m.sequence, [{ start: 4, end: 5 }], "disable");
  const v = m.tracks.VIDEO[0];
  assert.deepEqual(spans(v), [[0, 4], [4, 5], [5, 10]]);
  assert.deepEqual(v.map((i) => i.disabled), [false, true, false]);
});

test("sem API de razor, avisa em vez de quebrar", async () => {
  const m = createMock();
  delete m.ppro.SequenceEditor.getEditor().createRazorAllTracksAction;
  const premiere = loadPremiereWith(m.ppro);
  await assert.rejects(
    premiere.applySilences(m.project, m.sequence, [{ start: 1, end: 2 }], "remove"),
    /razor/
  );
});
