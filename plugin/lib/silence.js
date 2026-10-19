/**
 * Núcleo de detecção de silêncios.
 *
 * JavaScript puro, sem dependência do Premiere: roda tanto no painel UXP
 * quanto no Node (para os testes em /test).
 *
 * Fluxo:
 *   parseWav(arrayBuffer)       -> informações do WAV + DataView
 *   computeLevels(wav, janela)  -> nível em dBFS por janela de tempo
 *   detectSilences(níveis, ...) -> regiões [{ start, end }] em segundos
 */

const MIN_DB = -120;

/**
 * Lê o cabeçalho de um arquivo WAV (PCM 8/16/24/32 bits ou float 32/64).
 * Não copia as amostras: devolve uma DataView sobre o bloco "data".
 */
function parseWav(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const tag = (offset) =>
    String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );

  if (view.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    throw new Error("Arquivo não é um WAV (RIFF/WAVE) válido.");
  }

  let offset = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataLength = 0;

  while (offset + 8 <= view.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (id === "fmt ") {
      let format = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const sampleRate = view.getUint32(body + 4, true);
      const bitsPerSample = view.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE: o formato real fica no SubFormat GUID.
      if (format === 0xfffe && size >= 26) {
        format = view.getUint16(body + 24, true);
      }
      fmt = { format, channels, sampleRate, bitsPerSample };
    } else if (id === "data") {
      dataOffset = body;
      // Alguns encoders gravam tamanho 0 ou 0xFFFFFFFF em arquivos grandes.
      const remaining = view.byteLength - body;
      dataLength = size === 0 || size > remaining ? remaining : size;
      break;
    }
    // Chunks têm tamanho par (padding de 1 byte quando ímpar).
    offset = body + size + (size % 2);
  }

  if (!fmt) throw new Error("WAV sem chunk 'fmt '.");
  if (dataOffset < 0) throw new Error("WAV sem chunk 'data'.");
  if (fmt.format !== 1 && fmt.format !== 3) {
    throw new Error(
      `Formato de WAV não suportado (código ${fmt.format}). Exporte em PCM.`
    );
  }

  const bytesPerSample = fmt.bitsPerSample / 8;
  const frameSize = bytesPerSample * fmt.channels;
  const frameCount = Math.floor(dataLength / frameSize);

  return {
    ...fmt,
    isFloat: fmt.format === 3,
    bytesPerSample,
    frameSize,
    frameCount,
    duration: frameCount / fmt.sampleRate,
    dataOffset,
    view,
  };
}

/** Função que lê uma amostra normalizada em [-1, 1] num offset de bytes. */
function sampleReader(wav) {
  const v = wav.view;
  if (wav.isFloat) {
    if (wav.bitsPerSample === 32) return (o) => v.getFloat32(o, true);
    if (wav.bitsPerSample === 64) return (o) => v.getFloat64(o, true);
  } else {
    switch (wav.bitsPerSample) {
      case 8:
        return (o) => (v.getUint8(o) - 128) / 128;
      case 16:
        return (o) => v.getInt16(o, true) / 32768;
      case 24:
        return (o) => {
          let x = v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16);
          return x / 8388608;
        };
      case 32:
        return (o) => v.getInt32(o, true) / 2147483648;
    }
  }
  throw new Error(`Profundidade de bits não suportada: ${wav.bitsPerSample}.`);
}

/**
 * Calcula o nível RMS (em dBFS) de cada janela de `windowSec` segundos,
 * somando a energia de todos os canais.
 */
function computeLevels(wav, windowSec = 0.01) {
  const read = sampleReader(wav);
  const framesPerWindow = Math.max(1, Math.round(wav.sampleRate * windowSec));
  const windowCount = Math.ceil(wav.frameCount / framesPerWindow);
  const db = new Float32Array(windowCount);

  let pos = wav.dataOffset;
  for (let w = 0; w < windowCount; w++) {
    const frames = Math.min(framesPerWindow, wav.frameCount - w * framesPerWindow);
    let sum = 0;
    for (let f = 0; f < frames; f++) {
      for (let c = 0; c < wav.channels; c++) {
        const s = read(pos);
        sum += s * s;
        pos += wav.bytesPerSample;
      }
    }
    const rms = Math.sqrt(sum / (frames * wav.channels));
    db[w] = rms > 0 ? Math.max(MIN_DB, 20 * Math.log10(rms)) : MIN_DB;
  }

  return { db, windowSec: framesPerWindow / wav.sampleRate, duration: wav.duration };
}

