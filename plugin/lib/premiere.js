/**
 * Tudo que fala com o Premiere Pro (API UXP) fica neste arquivo.
 *
 * Referências:
 *   https://developer.adobe.com/premiere-pro/uxp/ppro-reference/
 *   https://github.com/AdobeDocs/uxp-premiere-pro-samples (sequenceEditor.ts)
 *
 * Observação: createRazorAllTracksAction só existe a partir do Premiere 27.1
 * e ainda não aparece na documentação tipada; a assinatura usada aqui segue
 * a amostra oficial da Adobe.
 */

const ppro = require("premierepro");
const uxp = require("uxp");
const fs = require("fs");

const EPS = 0.002; // tolerância (s) ao comparar tempos de clipes

/* ------------------------------------------------------------------ */
/* Contexto                                                           */
/* ------------------------------------------------------------------ */

async function getActiveContext() {
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("Nenhum projeto aberto.");
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("Nenhuma sequência ativa. Abra uma sequência na timeline.");
  return { project, sequence };
}

function hasRazorSupport(sequence) {
  const editor = ppro.SequenceEditor.getEditor(sequence);
  return typeof editor.createRazorAllTracksAction === "function";
}

/* ------------------------------------------------------------------ */
/* Exportação do áudio                                                */
/* ------------------------------------------------------------------ */

