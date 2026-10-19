const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseWav,
  computeLevels,
  suggestThreshold,
  detectSilences,
  detectSilencesInRange,
  summarize,
} = require("../plugin/lib/silence.js");

/**
 * Gera um WAV PCM em memória a partir de uma lista de trechos:
 * [{ dur: segundos, amp: amplitude 0..1 }]. Amplitude 0 = silêncio digital;
 * um ruído de fundo leve é somado em tudo para simular gravação real.
 */
function makeWav(segments, { sampleRate = 16000, channels = 1, bits = 16, noise = 0.002 } = {}) {
  const total = segments.reduce((a, s) => a + Math.round(s.dur * sampleRate), 0);
  const bytes = bits / 8;
  const dataLen = total * channels * bytes;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + dataLen, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * bytes, true);
  v.setUint16(32, channels * bytes, true);
  v.setUint16(34, bits, true);
  w(36, "data");
  v.setUint32(40, dataLen, true);

  let o = 44;
  let t = 0;
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (const seg of segments) {
    const n = Math.round(seg.dur * sampleRate);
    for (let i = 0; i < n; i++, t++) {
      const x = seg.amp * Math.sin((2 * Math.PI * 220 * t) / sampleRate) + noise * rand();
      for (let c = 0; c < channels; c++) {
        if (bits === 16) v.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(x * 32767))), true);
        else if (bits === 24) {
          const s = Math.round(x * 8388607);
          v.setUint8(o, s & 0xff);
          v.setUint8(o + 1, (s >> 8) & 0xff);
          v.setUint8(o + 2, (s >> 16) & 0xff);
        }
        o += bytes;
      }
    }
  }
  return buf;
}

const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

test("lê cabeçalho de WAV 16-bit estéreo", () => {
  const wav = parseWav(makeWav([{ dur: 1, amp: 0.5 }], { channels: 2, sampleRate: 48000 }));
  assert.equal(wav.channels, 2);
  assert.equal(wav.sampleRate, 48000);
  assert.equal(wav.bitsPerSample, 16);
  assert.ok(near(wav.duration, 1, 0.001));
});

test("rejeita arquivo que não é WAV", () => {
  assert.throws(() => parseWav(new ArrayBuffer(64)), /WAV/);
});

test("nível de senoide com amplitude 0.5 fica perto de -9 dBFS", () => {
  const lv = computeLevels(parseWav(makeWav([{ dur: 1, amp: 0.5 }], { noise: 0 })));
  // RMS de senoide = amp/√2 → 20·log10(0.3536) ≈ -9.03 dB
  assert.ok(near(lv.db[50], -9.03, 0.2), `obtido ${lv.db[50]}`);
});

test("detecta silêncio no meio com margens aplicadas", () => {
  const lv = computeLevels(
    parseWav(makeWav([
      { dur: 2, amp: 0.4 },
      { dur: 1.5, amp: 0 },
      { dur: 2, amp: 0.4 },
    ]))
  );
  const r = detectSilences(lv, { thresholdDb: -40, minSilence: 0.5, padBefore: 0.1, padAfter: 0.2 });
  assert.equal(r.length, 1);
  assert.ok(near(r[0].start, 2.2), `start ${r[0].start}`);
  assert.ok(near(r[0].end, 3.4), `end ${r[0].end}`);
});

test("ignora silêncios mais curtos que o mínimo", () => {
  const lv = computeLevels(
    parseWav(makeWav([
      { dur: 1, amp: 0.4 },
      { dur: 0.3, amp: 0 },
      { dur: 1, amp: 0.4 },
    ]))
  );
  assert.equal(detectSilences(lv, { minSilence: 0.5 }).length, 0);
});

test("silêncio no início e no fim não recebe margem nas bordas", () => {
  const lv = computeLevels(
    parseWav(makeWav([
      { dur: 1, amp: 0 },
      { dur: 2, amp: 0.4 },
      { dur: 1, amp: 0 },
    ]))
  );
  const r = detectSilences(lv, { padBefore: 0.1, padAfter: 0.1, minSilence: 0.5 });
  assert.equal(r.length, 2);
  assert.equal(r[0].start, 0);
  assert.ok(near(r[0].end, 0.9));
  assert.ok(near(r[1].start, 3.1));
  assert.ok(near(r[1].end, 4, 0.001));
});

test("clique curto no meio do silêncio não quebra a região", () => {
  const lv = computeLevels(
    parseWav(makeWav([
      { dur: 1, amp: 0.4 },
      { dur: 0.6, amp: 0 },
      { dur: 0.04, amp: 0.6 }, // clique
      { dur: 0.6, amp: 0 },
      { dur: 1, amp: 0.4 },
    ]))
  );
  const r = detectSilences(lv, { minSpeech: 0.1, minSilence: 0.5, padBefore: 0, padAfter: 0 });
  assert.equal(r.length, 1);
  assert.ok(near(r[0].start, 1) && near(r[0].end, 2.24));

  const semFiltro = detectSilences(lv, { minSpeech: 0, minSilence: 0.5, padBefore: 0, padAfter: 0 });
  assert.equal(semFiltro.length, 2);
});

test("WAV 24-bit funciona igual ao 16-bit", () => {
  const segs = [{ dur: 1, amp: 0.4 }, { dur: 1, amp: 0 }, { dur: 1, amp: 0.4 }];
  const a = detectSilences(computeLevels(parseWav(makeWav(segs, { bits: 16 }))));
  const b = detectSilences(computeLevels(parseWav(makeWav(segs, { bits: 24 }))));
  assert.deepEqual(a, b);
});

test("limiar sugerido fica entre o ruído de fundo e a fala", () => {
  const lv = computeLevels(
    parseWav(makeWav([
      { dur: 2, amp: 0.3 },
      { dur: 2, amp: 0 },
      { dur: 2, amp: 0.3 },
    ], { noise: 0.005 }))
  );
  const t = suggestThreshold(lv);
  assert.ok(t > -50 && t < -15, `limiar ${t}`);
  assert.equal(detectSilences(lv, { thresholdDb: t, padBefore: 0, padAfter: 0 }).length, 1);
});

test("summarize soma o tempo removido", () => {
  const s = summarize([{ start: 1, end: 2 }, { start: 3, end: 3.5 }], 10);
  assert.equal(s.count, 2);
  assert.equal(s.removed, 1.5);
  assert.equal(s.percent, 15);
});

test("detecta só dentro do intervalo do clipe, em tempos da timeline", () => {
  // 0-2 silêncio | 2-4 fala | 4-5 silêncio | 5-7 fala | 7-9 silêncio
  const lv = computeLevels(
    parseWav(makeWav([
      { dur: 2, amp: 0 },
      { dur: 2, amp: 0.4 },
      { dur: 1, amp: 0 },
      { dur: 2, amp: 0.4 },
      { dur: 2, amp: 0 },
    ]))
  );
  const opts = { padBefore: 0, padAfter: 0, minSilence: 0.5 };
  // Clipe de 2s a 7s: o silêncio antes e depois dele fica de fora.
  const r = detectSilencesInRange(lv, 2, 7, opts);
  assert.equal(r.length, 1);
  assert.ok(near(r[0].start, 4) && near(r[0].end, 5), JSON.stringify(r));

  // Clipe de 3s a 9s: o silêncio do fim termina exatamente no fim do clipe.
  const r2 = detectSilencesInRange(lv, 3, 9, opts);
  assert.equal(r2.length, 2);
  assert.ok(near(r2[1].start, 7) && r2[1].end === 9, JSON.stringify(r2));
});
