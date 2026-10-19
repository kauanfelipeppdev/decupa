/**
 * Decupa (versão CEP): tudo que roda dentro do Premiere, em ExtendScript.
 *
 * ExtendScript é ES3: sem JSON nativo, sem Array.prototype.indexOf, sem let/const.
 * Cada função pública devolve uma string JSON: {"ok":true,"data":...} ou
 * {"ok":false,"error":"..."}; o painel (main.js) faz o parse.
 *
 * O corte usa o QE DOM (app.enableQE / qe.project), API interna e não
 * documentada do Premiere que tem razor por trilha. É o que permite cortar em
 * versões sem a API de razor do UXP (anteriores à 27.1).
 */

var DECUPA_TICKS_PER_SECOND = 254016000000;

/* ------------------------------------------------------------------ */
/* JSON mínimo                                                         */
/* ------------------------------------------------------------------ */

function decupa_json(v) {
  if (v === null || v === undefined) return "null";
  var t = typeof v;
  if (t === "number") return isFinite(v) ? String(v) : "null";
  if (t === "boolean") return v ? "true" : "false";
  if (t === "string") {
    return (
      '"' +
      v
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t") +
      '"'
    );
  }
  var parts = [];
  if (v instanceof Array) {
    for (var i = 0; i < v.length; i++) parts.push(decupa_json(v[i]));
    return "[" + parts.join(",") + "]";
  }
  for (var k in v) {
    if (v.hasOwnProperty(k)) parts.push(decupa_json(k) + ":" + decupa_json(v[k]));
  }
  return "{" + parts.join(",") + "}";
}

function decupa_ok(data) {
  return decupa_json({ ok: true, data: data === undefined ? null : data });
}

function decupa_err(e) {
  var msg = e && e.message ? e.message : String(e);
  return decupa_json({ ok: false, error: msg });
}

/* ------------------------------------------------------------------ */
/* Informações e seleção                                               */
/* ------------------------------------------------------------------ */

function decupa_hostInfo() {
  try {
    return decupa_ok({ version: String(app.version), build: String(app.build) });
  } catch (e) {
    return decupa_err(e);
  }
}

/**
 * Clipes de áudio selecionados na sequência ativa: intervalo coberto e
 * trilhas de áudio onde estão. data = null quando não há nenhum.
 */
function decupa_getSelection() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return decupa_ok(null);
    // Atalho barato: seleção vazia não exige varrer as trilhas.
    if (seq.getSelection && seq.getSelection().length === 0) return decupa_ok(null);

    var trackIndices = [];
    var start = null;
    var end = null;
    var name = null;
    var clips = 0;
    for (var i = 0; i < seq.audioTracks.numTracks; i++) {
      var track = seq.audioTracks[i];
      var used = false;
      for (var j = 0; j < track.clips.numItems; j++) {
        var clip = track.clips[j];
        if (!clip.isSelected()) continue;
        if (start === null || clip.start.seconds < start) start = clip.start.seconds;
        if (end === null || clip.end.seconds > end) end = clip.end.seconds;
        if (name === null) name = clip.name;
        clips++;
        used = true;
      }
      if (used) trackIndices.push(i);
    }
    if (clips === 0) return decupa_ok(null);
    return decupa_ok({
      sequenceId: String(seq.sequenceID),
      sequenceName: seq.name,
      name: name,
      clips: clips,
      start: start,
      end: end,
      trackIndices: trackIndices
    });
  } catch (e) {
    return decupa_err(e);
  }
}

/* ------------------------------------------------------------------ */
/* Exportação do áudio                                                 */
/* ------------------------------------------------------------------ */

/**
 * Exporta o áudio da sequência ativa como WAV com o preset escolhido e
 * devolve o caminho do arquivo. Só as trilhas de áudio em keepCsv (ex.: "0,2")
 * ficam audíveis; as outras são mutadas durante a exportação e voltam ao
 * estado original depois.
 *
 * O WAV vai para <AppData>/Decupa com caminho nativo (fsName): a exportação
 * do Premiere falha com "Unknown Error" em caminhos curtos do Windows
 * (C:\Users\NOME~1\...), que é o que a pasta temporária usa quando o nome
 * do usuário tem espaço.
 */
