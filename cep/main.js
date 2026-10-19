/**
 * Painel do Decupa (versão CEP): liga a interface ao núcleo de detecção e ao
 * ExtendScript em host/decupa.jsx.
 *
 * Fluxo: o painel acompanha o clipe selecionado na timeline; o botão
 * "Decupar" exporta só o áudio desse clipe, detecta os silêncios dentro
 * dele e aplica os cortes (vídeo e áudio juntos) pelo razor do QE DOM.
 */

/* global __adobe_cep__, cep_node */
// Com --mixed-context o require do Node é global; sem ele, fica em cep_node.
const nodeRequire = typeof cep_node !== "undefined" && cep_node.require ? cep_node.require : require;
const fs = nodeRequire("fs");
const os = nodeRequire("os");
const path = nodeRequire("path");

const $ = (id) => document.getElementById(id);
const PRESET_KEY = "decupa.presetPath";
const BATCH = 10; // regiões por chamada ao ExtendScript (para mostrar progresso)

/** Pasta da extensão, sem o prefixo file:// que o CEP devolve. */
function extensionRoot() {
  let p = decodeURI(window.__adobe_cep__.getSystemPath("extension"));
  p = p.replace(/^file:\/\//, "");
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1); // Windows: /C:/... -> C:/...
  return p;
}

const silence = nodeRequire(path.join(extensionRoot(), "lib", "silence.js"));

const state = {
  presetPath: null,
  clip: null, // clipe de áudio selecionado na timeline (ou null)
  busy: false,
  refreshing: false,
};

/* ---------------- ponte com o ExtendScript ---------------- */

/** Chama uma função de host/decupa.jsx e devolve `data`, ou lança o erro. */
function host(fn, ...args) {
  const call = `${fn}(${args.map((a) => JSON.stringify(a)).join(",")})`;
  return new Promise((resolve, reject) => {
    __adobe_cep__.evalScript(call, (raw) => {
      let res;
      try {
        res = JSON.parse(raw);
      } catch {
        reject(new Error(`O Premiere não respondeu a ${fn} (${raw}).`));
        return;
      }
      if (res.ok) resolve(res.data);
      else reject(new Error(res.error));
    });
  });
}

/* ---------------- utilidades de UI ---------------- */

