/**
 * Painel do Decupa: liga a interface ao núcleo de detecção e à API do Premiere.
 *
 * Fluxo: o painel acompanha o clipe selecionado na timeline; o botão
 * "Decupar" exporta só o áudio desse clipe, detecta os silêncios dentro
 * dele e aplica os cortes (vídeo e áudio juntos).
 */

const uxp = require("uxp");
const silence = require("./lib/silence.js");
const premiere = require("./lib/premiere.js");

const $ = (id) => document.getElementById(id);
const PRESET_KEY = "decupa.presetPath";

const state = {
  presetPath: null,
  clip: null, // clipe de áudio selecionado na timeline (ou null)
  razor: null, // o Premiere tem a API de corte? (null = ainda não sabemos)
  busy: false,
  refreshing: false,
  refreshAgain: false,
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

// O botão só trava enquanto trabalha: sem clipe selecionado, o clique
// explica o que fazer em vez de deixar o botão morto.
function updateButtons() {
  $("btnRun").disabled = state.busy;
  $("btnPreset").disabled = state.busy;
}

function setBusy(busy) {
  state.busy = busy;
  updateButtons();
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

/* ---------------- clipe selecionado ---------------- */

function showClip() {
  const clip = state.clip;
  $("clipBox").className = clip ? "clip" : "clip empty";
  $("clipName").textContent = clip ? clip.name || "Clipe sem nome" : "Selecione um clipe na timeline";
  $("clipInfo").textContent = clip
    ? `${fmtTime(clip.start)} – ${fmtTime(clip.end)}` + (clip.clips > 1 ? ` · ${clip.clips} clipes` : "")
    : "";
  updateButtons();
}

/** Relê a seleção da timeline. Chamadas seguidas viram uma só releitura extra. */
async function refreshSelection() {
  if (state.busy) return; // os próprios cortes mexem na seleção; relê no fim
  if (state.refreshing) {
    state.refreshAgain = true;
    return;
  }
  state.refreshing = true;
  try {
    do {
      state.refreshAgain = false;
      try {
        const { sequence } = await premiere.getActiveContext();
        state.clip = await premiere.getSelectedAudio(sequence);
        showRazorSupport(premiere.hasRazorSupport(sequence));
      } catch {
        state.clip = null;
      }
      showClip();
    } while (state.refreshAgain);
  } finally {
    state.refreshing = false;
  }
}

/** Sem a API de corte, avisa no painel e troca a ação para "Só marcar" (uma vez). */
function showRazorSupport(supported) {
  const first = state.razor === null;
  state.razor = supported;
  const hint = $("modeHint");
  if (supported) {
    hint.className = "hint warn hidden";
    return;
  }
  hint.textContent = premiere.razorUnsupportedMessage();
  hint.className = "hint warn";
  if (first) $("mode").value = "mark";
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

const DONE_VERB = { remove: "cortados", disable: "desativados", mark: "marcados" };

async function run() {
  if (state.busy) return;
  setBusy(true);
  setProgress(0, 0);
  $("result").className = "hidden";
  try {
    let { project, sequence } = await premiere.getActiveContext();
    const clip = await premiere.getSelectedAudio(sequence);
    if (!clip) throw new Error("Selecione um clipe na timeline e clique de novo.");

    // Confere a API de corte antes de exportar ou duplicar qualquer coisa.
    const mode = $("mode").value;
    if (mode !== "mark" && !premiere.hasRazorSupport(sequence)) {
      throw new Error(premiere.razorUnsupportedMessage());
    }

    const buffer = await premiere.exportSequenceAudio(
      sequence,
      state.presetPath,
      setStatus,
      clip.trackIndices
    );
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

    const onCopy = $("useCopy").checked && mode !== "mark";
    if (onCopy) {
      setStatus("Duplicando sequência…");
      sequence = await premiere.duplicateSequence(project, sequence);
    }

    setStatus("Aplicando cortes…");
    const t0 = Date.now();
    const { done } = await premiere.applySilences(project, sequence, silences, mode, (d, total) => {
      setProgress(d, total);
      setStatus(`Aplicando cortes… ${d}/${total}`);
    });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    setStatus(
      `Pronto: ${done} silêncios ${DONE_VERB[mode]} em ${secs}s.` +
        (onCopy ? ` A cópia "${sequence.name}" está aberta; selecione o clipe nela para decupar de novo.` : "")
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

// Os eventos de seleção deixam o painel em dia na hora; a releitura periódica
// cobre versões do Premiere em que eles não chegam (com seleção vazia ela é barata).
premiere.onSelectionChange(refreshSelection);
setInterval(refreshSelection, 1500);

try {
  state.presetPath = localStorage.getItem(PRESET_KEY);
} catch {
  state.presetPath = null;
}
showPreset();
updateLabels();
updateThresholdMode();
refreshSelection();