function decupa_exportAudio(presetPath, keepCsv) {
  var seq = app.project.activeSequence;
  if (!seq) return decupa_err("Nenhuma sequência ativa.");

  var preset = new File(presetPath);
  if (!preset.exists) return decupa_err("Preset não encontrado: " + presetPath);

  var folder = new Folder(Folder.userData.fsName + "/Decupa");
  if (!folder.exists) folder.create();
  var outPath = new File(folder.fsName + "/decupa_" + new Date().getTime() + ".wav").fsName;

  var keep = {};
  var ids = String(keepCsv || "").split(",");
  for (var k = 0; k < ids.length; k++) if (ids[k] !== "") keep[Number(ids[k])] = true;

  var changed = [];
  var result;
  try {
    for (var i = 0; i < seq.audioTracks.numTracks; i++) {
      var track = seq.audioTracks[i];
      var wasMuted = !!track.isMuted();
      var mute = !keep[i];
      if (wasMuted !== mute) {
        track.setMute(mute ? 1 : 0);
        changed.push([track, wasMuted]);
      }
    }
    result = seq.exportAsMediaDirect(outPath, preset.fsName, app.encoder.ENCODE_ENTIRE);
  } catch (e) {
    return decupa_err(e);
  } finally {
    for (var r = 0; r < changed.length; r++) {
      try {
        changed[r][0].setMute(changed[r][1] ? 1 : 0);
      } catch (ignore) {}
    }
  }

  var file = new File(outPath);
  if (!file.exists) {
    return decupa_err(
      "O Premiere não gerou o arquivo de áudio." + (result ? " (" + result + ")" : "") +
        " Confira se o preset é de Waveform Audio (.wav). Saída: " + outPath +
        " | Preset: " + preset.fsName
    );
  }
  return decupa_ok({ path: outPath });
}

/* ------------------------------------------------------------------ */
/* Cópia da sequência                                                  */
/* ------------------------------------------------------------------ */

/** Duplica a sequência ativa e torna a cópia ativa. */
function decupa_duplicate() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return decupa_err("Nenhuma sequência ativa.");
    var before = {};
    for (var i = 0; i < app.project.sequences.numSequences; i++) {
      before[String(app.project.sequences[i].sequenceID)] = true;
    }
    seq.clone();
    for (var j = 0; j < app.project.sequences.numSequences; j++) {
      var s = app.project.sequences[j];
      var id = String(s.sequenceID);
      if (before[id]) continue;
      app.project.openSequence(id);
      if (String(app.project.activeSequence.sequenceID) !== id) app.project.activeSequence = s;
      return decupa_ok({ sequenceId: id, name: s.name });
    }
    return decupa_err("Não foi possível encontrar a sequência duplicada.");
  } catch (e) {
    return decupa_err(e);
  }
}

/* ------------------------------------------------------------------ */
/* Edição                                                              */
/* ------------------------------------------------------------------ */

function decupa_seconds(time) {
  if (typeof time === "number") return time;
  if (time && time.seconds !== undefined) return time.seconds;
  return Number(time) / DECUPA_TICKS_PER_SECOND; // string de ticks (seq.end)
}

/** Timecode no formato da sequência, que é o que o razor do QE espera. */
function decupa_timecode(seconds, frameRate, displayFormat) {
  var t = new Time();
  t.seconds = seconds;
  return t.getFormatted(frameRate, displayFormat);
}

/** Corta todas as trilhas (vídeo e áudio) num instante, via QE DOM. */
function decupa_razorAll(qeSeq, seconds, frameRate, displayFormat) {
  var tc = decupa_timecode(seconds, frameRate, displayFormat);
  var i;
  for (i = 0; i < qeSeq.numVideoTracks; i++) qeSeq.getVideoTrackAt(i).razor(tc);
  for (i = 0; i < qeSeq.numAudioTracks; i++) qeSeq.getAudioTrackAt(i).razor(tc);
}