function fmtTime(sec) {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

function setStatus(msg, isError = false) {
  const el = $("status");
  el.textContent = msg;
  el.className = isError ? "status error" : "status";
}

function setProgress(done, total) {
  const bar = $("progress");
  if (total <= 0) {
    bar.className = "progress hidden";
    return;
  }
  bar.className = "progress";
  $("progressBar").style.width = `${Math.round((done / total) * 100)}%`;
}

// O botão só trava enquanto trabalha: sem clipe selecionado, o clique
// explica o que fazer em vez de deixar o botão morto.
function setBusy(busy) {
  state.busy = busy;
  $("btnRun").disabled = busy;
  $("btnPreset").disabled = busy;
}

function getOptions() {
  return {
    thresholdDb: Number($("threshold").value),
    minSilence: Number($("minSilence").value),
    padBefore: Number($("padBefore").value),
    padAfter: Number($("padAfter").value),
    minSpeech: Number($("minSpeech").value),
  };
}

/* ---------------- preset ---------------- */

function showPreset() {
  const el = $("presetName");
  if (state.presetPath) {
    el.textContent = state.presetPath.split(/[\\/]/).pop();
    el.className = "";
  } else {
    el.textContent = "Nenhum preset WAV escolhido";
    el.className = "muted";
  }
}

function choosePreset() {
  const res = window.cep.fs.showOpenDialogEx(false, false, "Escolha o preset WAV (.epr)", null, ["epr"]);
  if (!res || res.err !== 0 || !res.data || res.data.length === 0) return;
  state.presetPath = res.data[0];
  try {
    localStorage.setItem(PRESET_KEY, state.presetPath);
  } catch {
    /* sem persistência: tudo bem */
  }
  showPreset();
}

/* ---------------- clipe selecionado ---------------- */

function showClip() {
  const clip = state.clip;
  $("clipBox").className = clip ? "clip" : "clip empty";
  $("clipName").textContent = clip ? clip.name || "Clipe sem nome" : "Selecione um clipe na timeline";
  $("clipInfo").textContent = clip
    ? `${fmtTime(clip.start)} – ${fmtTime(clip.end)}` + (clip.clips > 1 ? ` · ${clip.clips} clipes` : "")
    : "";
}

/** Relê a seleção da timeline (o CEP não avisa quando ela muda). */
async function refreshSelection() {
  if (state.busy || state.refreshing) return;
  state.refreshing = true;
  try {
    state.clip = await host("decupa_getSelection");
  } catch {
    state.clip = null;
  } finally {
    state.refreshing = false;
  }
  showClip();
}

/* ---------------- decupar ---------------- */

function showResult(silences, clip) {
  const duration = clip.end - clip.start;
  const sum = silence.summarize(silences, duration);
  $("statCount").textContent = String(sum.count);
  $("statRemoved").textContent = `${fmtTime(sum.removed)} (${Math.round(sum.percent)}%)`;
  $("statRemaining").textContent = fmtTime(sum.remaining);

  // Barra do clipe: cinza = fala, vermelho = silêncio cortado.
  const box = $("previewRegions");
  box.innerHTML = "";
  const total = duration || 1;
  const maxDraw = 1500; // evita milhares de divs em clipes muito longos
  const step = Math.max(1, Math.ceil(silences.length / maxDraw));
  for (let i = 0; i < silences.length; i += step) {
    const r = silences[i];
    const d = document.createElement("div");
    d.className = "region";
    d.style.left = `${((r.start - clip.start) / total) * 100}%`;
    d.style.width = `${Math.max(0.15, ((r.end - r.start) / total) * 100)}%`;
    box.appendChild(d);
  }
  $("result").className = "";
}

async function exportClipAudio(clip) {
  if (!state.presetPath) throw new Error("Escolha um preset de exportação WAV (.epr).");
  const outPath = path.join(os.tmpdir(), `decupa_${Date.now()}.wav`).replace(/\\/g, "/");
  setStatus("Exportando o áudio do clipe…");
  await host("decupa_exportAudio", outPath, state.presetPath.replace(/\\/g, "/"), clip.trackIndices.join(","));
  try {
    const buf = fs.readFileSync(outPath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } finally {
    fs.unlink(outPath, () => {});
  }
}

const DONE_VERB = { remove: "cortados", disable: "desativados", mark: "marcados" };

async function run() {
  if (state.busy) return;
  setBusy(true);
  setProgress(0, 0);
  $("result").className = "hidden";
  try {
    const clip = await host("decupa_getSelection");
    if (!clip) throw new Error("Selecione um clipe na timeline e clique de novo.");

    const buffer = await exportClipAudio(clip);
    setStatus("Analisando o áudio do clipe…");
    const levels = silence.computeLevels(silence.parseWav(buffer), 0.01);

    const opts = getOptions();
    if ($("autoThreshold").checked) {
      const part = silence.sliceLevels(levels, clip.start, clip.end);
      opts.thresholdDb = Math.min(-10, Math.max(-70, silence.suggestThreshold(part)));
      $("threshold").value = String(opts.thresholdDb);
      updateLabels();
    }

    const silences = silence.detectSilencesInRange(levels, clip.start, clip.end, opts);
    showResult(silences, clip);
    if (silences.length === 0) {
      setStatus("Nenhum silêncio encontrado nesse clipe com esses ajustes.");
      return;
    }

    const mode = $("mode").value;
    const onCopy = $("useCopy").checked && mode !== "mark";
    let copyName = null;
    if (onCopy) {
      setStatus("Duplicando sequência…");
      copyName = (await host("decupa_duplicate")).name;
    }

    // Do fim para o começo, em lotes, para a barra de progresso andar.
    const ordered = [...silences].sort((a, b) => b.start - a.start).map((r) => [r.start, r.end]);
    const t0 = Date.now();
    let done = 0;
    for (let i = 0; i < ordered.length; i += BATCH) {
      const chunk = ordered.slice(i, i + BATCH);
      const res = await host("decupa_apply", JSON.stringify(chunk), mode, i);
      done += res.done;
      setProgress(i + chunk.length, ordered.length);
      setStatus(`Aplicando cortes… ${i + chunk.length}/${ordered.length}`);
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    setStatus(
      `Pronto: ${done} silêncios ${DONE_VERB[mode]} em ${secs}s.` +
        (onCopy ? ` A cópia "${copyName}" está aberta; selecione o clipe nela para decupar de novo.` : "")
    );
  } catch (err) {
    setStatus(String(err.message || err), true);
  } finally {
    setBusy(false);
    setTimeout(() => setProgress(0, 0), 1500);
    refreshSelection();
  }
}

/* ---------------- ligações ---------------- */

const sliders = {
  threshold: { el: "thresholdVal", digits: 0 },
  minSilence: { el: "minSilenceVal", digits: 2 },
  padBefore: { el: "padBeforeVal", digits: 2 },
  padAfter: { el: "padAfterVal", digits: 2 },
  minSpeech: { el: "minSpeechVal", digits: 2 },
};

function updateLabels() {
  for (const [id, cfg] of Object.entries(sliders)) {
    $(cfg.el).textContent = Number($(id).value).toFixed(cfg.digits);
  }
}

function updateThresholdMode() {
  $("threshold").disabled = $("autoThreshold").checked;
}

for (const id of Object.keys(sliders)) $(id).addEventListener("input", updateLabels);
$("autoThreshold").addEventListener("change", updateThresholdMode);
$("btnPreset").addEventListener("click", choosePreset);
$("btnRun").addEventListener("click", run);

try {
  state.presetPath = localStorage.getItem(PRESET_KEY);
} catch {
  state.presetPath = null;
}
showPreset();
updateLabels();
updateThresholdMode();

// Se o ExtendScript não carregou, nada funciona: avisa logo na abertura.
host("decupa_hostInfo").then(
  () => {
    refreshSelection();
    setInterval(refreshSelection, 1000);
  },
  (err) => setStatus(`O script do Decupa não carregou no Premiere: ${err.message}`, true)
);