function joinPath(folder, name) {
  const sep = folder.includes("\\") ? "\\" : "/";
  return folder.endsWith(sep) ? folder + name : folder + sep + name;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fileSize(path) {
  try {
    const st = await fs.lstat(path);
    return st.size;
  } catch {
    return -1;
  }
}

/** Espera o arquivo existir e parar de crescer (o encoder escreve aos poucos). */
async function waitForFile(path, timeoutMs = 10 * 60 * 1000) {
  const t0 = Date.now();
  let last = -1;
  let stableCount = 0;
  while (Date.now() - t0 < timeoutMs) {
    const size = await fileSize(path);
    if (size > 44 && size === last) {
      if (++stableCount >= 3) return;
    } else {
      stableCount = 0;
    }
    last = size;
    await sleep(400);
  }
  throw new Error("Tempo esgotado esperando a exportação do áudio.");
}

/**
 * Exporta o áudio da sequência inteira como WAV, usando o preset (.epr)
 * escolhido pelo usuário, e devolve o conteúdo como ArrayBuffer.
 * Trilhas mutadas não entram na exportação, o que é útil para ignorar música.
 */
async function exportSequenceAudio(sequence, presetPath, onStatus = () => {}) {
  if (!presetPath) throw new Error("Escolha um preset de exportação WAV (.epr).");

  const temp = await uxp.storage.localFileSystem.getTemporaryFolder();
  let ext = "wav";
  try {
    const e = await ppro.EncoderManager.getExportFileExtension(sequence, presetPath);
    if (e) ext = String(e).replace(/^\./, "");
  } catch {
    /* mantém wav */
  }
  if (ext.toLowerCase() !== "wav") {
    throw new Error(`O preset escolhido gera ".${ext}". Use um preset de Waveform Audio (.wav).`);
  }

  const outPath = joinPath(temp.nativePath, `decupa_${Date.now()}.wav`);
  onStatus("Exportando áudio da sequência…");

  const encoder = ppro.EncoderManager.getManager();
  const ok = await encoder.exportSequence(
    sequence,
    ppro.Constants.ExportType.IMMEDIATELY,
    outPath,
    presetPath,
    true // sequência inteira (ignora in/out)
  );
  if (ok === false) throw new Error("O Premiere recusou a exportação do áudio.");

  await waitForFile(outPath);
  onStatus("Lendo áudio…");
  const data = await fs.readFile(outPath);
  fs.unlink(outPath).catch(() => {});
  return data;
}

/* ------------------------------------------------------------------ */
/* Leitura da timeline                                                */
/* ------------------------------------------------------------------ */

async function getAllTracks(sequence) {
  const tracks = [];
  const vCount = await sequence.getVideoTrackCount();
  for (let i = 0; i < vCount; i++) tracks.push(await sequence.getVideoTrack(i));
  const aCount = await sequence.getAudioTrackCount();
  for (let i = 0; i < aCount; i++) tracks.push(await sequence.getAudioTrack(i));
  return tracks;
}

/** Clipes (de todas as trilhas) que ficam inteiramente dentro de [start, end]. */
async function getClipsInside(tracks, start, end) {
  const result = [];
  for (const track of tracks) {
    const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
    for (const item of items) {
      const s = (await item.getStartTime()).seconds;
      const e = (await item.getEndTime()).seconds;
      if (s >= start - EPS && e <= end + EPS) result.push(item);
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Edição                                                             */
/* ------------------------------------------------------------------ */

function runTransaction(project, label, build) {
  let ok = false;
  project.lockedAccess(() => {
    ok = project.executeTransaction((compound) => {
      for (const action of build()) compound.addAction(action);
    }, label);
  });
  return ok;
}

async function getFrameRate(sequence) {
  const settings = await sequence.getSettings();
  return await settings.getVideoFrameRate();
}

function tick(seconds, frameRate) {
  const t = ppro.TickTime.createWithSeconds(seconds);
  return frameRate ? t.alignToNearestFrame(frameRate) : t;
}

/** Corta todas as trilhas (vídeo e áudio) num instante da timeline. */
function razorAt(project, sequence, time) {
  const editor = ppro.SequenceEditor.getEditor(sequence);
  const { VIDEO, AUDIO } = ppro.Constants.MediaType;
  return runTransaction(project, "Decupa: cortar", () => [
    editor.createRazorAllTracksAction(VIDEO, time, VIDEO),
    editor.createRazorAllTracksAction(AUDIO, time, VIDEO),
  ]);
}

/** Duplica a sequência ativa e torna a cópia ativa. Retorna a cópia. */
async function duplicateSequence(project, sequence) {
  const before = new Set((await project.getSequences()).map((s) => s.guid.toString()));
  runTransaction(project, "Decupa: duplicar sequência", () => [sequence.createCloneAction()]);
  const after = await project.getSequences();
  const clone = after.find((s) => !before.has(s.guid.toString()));
  if (!clone) throw new Error("Não foi possível encontrar a sequência duplicada.");
  await project.openSequence(clone);
  await project.setActiveSequence(clone);
  return clone;
}

/**
 * Aplica as regiões de silêncio à sequência.
 *
 * mode:
 *   "remove"  - corta e remove com ripple (fecha os buracos)
 *   "disable" - corta e desativa os trechos (nada se move)
 *   "mark"    - só adiciona marcadores nas regiões
 *
 * As regiões são processadas do fim para o começo: assim, remover um trecho
 * não desloca os tempos das regiões que ainda faltam.
 */
async function applySilences(project, sequence, silences, mode, onProgress = () => {}) {
  if (silences.length === 0) return { done: 0 };
  const frameRate = await getFrameRate(sequence).catch(() => null);

  if (mode === "mark") {
    const markers = await ppro.Markers.getMarkers(sequence);
    runTransaction(project, "Decupa: marcar silêncios", () =>
      silences.map((r, i) =>
        markers.createAddMarkerAction(
          `Silêncio ${i + 1}`,
          ppro.Marker.MARKER_TYPE_COMMENT,
          tick(r.start, frameRate),
          ppro.TickTime.createWithSeconds(r.end - r.start),
          "Decupa"
        )
      )
    );
    onProgress(silences.length, silences.length);
    return { done: silences.length };
  }

  if (!hasRazorSupport(sequence)) {
    throw new Error(
      "Esta versão do Premiere não tem a API de corte (razor). Atualize para a 27.1+ ou use o modo \"Só marcar\"."
    );
  }

  const editor = ppro.SequenceEditor.getEditor(sequence);
  const tracks = await getAllTracks(sequence);
  const ordered = [...silences].sort((a, b) => b.start - a.start);
  let done = 0;

  for (const region of ordered) {
    const tStart = tick(region.start, frameRate);
    const tEnd = tick(region.end, frameRate);
    if (tEnd.seconds - tStart.seconds < EPS) continue;

    // Corta primeiro no fim, depois no início da região.
    razorAt(project, sequence, tEnd);
    razorAt(project, sequence, tStart);

    const pieces = await getClipsInside(tracks, tStart.seconds, tEnd.seconds);
    if (pieces.length > 0) {
      if (mode === "remove") {
        project.lockedAccess(() => {
          project.executeTransaction((compound) => {
            ppro.TrackItemSelection.createEmptySelection((selection) => {
              for (const p of pieces) selection.addItem(p, true);
              compound.addAction(
                editor.createRemoveItemsAction(
                  selection,
                  true, // ripple
                  ppro.Constants.MediaType.VIDEO,
                  false
                )
              );
            });
          }, "Decupa: remover silêncio");
        });
      } else if (mode === "disable") {
        runTransaction(project, "Decupa: desativar silêncio", () =>
          pieces.map((p) => p.createSetDisabledAction(true))
        );
      }
    }

    done++;
    onProgress(done, ordered.length);
    // Devolve o controle à UI para o painel não congelar.
    await sleep(0);
  }
  return { done };
}

module.exports = {
  getActiveContext,
  hasRazorSupport,
  exportSequenceAudio,
  duplicateSequence,
  applySilences,
};