/** Clipes de todas as trilhas que ficam inteiramente dentro de [start, end]. */
function decupa_clipsInside(seq, start, end, eps) {
  var result = [];
  var groups = [seq.videoTracks, seq.audioTracks];
  for (var g = 0; g < groups.length; g++) {
    for (var i = 0; i < groups[g].numTracks; i++) {
      var clips = groups[g][i].clips;
      for (var j = 0; j < clips.numItems; j++) {
        var c = clips[j];
        if (c.start.seconds >= start - eps && c.end.seconds <= end + eps) result.push(c);
      }
    }
  }
  return result;
}

/**
 * Remove os pedaços de uma região e fecha o buraco.
 * Tira todos menos um sem ripple; com o trecho vazio em todas as trilhas,
 * remover o último com ripple fecha o buraco nelas todas por igual.
 */
function decupa_rippleRemove(pieces) {
  for (var i = 0; i < pieces.length - 1; i++) {
    try {
      pieces[i].remove(false, true);
    } catch (ignore) {
      /* já saiu junto com um clipe vinculado */
    }
  }
  pieces[pieces.length - 1].remove(true, true);
}

/**
 * Aplica regiões de silêncio na sequência ativa.
 *   regionsJson: "[[inicio, fim], ...]" em segundos, do fim para o começo
 *   mode: "remove" | "disable" | "mark"
 *   markOffset: número do primeiro marcador (para lotes)
 * Processar do fim para o começo faz com que remover um trecho não desloque
 * os tempos das regiões que ainda faltam.
 */
function decupa_apply(regionsJson, mode, markOffset) {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return decupa_err("Nenhuma sequência ativa.");
    var regions = eval("(" + regionsJson + ")");
    var done = 0;
    var i;

    if (mode === "mark") {
      for (i = 0; i < regions.length; i++) {
        var marker = seq.markers.createMarker(regions[i][0]);
        marker.name = "Silêncio " + ((markOffset || 0) + i + 1);
        marker.comments = "Decupa";
        marker.end = regions[i][1];
        done++;
      }
      return decupa_ok({ done: done });
    }

    app.enableQE();
    if (typeof qe === "undefined" || !qe.project) {
      return decupa_err("Não foi possível ativar o QE DOM do Premiere, necessário para cortar.");
    }
    var qeSeq = qe.project.getActiveSequence();
    if (!qeSeq) return decupa_err("O QE DOM não encontrou a sequência ativa.");

    var settings = seq.getSettings();
    var frameRate = settings.videoFrameRate;
    var displayFormat = settings.videoDisplayFormat;
    var frame = decupa_seconds(frameRate);

    for (i = 0; i < regions.length; i++) {
      var start = regions[i][0];
      var end = regions[i][1];
      if (end - start < frame) continue;

      // Corta primeiro no fim, depois no início da região.
      decupa_razorAll(qeSeq, end, frameRate, displayFormat);
      decupa_razorAll(qeSeq, start, frameRate, displayFormat);

      var pieces = decupa_clipsInside(seq, start, end, frame);
      if (pieces.length > 0) {
        if (mode === "disable") {
          for (var p = 0; p < pieces.length; p++) pieces[p].disabled = true;
        } else {
          var before = decupa_seconds(seq.end);
          decupa_rippleRemove(pieces);
          var removed = before - decupa_seconds(seq.end);
          // Trava de segurança: se o ripple não fechou o buraco, para tudo
          // antes de dessincronizar o resto da timeline.
          if (removed < frame / 2) {
            return decupa_err(
              "O Premiere não fechou o buraco do silêncio em " +
                decupa_timecode(start, frameRate, displayFormat) +
                ". Parei para não dessincronizar a timeline (" + done + " silêncios já removidos)."
            );
          }
        }
      }
      done++;
    }
    return decupa_ok({ done: done });
  } catch (e) {
    return decupa_err(e);
  }
}