function percentile(values, p) {
  const sorted = Array.from(values).sort((a, b) => a - b);
  if (sorted.length === 0) return MIN_DB;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

/**
 * Sugere um limiar a partir do próprio áudio: fica entre o piso de ruído
 * (percentil 10) e o nível típico de fala (percentil 90), mais perto do piso.
 */
function suggestThreshold(levels) {
  const floor = percentile(levels.db, 10);
  const speech = percentile(levels.db, 90);
  if (speech - floor < 6) return Math.round(floor + 3); // áudio quase uniforme
  return Math.round(floor + (speech - floor) * 0.3);
}

/**
 * Encontra as regiões de silêncio.
 *
 * Opções (todas em segundos, exceto thresholdDb):
 *  - thresholdDb:  abaixo disso a janela é considerada silêncio
 *  - minSilence:   silêncios mais curtos que isso são mantidos
 *  - minSpeech:    "falas" mais curtas que isso (cliques, ruídos) viram silêncio
 *  - padBefore:    margem preservada antes de cada fala (fim do silêncio)
 *  - padAfter:     margem preservada depois de cada fala (início do silêncio)
 *
 * Retorna [{ start, end }] em segundos, ordenado e sem sobreposição.
 */
function detectSilences(levels, opts = {}) {
  const {
    thresholdDb = -40,
    minSilence = 0.5,
    minSpeech = 0.1,
    padBefore = 0.1,
    padAfter = 0.15,
  } = opts;
  const { db, windowSec, duration } = levels;
  const n = db.length;
  if (n === 0) return [];

  // 1. Marca janelas silenciosas.
  const silent = new Uint8Array(n);
  for (let i = 0; i < n; i++) silent[i] = db[i] < thresholdDb ? 1 : 0;

  // 2. Agrupa em trechos contínuos [início, fim) de mesmo tipo.
  const runs = [];
  let start = 0;
  for (let i = 1; i <= n; i++) {
    if (i === n || silent[i] !== silent[start]) {
      runs.push({ silent: silent[start] === 1, a: start, b: i });
      start = i;
    }
  }

  // 3. Falas curtíssimas entre silêncios (cliques, respiração alta) viram silêncio.
  const minSpeechWin = Math.round(minSpeech / windowSec);
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (!r.silent && r.b - r.a < minSpeechWin) {
      const prevSilent = i === 0 || runs[i - 1].silent;
      const nextSilent = i === runs.length - 1 || runs[i + 1].silent;
      if (prevSilent && nextSilent) r.silent = true;
    }
  }

  // 4. Junta silêncios vizinhos e converte para segundos.
  const raw = [];
  for (const r of runs) {
    if (!r.silent) continue;
    const s = r.a * windowSec;
    const e = Math.min(duration, r.b * windowSec);
    const last = raw[raw.length - 1];
    if (last && Math.abs(last.end - s) < 1e-9) last.end = e;
    else raw.push({ start: s, end: e });
  }

  // 5. Filtra pela duração mínima e aplica as margens.
  //    Silêncio no começo do arquivo não precisa de margem antes; no fim, depois.
  const out = [];
  for (const r of raw) {
    if (r.end - r.start < minSilence) continue;
    const s = r.start <= 0 ? 0 : r.start + padAfter;
    const e = r.end >= duration ? duration : r.end - padBefore;
    if (e - s > 0.01) out.push({ start: round(s), end: round(e) });
  }
  return out;
}

function round(x) {
  return Math.round(x * 1000) / 1000;
}

/** Totais para mostrar no painel. */
function summarize(silences, duration) {
  const removed = silences.reduce((acc, r) => acc + (r.end - r.start), 0);
  return {
    count: silences.length,
    removed,
    remaining: Math.max(0, duration - removed),
    percent: duration > 0 ? (removed / duration) * 100 : 0,
  };
}

module.exports = {
  parseWav,
  computeLevels,
  suggestThreshold,
  detectSilences,
  summarize,
  MIN_DB,
};
