/**
 * Painel do Decupa: liga a interface ao núcleo de detecção e à API do Premiere.
 */

const uxp = require("uxp");
const silence = require("./lib/silence.js");
const premiere = require("./lib/premiere.js");

const $ = (id) => document.getElementById(id);
const PRESET_KEY = "decupa.presetPath";

const state = {
  presetPath: null,
  levels: null, // níveis de áudio da última análise
  sequenceGuid: null, // sequência analisada
  silences: [],
  busy: false,
};

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

function setBusy(busy) {
  state.busy = busy;
  for (const id of ["btnAnalyze", "btnApply", "btnPreset", "btnAuto"]) $(id).disabled = busy;
}

function enableSections(enabled) {
  $("paramsSection").className = enabled ? "" : "disabled";
  $("applySection").className = enabled ? "" : "disabled";
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

async function choosePreset() {
  const file = await uxp.storage.localFileSystem.getFileForOpening({ types: ["epr"] });
  if (!file || !file.nativePath) return;
  state.presetPath = file.nativePath;
  try {
    localStorage.setItem(PRESET_KEY, state.presetPath);
  } catch {
    /* sem persistência: tudo bem */
  }
  showPreset();
}

/* ---------------- análise e pré-visualização ---------------- */

function recompute() {
  if (!state.levels) return;
  state.silences = silence.detectSilences(state.levels, getOptions());
  const sum = silence.summarize(state.silences, state.levels.duration);

  $("statCount").textContent = String(sum.count);
  $("statRemoved").textContent = `${fmtTime(sum.removed)} (${Math.round(sum.percent)}%)`;
  $("statRemaining").textContent = fmtTime(sum.remaining);

  // Barra de pré-visualização: cinza = fala, vermelho = vai sair.
  const box = $("previewRegions");
  box.innerHTML = "";
  const total = state.levels.duration || 1;
  const maxDraw = 1500; // evita milhares de divs em vídeos muito longos
  const step = Math.max(1, Math.ceil(state.silences.length / maxDraw));
  for (let i = 0; i < state.silences.length; i += step) {
    const r = state.silences[i];
    const d = document.createElement("div");
    d.className = "region";
    d.style.left = `${(r.start / total) * 100}%`;
    d.style.width = `${Math.max(0.15, ((r.end - r.start) / total) * 100)}%`;
    box.appendChild(d);
  }
}

async function analyze() {
  if (state.busy) return;
  setBusy(true);
  setProgress(0, 0);
  try {
    const { sequence } = await premiere.getActiveContext();
    const buffer = await premiere.exportSequenceAudio(sequence, state.presetPath, setStatus);
    setStatus("Analisando níveis de áudio…");
    const wav = silence.parseWav(buffer);
    state.levels = silence.computeLevels(wav, 0.01);
    state.sequenceGuid = sequence.guid.toString();
    enableSections(true);
    recompute();
    setStatus(`Sequência "${sequence.name}" analisada (${fmtTime(wav.duration)}).`);
  } catch (err) {
    setStatus(String(err.message || err), true);
  } finally {
    setBusy(false);
  }
}

function autoThreshold() {
  if (!state.levels) return;
  const t = Math.min(-10, Math.max(-70, silence.suggestThreshold(state.levels)));
  $("threshold").value = String(t);
  updateLabels();
  recompute();
}

/* ---------------- aplicar ---------------- */

async function apply() {
  if (state.busy || state.silences.length === 0) {
    if (state.silences.length === 0) setStatus("Nenhum silêncio para cortar com esses ajustes.");
    return;
  }
  setBusy(true);
  try {
    let { project, sequence } = await premiere.getActiveContext();
    if (sequence.guid.toString() !== state.sequenceGuid) {
      throw new Error("A sequência ativa mudou desde a análise. Analise de novo.");
    }

    const mode = $("mode").value;
    if ($("useCopy").checked && mode !== "mark") {
      setStatus("Duplicando sequência…");
      sequence = await premiere.duplicateSequence(project, sequence);
    }

    setStatus("Aplicando cortes…");
    const t0 = Date.now();
    const { done } = await premiere.applySilences(
      project,
      sequence,
      state.silences,
      mode,
      (d, total) => {
        setProgress(d, total);
        setStatus(`Aplicando cortes… ${d}/${total}`);
      }
    );
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    setStatus(`Pronto: ${done} regiões processadas em ${secs}s.`);
    // Os tempos mudaram (no modo remover); força nova análise antes de reaplicar.
    if (mode === "remove") {
      state.levels = null;
      state.silences = [];
      enableSections(false);
    }
  } catch (err) {
    setStatus(String(err.message || err), true);
  } finally {
    setBusy(false);
    setTimeout(() => setProgress(0, 0), 1500);
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

for (const id of Object.keys(sliders)) {
  $(id).addEventListener("input", () => {
    updateLabels();
    recompute();
  });
}

$("btnPreset").addEventListener("click", choosePreset);
$("btnAnalyze").addEventListener("click", analyze);
$("btnAuto").addEventListener("click", autoThreshold);
$("btnApply").addEventListener("click", apply);

try {
  state.presetPath = localStorage.getItem(PRESET_KEY);
} catch {
  state.presetPath = null;
}
showPreset();
updateLabels();
