(function () {
  "use strict";

  var STORAGE_KEY = "acme_liquidacion_pesaje_v1";
  var saveTimer = null;
  /** URL del último PDF generado (para ver en pestaña nueva; se revoca al generar otro). */
  var lastPdfObjectUrl = null;
  /** Evita encadenar modales si se mantiene el tope violado al tipear. */
  var pesoCapSwalLastTs = 0;

  var Toast = typeof Swal !== "undefined" && Swal.mixin
    ? Swal.mixin({
        toast: true,
        position: "top-end",
        showConfirmButton: false,
        timer: 2800,
        timerProgressBar: true,
      })
    : null;

  function toast(msg, icon) {
    if (Toast) Toast.fire({ icon: icon || "success", title: msg });
  }

  function shareLastPdfWhatsApp(blob, fname) {
    var online = typeof navigator === "undefined" || navigator.onLine !== false;
    var file = new File([blob], fname, { type: "application/pdf" });

    function tryOpenWhatsAppLink() {
      if (!online) {
        if (typeof Swal !== "undefined") {
          Swal.fire({
            icon: "info",
            title: "Sin conexión",
            html:
              "Para abrir <strong>WhatsApp</strong> hace falta internet o datos móviles.<br/><br/>Use <strong>Ver PDF</strong> o <strong>Descargar</strong> en el cuadro anterior. Cuando tenga señal podrá compartir por WhatsApp.",
            confirmButtonText: "Entendido",
          });
        } else {
          toast(
            "Sin conexión: el PDF está guardado. WhatsApp requiere datos cuando tenga señal.",
            "info"
          );
        }
        return;
      }
      window.open(
        "https://wa.me/?text=" + encodeURIComponent(fname),
        "_blank",
        "noopener,noreferrer"
      );
    }

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator
        .share({
          files: [file],
          title: fname,
        })
        .catch(function () {
          tryOpenWhatsAppLink();
        });
    } else {
      tryOpenWhatsAppLink();
    }
  }

  function alertErr(title, text) {
    if (typeof Swal !== "undefined") {
      Swal.fire({
        icon: "error",
        title: title,
        text: text || "",
        confirmButtonText: "Entendido",
      });
    } else {
      window.alert(title + (text ? "\n" + text : ""));
    }
  }

  function refreshIcons() {
    if (window.lucide && typeof lucide.createIcons === "function") {
      lucide.createIcons();
    }
  }

  var els = {
    form: document.getElementById("liquidacion-form"),
    tbody: document.getElementById("pesos-body"),
    addBtn: document.getElementById("add-row"),
    tpl: document.getElementById("row-template"),
    lote: document.getElementById("lote"),
    fecha: document.getElementById("fecha"),
    supervisor: document.getElementById("supervisor"),
    merma: document.getElementById("merma"),
    humedad: document.getElementById("humedad"),
    pesoTotal: document.getElementById("peso-total"),
    pesoNeto: document.getElementById("peso-neto"),
    pesoSeco: document.getElementById("peso-seco"),
    precio: document.getElementById("precio"),
    pagoTotal: document.getElementById("pago-total"),
    btnPdf: document.getElementById("btn-pdf"),
    btnClear: document.getElementById("btn-clear"),
    liqLotDisplay: document.getElementById("liq-lot-display"),
    pvLote: document.getElementById("pv-lote"),
    pvFecha: document.getElementById("pv-fecha"),
    pvSupervisor: document.getElementById("pv-supervisor"),
    pvPesos: document.getElementById("pv-pesos"),
    pvBigbagVal: document.getElementById("pv-bigbag-val"),
    pvTotal: document.getElementById("pv-total"),
    pvMerma: document.getElementById("pv-merma"),
    pvNeto: document.getElementById("pv-neto"),
    pvHumedad: document.getElementById("pv-humedad"),
    pvSeco: document.getElementById("pv-seco"),
    pvPrecio: document.getElementById("pv-precio"),
    pvPago: document.getElementById("pv-pago"),
    partTwo: document.querySelector(".part-two"),
    partTwoToggle: document.getElementById("part-two-toggle"),
  };

  function num(v) {
    var n = parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Separa parte entera y decimal mientras se escribe (miles con punto, decimal con coma o con último punto).
   * maxDecimals: 3 para TM, 2 para USD / humedad.
   */
  function splitEsPeNumberString(str, maxDecimals) {
    maxDecimals = maxDecimals == null ? 3 : maxDecimals;
    str = String(str == null ? "" : str).trim().replace(/\s/g, "");
    if (!str) return { intDigits: "", decDigits: "", neg: false };
    var neg = false;
    if (str.charAt(0) === "-") {
      neg = true;
      str = str.slice(1).trim();
    }
    if (!str) return { intDigits: "", decDigits: "", neg: neg };

    if (str.indexOf(",") >= 0) {
      var onlyCommaDigits = str.replace(/[^\d,]/g, "");
      // Excel / inglés: 1,000 · 12,345 · 1,234,567 (grupos de 3; no confundir con 14,55)
      if (/^\d{1,3}(,\d{3})*$/.test(onlyCommaDigits)) {
        return {
          intDigits: onlyCommaDigits.replace(/,/g, ""),
          decDigits: "",
          neg: neg,
        };
      }
      var li = str.lastIndexOf(",");
      var left = str.slice(0, li);
      var right = str.slice(li + 1).replace(/[^\d]/g, "").slice(0, maxDecimals);
      var intDigits = left.replace(/\./g, "").replace(/[^\d]/g, "");
      return { intDigits: intDigits, decDigits: right, neg: neg };
    }

    var lastDot = str.lastIndexOf(".");
    if (lastDot < 0) {
      return {
        intDigits: str.replace(/\./g, "").replace(/[^\d]/g, ""),
        decDigits: "",
        neg: neg,
      };
    }

    var after = str.slice(lastDot + 1).replace(/[^\d]/g, "");
    var before = str.slice(0, lastDot);
    var beforeDotCount = (before.match(/\./g) || []).length;

    var isDecimal = false;
    if (after.length > 0 && after.length <= maxDecimals) {
      if (after.length < 3) isDecimal = true;
      else if (after.length === 3 && beforeDotCount >= 1) isDecimal = true;
      else if (after.length === 3 && beforeDotCount === 0) isDecimal = false;
    } else if (after.length === 0 && beforeDotCount >= 1) {
      isDecimal = true;
    }

    if (isDecimal) {
      var intDigits = before.replace(/\./g, "").replace(/[^\d]/g, "");
      return { intDigits: intDigits, decDigits: after.slice(0, maxDecimals), neg: neg };
    }

    var all = str.replace(/\./g, "").replace(/[^\d]/g, "");
    return { intDigits: all, decDigits: "", neg: neg };
  }

  function parseEsPeNumber(str, maxDecimals) {
    maxDecimals = maxDecimals == null ? 3 : maxDecimals;
    var p = splitEsPeNumberString(str, maxDecimals);
    if (!p.intDigits && !p.decDigits) return 0;
    var sign = p.neg ? -1 : 1;
    var intPart = parseInt(p.intDigits || "0", 10);
    if (!p.decDigits) return sign * intPart;
    var decNum = parseInt(p.decDigits, 10) / Math.pow(10, p.decDigits.length);
    return sign * (intPart + decNum);
  }

  function groupThousandsDigits(digits) {
    if (!digits) return "";
    var s = digits.replace(/\D/g, "");
    if (!s) return "";
    s = s.replace(/^0+(?=\d)/, "") || "0";
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  function maxDecimalsForField(el) {
    if (!el) return 3;
    if (el.id === "precio" || el.id === "humedad") return 2;
    return 3;
  }

  /** Formato en vivo: 100 → 100; 1000 → 1.000; 1.000.30 o 1.000,30 → decimales con coma */
  function formatLocaleInputLive(el) {
    if (!el || el.readOnly || !isLocaleNumericField(el)) return;
    var maxDec = maxDecimalsForField(el);
    var trimmed = String(el.value).trim().replace(/\s/g, "");
    if (!trimmed) {
      el.value = "";
      return;
    }

    if (/^\d+\.$/.test(trimmed)) {
      el.value = groupThousandsDigits(trimmed.slice(0, -1)) + ",";
      return;
    }

    var endsWithCommaOnly = /,$/.test(trimmed);
    var parts = splitEsPeNumberString(trimmed, maxDec);
    var intF = parts.intDigits ? groupThousandsDigits(parts.intDigits) : "";

    if (!intF && !parts.decDigits && !endsWithCommaOnly) {
      el.value = "";
      return;
    }
    if (!intF && parts.decDigits) intF = "0";

    if (endsWithCommaOnly && parts.decDigits === "") {
      el.value = intF + ",";
      return;
    }

    var lastDot = trimmed.lastIndexOf(".");
    var trailingDotDecimal =
      lastDot >= 0 &&
      trimmed.slice(lastDot + 1) === "" &&
      (trimmed.slice(0, lastDot).match(/\./g) || []).length >= 1;
    if (trailingDotDecimal && parts.decDigits === "") {
      el.value = intF + ",";
      return;
    }

    if (parts.decDigits) {
      el.value = intF + "," + parts.decDigits;
      return;
    }

    el.value = intF;
  }

  function isLocaleNumericField(el) {
    if (!el || !el.matches) return false;
    return el.matches(".peso-input, #peso-total, #merma, #peso-neto, #humedad, #peso-seco, #precio");
  }

  function blurFormatLocaleField(el) {
    if (!el || el.readOnly) return;
    if (!isLocaleNumericField(el)) return;
    var raw = String(el.value).trim();
    if (raw === "") return;
    var md = maxDecimalsForField(el);
    var n = parseEsPeNumber(raw, md);
    if (
      el.classList.contains("peso-input") ||
      el.id === "peso-total" ||
      el.id === "merma" ||
      el.id === "peso-neto" ||
      el.id === "peso-seco"
    ) {
      el.value = fmtTMFlex(n);
      return;
    }
    if (el.id === "humedad") {
      el.value = fmtUsd(Math.min(100, Math.max(0, n)));
      return;
    }
    if (el.id === "precio") {
      el.value = fmtUsd(Math.max(0, n));
    }
  }

  function formatAllLocaleFields() {
    if (els.tbody) {
      var pins = els.tbody.querySelectorAll(".peso-input");
      for (var i = 0; i < pins.length; i++) {
        if (String(pins[i].value).trim()) blurFormatLocaleField(pins[i]);
      }
    }
    ["peso-total", "merma", "peso-neto", "humedad", "peso-seco", "precio"].forEach(function (id) {
      var e = document.getElementById(id);
      if (e && String(e.value).trim()) blurFormatLocaleField(e);
    });
  }

  function triggerPdfDownload(url, fname) {
    if (!url) return;
    var a = document.createElement("a");
    a.href = url;
    a.download = fname;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function fmtTM(n, d) {
    d = d === undefined ? 3 : d;
    return num(n).toLocaleString("es-PE", {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }

  /** TM para pantalla/PDF: hasta 3 decimales, sin ceros de más a la derecha */
  function fmtTMFlex(n) {
    var x = Math.round(num(n) * 1000) / 1000;
    return x.toLocaleString("es-PE", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    });
  }

  function fmtUsd(n) {
    return num(n).toLocaleString("es-PE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function fmtUsdInput(n) {
    return num(n).toFixed(2);
  }

  function todayIso() {
    var t = new Date();
    var y = t.getFullYear();
    var m = String(t.getMonth() + 1).padStart(2, "0");
    var da = String(t.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + da;
  }

  function formatDisplayDate(iso) {
    if (!iso) return "—";
    var p = iso.split("-");
    if (p.length !== 3) return iso;
    var meses = [
      "ENE",
      "FEB",
      "MAR",
      "ABR",
      "MAY",
      "JUN",
      "JUL",
      "AGO",
      "SEP",
      "OCT",
      "NOV",
      "DIC",
    ];
    var mes = meses[num(p[1]) - 1] || p[1];
    return String(num(p[2])) + "-" + mes + "-" + String(p[0]).slice(-2);
  }

  function getSheetMaxDay(iso) {
    // La plantilla del formato llega hasta 30 celdas (1..30).
    var fallback = 30;
    if (!iso) return fallback;
    var p = iso.split("-");
    if (p.length !== 3) return fallback;
    var y = num(p[0]);
    var m = num(p[1]);
    if (!y || !m) return fallback;
    var dim = new Date(y, m, 0).getDate();
    return Math.max(1, Math.min(30, dim));
  }

  function hasCjkChars(text) {
    return /[\u3400-\u9fff\uf900-\ufaff]/.test(String(text || ""));
  }

  function drawPdfText(doc, text, x, y, opts) {
    var value = String(text == null ? "" : text);
    if (!value) return;
    var options = opts || {};
    var align = options.align || "left";
    var fontSizePt = options.fontSize || 12;
    var bold = !!options.bold;
    var color = options.color || [0, 0, 0];
    var valign = options.valign || "baseline";

    doc.setTextColor(color[0], color[1], color[2]);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(fontSizePt);

    var ptToMm = 25.4 / 72;
    var lineMm = fontSizePt * ptToMm;

    if (!hasCjkChars(value)) {
      var yLatin = y;
      if (valign === "middle") {
        yLatin = y + lineMm * 0.35;
      }
      doc.text(value, x, yLatin, { align: align });
      return;
    }

    var canvas = document.createElement("canvas");
    var ctx = canvas.getContext("2d");
    if (!ctx) {
      doc.text(value, x, valign === "middle" ? y + lineMm * 0.35 : y, { align: align });
      return;
    }

    var px = Math.max(10, Math.round(fontSizePt * 1.45));
    var family = '"Microsoft YaHei","Noto Sans CJK SC","SimHei","Arial Unicode MS",sans-serif';
    var weight = bold ? "700 " : "400 ";
    ctx.font = weight + px + "px " + family;
    var padding = 4;
    var tw = Math.ceil(ctx.measureText(value).width);
    var th = Math.ceil(px * 1.25);
    canvas.width = tw + padding * 2;
    canvas.height = th + padding * 2;

    ctx.font = weight + px + "px " + family;
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgb(" + color[0] + "," + color[1] + "," + color[2] + ")";
    ctx.fillText(value, padding, padding);

    var mmPerPx = 25.4 / 96;
    var wMm = canvas.width * mmPerPx;
    var hMm = canvas.height * mmPerPx;
    var drawX = x;
    if (align === "center") drawX = x - wMm / 2;
    if (align === "right") drawX = x - wMm;
    var drawY = valign === "middle" ? y - hMm / 2 : y - hMm * 0.72;

    doc.addImage(canvas, "PNG", drawX, drawY, wMm, hMm);
  }

  function splitLinesByWidthFallback(str, innerWmm, fontSizePt) {
    var ptToMm = 25.4 / 72;
    var charMm = fontSizePt * ptToMm * 0.52;
    var maxChars = Math.max(4, Math.floor(innerWmm / charMm));
    var words = String(str).replace(/\s+/g, " ").trim().split(" ");
    var lines = [];
    var line = "";
    for (var w = 0; w < words.length; w++) {
      var wd = words[w];
      if (!wd) continue;
      if (wd.length > maxChars) {
        if (line) {
          lines.push(line);
          line = "";
        }
        for (var c = 0; c < wd.length; c += maxChars) {
          lines.push(wd.slice(c, c + maxChars));
        }
        continue;
      }
      var cand = line ? line + " " + wd : wd;
      if (cand.length <= maxChars) line = cand;
      else {
        if (line) lines.push(line);
        line = wd;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [String(str)];
  }

  function drawPdfWrappedInCell(doc, text, cellLeft, cellTop, cellW, cellH, opts) {
    var value = String(text == null ? "" : text);
    if (!value || !(cellW > 0) || !(cellH > 0)) return;
    var options = opts || {};
    var fontSizePt = options.fontSize || 12;
    var bold = !!options.bold;
    var color = options.color || [0, 0, 0];
    var padMm = typeof options.padMm === "number" ? options.padMm : 1.1;
    var yOffsetMm = typeof options.yOffsetMm === "number" ? options.yOffsetMm : 0;
    var innerW = Math.max(5, cellW - padMm * 2);
    doc.setTextColor(color[0], color[1], color[2]);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(fontSizePt);
    var ptToMm = 25.4 / 72;
    var lineStepMm = fontSizePt * ptToMm * 1.18;
    var lines;
    if (!hasCjkChars(value) && typeof doc.splitTextToSize === "function") {
      lines = doc.splitTextToSize(value, innerW);
    } else if (!hasCjkChars(value)) {
      lines = splitLinesByWidthFallback(value, innerW, fontSizePt);
    } else if (hasCjkChars(value)) {
      var cpw = Math.max(2, Math.floor(innerW / (fontSizePt * ptToMm * 0.58)));
      lines = [];
      var rest = value;
      while (rest.length) {
        lines.push(rest.slice(0, cpw));
        rest = rest.slice(cpw);
      }
    } else {
      lines = [value];
    }
    if (!lines.length) return;
    while (lines.length * lineStepMm > cellH - 1 && fontSizePt > 7) {
      fontSizePt -= 0.5;
      doc.setFontSize(fontSizePt);
      lineStepMm = fontSizePt * ptToMm * 1.18;
      if (!hasCjkChars(value)) {
        if (typeof doc.splitTextToSize === "function") {
          lines = doc.splitTextToSize(value, innerW);
        } else {
          lines = splitLinesByWidthFallback(value, innerW, fontSizePt);
        }
      } else break;
    }
    var blockH = lines.length * lineStepMm;
    var yBaseline0 = cellTop + (cellH - blockH) / 2 + fontSizePt * ptToMm * 0.38 + yOffsetMm;
    if (yBaseline0 < cellTop + fontSizePt * ptToMm * 0.42) {
      yBaseline0 = cellTop + fontSizePt * ptToMm * 0.42;
    }
    var cx = cellLeft + cellW / 2;
    for (var i = 0; i < lines.length; i++) {
      var piece = lines[i];
      if (!piece) continue;
      if (hasCjkChars(piece)) {
        drawPdfText(doc, piece, cx, yBaseline0 + i * lineStepMm, {
          align: "center",
          fontSize: fontSizePt,
          bold: bold,
          color: color,
          valign: "middle",
        });
      } else {
        doc.text(piece, cx, yBaseline0 + i * lineStepMm, { align: "center" });
      }
    }
  }

  function getWeights() {
    var inputs = els.tbody.querySelectorAll(".peso-input");
    var out = [];
    for (var i = 0; i < inputs.length; i++) {
      var v = parseEsPeNumber(inputs[i].value, 3);
      if (inputs[i].value !== "" || v !== 0) out.push(v);
      else out.push(null);
    }
    return out;
  }

  function sumWeights(ws) {
    var s = 0;
    for (var i = 0; i < ws.length; i++) if (ws[i] != null) s += ws[i];
    return s;
  }

  function firePesoExceedsCapAlert() {
    var now = Date.now();
    if (now - pesoCapSwalLastTs < 2600) return;
    pesoCapSwalLastTs = now;
    if (typeof Swal !== "undefined") {
      Swal.fire({
        icon: "warning",
        title: "Supera el Peso (TM)",
        text:
          "La suma de los pesajes no puede pasar del valor de Peso (TM) de la liquidación. El valor se ajustó al máximo permitido en esta fila.",
        confirmButtonText: "Entendido",
      });
    } else {
      window.alert("La suma de los pesajes no puede superar el Peso (TM).");
    }
  }

  /** No permitir que la suma de pesajes supere Peso (TM) (#peso-total). */
  function clampPesoInputToTotal(inp) {
    if (!inp || !inp.classList || !inp.classList.contains("peso-input")) return;
    var trimmed = String(inp.value).trim();
    if (trimmed !== "" && parseEsPeNumber(trimmed, 3) < 0) {
      inp.value = "";
      trimmed = "";
    }
    var limitRaw = els.pesoTotal.value.trim();
    if (!limitRaw) return;
    var limit = Math.round(parseEsPeNumber(limitRaw, 3) * 1000) / 1000;
    if (!(limit > 0)) return;
    var inputs = els.tbody.querySelectorAll(".peso-input");
    var sumOthers = 0;
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i] === inp) continue;
      if (inputs[i].value !== "")
        sumOthers += Math.round(parseEsPeNumber(inputs[i].value, 3) * 1000) / 1000;
    }
    var cur =
      inp.value === "" ? 0 : Math.round(parseEsPeNumber(inp.value, 3) * 1000) / 1000;
    var maxAllowed = Math.round((limit - sumOthers) * 1000) / 1000;
    if (maxAllowed < 0) maxAllowed = 0;
    if (cur > maxAllowed + 1e-9) {
      inp.value = maxAllowed > 0 ? fmtTMFlex(maxAllowed) : "";
      firePesoExceedsCapAlert();
    }
  }

  /** Si baja el Peso (TM), recorta filas en orden hasta no superar el tope. */
  function enforceTotalWeightCapFromStart() {
    var limitRaw = els.pesoTotal.value.trim();
    if (!limitRaw) return;
    var limit = Math.round(parseEsPeNumber(limitRaw, 3) * 1000) / 1000;
    if (!(limit > 0)) return;
    var inputs = els.tbody.querySelectorAll(".peso-input");
    var acc = 0;
    var changed = false;
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].value === "") continue;
      var cur = Math.round(parseEsPeNumber(inputs[i].value, 3) * 1000) / 1000;
      var maxAllowed = Math.round((limit - acc) * 1000) / 1000;
      if (maxAllowed < 0) maxAllowed = 0;
      if (cur > maxAllowed + 1e-9) {
        inputs[i].value = maxAllowed > 0 ? fmtTMFlex(maxAllowed) : "";
        changed = true;
      }
      acc +=
        inputs[i].value === ""
          ? 0
          : Math.round(parseEsPeNumber(inputs[i].value, 3) * 1000) / 1000;
    }
    if (changed && typeof Swal !== "undefined") {
      Swal.fire({
        icon: "info",
        title: "Pesajes ajustados",
        text: "La suma se ajustó al nuevo Peso (TM).",
        timer: 2200,
        showConfirmButton: false,
      });
    }
    if (changed) {
      for (var j = 0; j < inputs.length; j++) {
        if (String(inputs[j].value).trim()) blurFormatLocaleField(inputs[j]);
      }
    }
  }

  /** Tope de Peso (TM) si está definido y > 0; si no, sin límite para filas. */
  function getPesoTotalCap() {
    var raw = els.pesoTotal.value.trim();
    if (!raw) return null;
    var limit = Math.round(parseEsPeNumber(raw, 3) * 1000) / 1000;
    if (!(limit > 0)) return null;
    return limit;
  }

  function updateAddRowButtonState() {
    if (!els.addBtn) return;
    var cap = getPesoTotalCap();
    var sum = Math.round(sumWeights(getWeights()) * 1000) / 1000;
    var atCap = cap != null && sum >= cap - 1e-9;
    els.addBtn.classList.toggle("btn-add-at-cap", atCap);
    els.addBtn.setAttribute("aria-disabled", atCap ? "true" : "false");
    if (atCap) {
      els.addBtn.title =
        "Pulse para ver el total de pesajes y el Peso (TM) límite. Reduzca un peso o suba el tope para añadir filas.";
    } else {
      els.addBtn.removeAttribute("title");
    }
  }

  function renumberRows() {
    var rows = els.tbody.querySelectorAll("tr");
    for (var i = 0; i < rows.length; i++) {
      var ix = rows[i].querySelector(".row-index");
      if (ix) ix.textContent = String(i + 1);
    }
  }

  function clearTbody() {
    els.tbody.innerHTML = "";
  }

  function addRow(value) {
    var node = els.tpl.content.cloneNode(true);
    var inp = node.querySelector(".peso-input");
    if (value !== undefined && value !== null && value !== "") inp.value = value;
    els.tbody.appendChild(node);
    renumberRows();
    var row = els.tbody.lastElementChild;
    var input = row.querySelector(".peso-input");
    if (value !== undefined && value !== null && value !== "") blurFormatLocaleField(input);
    var removeBtn = row.querySelector(".remove-row");
    if (removeBtn) {
      removeBtn.addEventListener("click", function () {
        if (els.tbody.rows.length <= 1) {
          input.value = "";
          recalc();
          return;
        }
        row.remove();
        renumberRows();
        recalc();
      });
    }
    refreshIcons();
    return input;
  }

  function buildPreviewWeightsTable(weights) {
    els.pvPesos.innerHTML = "";
    var n = weights.length;
    var hasValue = false;
    for (var i = 0; i < n; i++) {
      if (weights[i] !== null) {
        hasValue = true;
        break;
      }
    }
    if (!hasValue) {
      var trEmpty = document.createElement("tr");
      var tdEmpty = document.createElement("td");
      tdEmpty.colSpan = 4;
      tdEmpty.textContent = "Sin pesajes registrados";
      tdEmpty.style.textAlign = "center";
      tdEmpty.style.color = "#9aa8b8";
      tdEmpty.style.padding = "12px";
      trEmpty.appendChild(tdEmpty);
      els.pvPesos.appendChild(trEmpty);
      return;
    }

    var half = Math.ceil(n / 2);
    function appendPair(tr, seq, w, active) {
      var tdN = document.createElement("td");
      var tdW = document.createElement("td");
      if (active && w !== null) {
        tdN.textContent = String(seq);
        tdW.textContent = fmtTMFlex(w);
      } else if (active) {
        tdN.textContent = String(seq);
        tdW.textContent = "—";
      } else {
        tdN.textContent = "";
        tdW.textContent = "—";
      }
      tr.appendChild(tdN);
      tr.appendChild(tdW);
    }

    for (var r = 0; r < half; r++) {
      var tr = document.createElement("tr");
      var li = r;
      var ri = r + half;
      appendPair(tr, li + 1, weights[li], li < n);
      appendPair(tr, ri + 1, weights[ri], ri < n);
      els.pvPesos.appendChild(tr);
    }
  }

  function collectState() {
    var weights = [];
    var inputs = els.tbody.querySelectorAll(".peso-input");
    for (var i = 0; i < inputs.length; i++) {
      weights.push(inputs[i].value);
    }
    return {
      lote: els.lote.value,
      fecha: els.fecha.value,
      supervisor: els.supervisor.value,
      pesoTotal: els.pesoTotal.value,
      pesoNeto: els.pesoNeto.value,
      merma: els.merma.value,
      humedad: els.humedad.value,
      pesoSeco: els.pesoSeco.value,
      precio: els.precio.value,
      pagoTotal: els.pagoTotal.value,
      weights: weights,
    };
  }

  function applyState(d) {
    if (!d) return;
    els.lote.value = d.lote || "";
    els.fecha.value = d.fecha || todayIso();
    els.supervisor.value = d.supervisor || "";
    els.pesoTotal.value = d.pesoTotal != null ? d.pesoTotal : "";
    els.pesoNeto.value = d.pesoNeto != null ? d.pesoNeto : "";
    els.merma.value = d.merma != null ? d.merma : "";
    els.humedad.value = d.humedad != null ? d.humedad : "";
    els.pesoSeco.value = d.pesoSeco != null ? d.pesoSeco : "";
    els.precio.value = d.precio != null ? d.precio : "";
    els.pagoTotal.value = d.pagoTotal != null ? d.pagoTotal : "";
    clearTbody();
    var ws = d.weights;
    if (ws && ws.length) {
      for (var i = 0; i < ws.length; i++) addRow(ws[i]);
    } else {
      seedRows();
    }
    formatAllLocaleFields();
    refreshIcons();
  }

  function persistSoon() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(collectState()));
      } catch (e) {
        alertErr("No se pudo guardar", "El navegador bloqueó el almacenamiento local.");
      }
    }, 450);
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var d = JSON.parse(raw);
      applyState(d);
      return true;
    } catch (e) {
      return false;
    }
  }

  function getLiquidacionTotals() {
    var weights = getWeights();
    var totalFromTable = sumWeights(weights);
    var hasWeightValue = false;
    for (var i = 0; i < weights.length; i++) {
      if (weights[i] !== null) {
        hasWeightValue = true;
        break;
      }
    }

    var totalHasInput = els.pesoTotal.value.trim() !== "";
    var totalTM = totalHasInput ? parseEsPeNumber(els.pesoTotal.value, 3) : 0;

    var merma = Math.max(0, parseEsPeNumber(els.merma.value, 3));
    var hum = Math.min(100, Math.max(0, parseEsPeNumber(els.humedad.value, 2)));

    var netoCalc = Math.max(0, totalTM - merma);
    var secoCalc = netoCalc * (1 - hum / 100);
    var precio = Math.max(0, parseEsPeNumber(els.precio.value, 2));
    var precioHasInput = els.precio.value.trim() !== "";

    var neto = els.pesoNeto.value.trim() ? parseEsPeNumber(els.pesoNeto.value, 3) : netoCalc;
    var seco = els.pesoSeco.value.trim() ? parseEsPeNumber(els.pesoSeco.value, 3) : secoCalc;
    var hasBaseForCalc =
      totalHasInput ||
      els.merma.value.trim() !== "" ||
      els.humedad.value.trim() !== "" ||
      els.pesoNeto.value.trim() !== "" ||
      els.pesoSeco.value.trim() !== "";
    var canCalcPago = precioHasInput && hasBaseForCalc;
    var pago = canCalcPago ? Math.max(0, seco * precio) : 0;

    return {
      weights: weights,
      totalFromTable: totalFromTable,
      hasWeightValue: hasWeightValue,
      totalHasInput: totalHasInput,
      totalTM: totalTM,
      merma: merma,
      hum: hum,
      neto: neto,
      seco: seco,
      precio: precio,
      pago: pago,
      canCalcPago: canCalcPago,
    };
  }

  function recalc() {
    var t = getLiquidacionTotals();
    var weights = t.weights;
    var totalFromTable = t.totalFromTable;
    var canCalcPago = t.canCalcPago;
    var pagoCalc = t.pago;

    var lotLabel = els.lote.value.trim();
    els.liqLotDisplay.textContent = lotLabel || "—";

    // No forzar escritura en peso neto/peso seco para permitir edición o borrado manual.
    els.pagoTotal.value = canCalcPago ? fmtUsd(pagoCalc) : "";

    els.pvLote.textContent = lotLabel || "—";
    els.pvFecha.textContent = els.fecha.value ? formatDisplayDate(els.fecha.value) : "—";
    els.pvSupervisor.textContent = els.supervisor.value.trim() || "胡安";

    buildPreviewWeightsTable(weights);

    els.pvBigbagVal.textContent = fmtTMFlex(t.totalFromTable);
    els.pvTotal.textContent = fmtTMFlex(t.totalTM);
    els.pvMerma.textContent = fmtTMFlex(t.merma);
    els.pvNeto.textContent = fmtTMFlex(t.neto);
    els.pvHumedad.textContent = fmtUsd(t.hum) + " %";
    els.pvSeco.textContent = fmtTMFlex(t.seco);
    els.pvPrecio.textContent = fmtUsd(t.precio);
    els.pvPago.textContent = fmtUsd(t.pago);

    updateAddRowButtonState();
    persistSoon();
  }

  function sanitizeFilePart(s) {
    return (
      String(s || "")
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "_")
        .slice(0, 48) || "liquidacion"
    );
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(function () {
      /* file:// o servidor sin HTTPS (excepto localhost): omitir sin ruido */
    });
  }

  function generatePdf() {
    if (!(window.jspdf && window.jspdf.jsPDF)) {
      alertErr(
        "Falta la librería PDF",
        "Abra la app desde la misma carpeta y verifique que exista vendor/jspdf.umd.min.js"
      );
      return;
    }

    var run = function () {
      recalc();
      var liq = getLiquidacionTotals();
      var cap = liq.totalHasInput ? Math.round(liq.totalTM * 1000) / 1000 : null;
      var sumTab = Math.round(liq.totalFromTable * 1000) / 1000;
      if (cap != null && cap > 0) {
        if (sumTab > cap + 1e-6) {
          alertErr(
            "Suma de pesajes superior al Peso (TM)",
            "La suma (" +
              fmtTMFlex(sumTab) +
              " TN) no puede superar el Peso (TM) (" +
              fmtTMFlex(cap) +
              " TN)."
          );
          return;
        }
      }

      var JsPDF = window.jspdf.jsPDF;
      var doc = new JsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      var pageW = doc.internal.pageSize.getWidth();
      var margin = 22;
      var gap = 8;
      var leftW = 108;
      var rightInset = 8;
      var rightX = margin + leftW + gap;
      var colW = pageW - margin * 2 - leftW - gap - rightInset;
      var leftX = margin;
      var boxY = 14;

      var loteTxt = els.lote.value.trim() || "—";
      var fechaTxt = els.fecha.value ? formatDisplayDate(els.fecha.value) : "—";
      var supTxt = els.supervisor.value.trim() || "胡安";
      var weights = liq.weights;
      var totalTM = liq.totalTM;
      var totalBigBagTM = liq.totalFromTable;
      var merma = liq.merma;
      var hum = liq.hum;
      var neto = liq.neto;
      var seco = liq.seco;
      var precio = liq.precio;
      var pago = liq.pago;

      doc.setDrawColor(0, 0, 0);
      doc.setTextColor(0, 0, 0);
      doc.setLineWidth(0.28);

      // Columna izquierda: liquidacion
      // Altura ajustada al contenido (última fila ~ boxY+96 + margen inferior)
      var leftBoxH = 104;
      doc.rect(leftX, boxY, leftW, leftBoxH);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      drawPdfText(doc, "Liquidación " + loteTxt, leftX + 4, boxY + 10, {
        fontSize: 13,
        bold: true,
      });
      doc.setFontSize(12.5);
      function drawSummaryRow(y, label, value) {
        var x = leftX + 8;
        var labelText = "• " + label + ": ";
        doc.setFont("helvetica", "bold");
        doc.text(labelText, x, y);
        var labelW = doc.getTextWidth(labelText);
        doc.setFont("helvetica", "normal");
        doc.text(String(value), x + labelW, y);
      }
      drawSummaryRow(boxY + 24, "Peso", fmtTMFlex(totalTM));
      drawSummaryRow(boxY + 36, "Merma", fmtTMFlex(merma));
      drawSummaryRow(boxY + 48, "Peso", fmtTMFlex(neto));
      drawSummaryRow(boxY + 60, "Humedad", fmtUsd(hum));
      drawSummaryRow(boxY + 72, "Peso seco", fmtTMFlex(seco));
      drawSummaryRow(boxY + 84, "Precio por tm", fmtUsd(precio) + " dólares");
      drawSummaryRow(boxY + 96, "Pago total", fmtUsd(pago) + " dólares");

      // Cabecera formato referencia (columna derecha)
      doc.rect(rightX, boxY, colW, 10);
      doc.rect(rightX, boxY + 10, colW, 10);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.setTextColor(220, 0, 0);
      var titleBarH = 10;
      drawPdfText(doc, "RECORD DE PESAJE", rightX + colW / 2, boxY + titleBarH / 2, {
        align: "center",
        fontSize: 15,
        bold: true,
        color: [220, 0, 0],
        valign: "middle",
      });
      doc.setFontSize(14);
      drawPdfText(doc, "ACME", rightX + colW / 2, boxY + titleBarH + titleBarH / 2, {
        align: "center",
        fontSize: 14,
        bold: true,
        color: [220, 0, 0],
        valign: "middle",
      });
      doc.setTextColor(0, 0, 0);

      var metaY = boxY + 20;
      var metaH = 14;
      var tableY = metaY + metaH;
      var headH = 9;
      var rowH = 6.5;
      // Proporcion de columnas: 27% | 23% | 27% | 23%
      var c0 = rightX + colW * 0.27;
      var c1 = rightX + colW * 0.5;
      var c2 = rightX + colW * 0.77;
      var c3 = rightX + colW;

      // Encabezado en 4 columnas: LOTE | valor | FECHA | valor
      doc.rect(rightX, metaY, colW, metaH);
      doc.line(c0, metaY, c0, metaY + metaH);
      doc.line(c1, metaY, c1, metaY + metaH);
      doc.line(c2, metaY, c2, metaY + metaH);
      var metaCx0 = (rightX + c0) / 2;
      var metaCx2 = (c1 + c2) / 2;
      var metaCx3 = (c2 + c3) / 2;
      var metaMidY = metaY + metaH / 2;
      doc.setFontSize(8.4);
      doc.setFont("helvetica", "bold");
      drawPdfText(doc, "地段 / LOTE", metaCx0, metaMidY, {
        align: "center",
        fontSize: 8.4,
        bold: true,
        valign: "middle",
      });
      drawPdfWrappedInCell(doc, loteTxt, c0, metaY, c1 - c0, metaH, {
        fontSize: 10.5,
        padMm: 2.1,
        yOffsetMm: 1.1,
        bold: true,
      });
      drawPdfText(doc, "日期 / FECHA", metaCx2, metaMidY, {
        align: "center",
        fontSize: 8.4,
        bold: true,
        valign: "middle",
      });
      drawPdfText(doc, fechaTxt, metaCx3, metaMidY, {
        align: "center",
        fontSize: 11,
        bold: true,
        valign: "middle",
      });

      // encabezado de tabla
      doc.rect(rightX, tableY, colW, headH);
      doc.line(c0, tableY, c0, tableY + headH);
      doc.line(c1, tableY, c1, tableY + headH);
      doc.line(c2, tableY, c2, tableY + headH);
      doc.line(c3, tableY, c3, tableY + headH);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      var headMidY = tableY + headH / 2;
      drawPdfText(doc, "数字 / N", (rightX + c0) / 2, headMidY, {
        align: "center",
        fontSize: 10.5,
        bold: true,
        valign: "middle",
      });
      drawPdfText(doc, "重量吨 (TN)", (c0 + c1) / 2, headMidY, {
        align: "center",
        fontSize: 10.5,
        bold: true,
        valign: "middle",
      });
      drawPdfText(doc, "数字 / N", (c1 + c2) / 2, headMidY, {
        align: "center",
        fontSize: 10.5,
        bold: true,
        valign: "middle",
      });
      drawPdfText(doc, "重量吨 (TN)", (c2 + c3) / 2, headMidY, {
        align: "center",
        fontSize: 10.5,
        bold: true,
        valign: "middle",
      });

      var maxDay = getSheetMaxDay(els.fecha.value);

      function weightAtDay(day) {
        if (day < 1 || day > maxDay) return "";
        var idx = day - 1;
        if (idx >= weights.length) return "";
        var row = els.tbody.rows[idx];
        if (!row) return "";
        return row.querySelector(".peso-input").value !== "" ? fmtTMFlex(weights[idx]) : "";
      }

      // 15 filas
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      for (var r = 0; r < 15; r++) {
        var y = tableY + headH + r * rowH;
        doc.rect(rightX, y, colW, rowH);
        doc.line(c0, y, c0, y + rowH);
        doc.line(c1, y, c1, y + rowH);
        doc.line(c2, y, c2, y + rowH);
        doc.line(c3, y, c3, y + rowH);

        var leftDay = r + 1;
        var rightDay = r + 16;
        var rowMidY = y + rowH / 2;
        if (leftDay <= maxDay) {
          drawPdfText(doc, String(leftDay), (rightX + c0) / 2, rowMidY, {
            align: "center",
            fontSize: 10,
            bold: false,
            valign: "middle",
          });
        }
        drawPdfText(doc, weightAtDay(leftDay), (c0 + c1) / 2, rowMidY, {
          align: "center",
          fontSize: 10,
          bold: false,
          valign: "middle",
        });
        if (rightDay <= maxDay) {
          drawPdfText(doc, String(rightDay), (c1 + c2) / 2, rowMidY, {
            align: "center",
            fontSize: 10,
            bold: false,
            valign: "middle",
          });
        }
        drawPdfText(doc, weightAtDay(rightDay), (c2 + c3) / 2, rowMidY, {
          align: "center",
          fontSize: 10,
          bold: false,
          valign: "middle",
        });
      }

      var finalY = tableY + headH + rowH * 15;
      var totalY = finalY;
      doc.rect(rightX, totalY, colW, 10);
      // Cerramos la primera columna tambien en esta fila y usamos el bloque derecho para el titulo.
      doc.line(c0, totalY, c0, totalY + 10);
      drawPdfText(doc, "TOTAL BIG BAG", (rightX + c0) / 2, totalY + 10 / 2, {
        align: "center",
        fontSize: 10,
        bold: true,
        valign: "middle",
      });

      var sumY = totalY + 10;
      var leftBlockW = c0 - rightX;
      doc.rect(rightX, sumY, colW, 16);
      doc.line(rightX + leftBlockW, sumY, rightX + leftBlockW, sumY + 16);
      var sumLeftCx = rightX + leftBlockW / 2;
      drawPdfText(doc, "总量", sumLeftCx, sumY + 16 * 0.32, {
        align: "center",
        fontSize: 12,
        bold: true,
        valign: "middle",
      });
      drawPdfText(doc, "(TN) / Peso Total", sumLeftCx, sumY + 16 * 0.68, {
        align: "center",
        fontSize: 10,
        bold: true,
        valign: "middle",
      });
      drawPdfText(doc, fmtTMFlex(totalBigBagTM), rightX + leftBlockW + (colW - leftBlockW) / 2, sumY + 16 / 2, {
        align: "center",
        fontSize: 16,
        bold: true,
        valign: "middle",
      });

      var supY = sumY + 16;
      doc.rect(rightX, supY, colW, 14);
      doc.line(rightX + leftBlockW, supY, rightX + leftBlockW, supY + 14);
      var supLeftCx = rightX + leftBlockW / 2;
      drawPdfText(doc, "重型经理", supLeftCx, supY + 14 * 0.32, {
        align: "center",
        fontSize: 13,
        bold: true,
        valign: "middle",
      });
      drawPdfText(doc, "supervisor", supLeftCx, supY + 14 * 0.68, {
        align: "center",
        fontSize: 11,
        bold: true,
        valign: "middle",
      });
      drawPdfText(doc, supTxt || "胡安", rightX + leftBlockW + (colW - leftBlockW) / 2, supY + 14 / 2, {
        align: "center",
        fontSize: 14,
        bold: true,
        valign: "middle",
      });

      var fname =
        "Liquidacion_ACME_" + sanitizeFilePart(loteTxt) + "_" + (els.fecha.value || "") + ".pdf";
      var pdfBlob = doc.output("blob");
      if (lastPdfObjectUrl) {
        URL.revokeObjectURL(lastPdfObjectUrl);
        lastPdfObjectUrl = null;
      }
      lastPdfObjectUrl = URL.createObjectURL(pdfBlob);

      if (typeof Swal !== "undefined") {
        Swal.fire({
          icon: "success",
          title: "PDF generado",
          html:
            "<p style=\"margin:0 0 .35rem;\">Elija <strong>una</strong> opción:</p>" +
            "<p style=\"margin:0;font-size:.88em;opacity:.88\">Sin conexión puede usar <strong>Ver</strong> o <strong>Descargar</strong>. <strong>Compartir</strong> requiere datos o Wi‑Fi.</p>",
          showDenyButton: true,
          showCancelButton: true,
          confirmButtonText: "Ver PDF",
          denyButtonText: "Compartir",
          cancelButtonText: "Descargar",
          allowOutsideClick: false,
          allowEscapeKey: false,
          showCloseButton: false,
          focusConfirm: false,
          reverseButtons: false,
          customClass: {
            denyButton: "swal2-btn-wa",
            cancelButton: "swal2-btn-dl",
          },
        }).then(function (res) {
          if (res.isConfirmed) {
            window.open(lastPdfObjectUrl, "_blank", "noopener,noreferrer");
          } else if (res.isDenied) {
            shareLastPdfWhatsApp(pdfBlob, fname);
          } else if (
            (typeof Swal !== "undefined" &&
              Swal.DismissReason &&
              res.dismiss === Swal.DismissReason.cancel) ||
            res.dismiss === "cancel"
          ) {
            triggerPdfDownload(lastPdfObjectUrl, fname);
          }
        });
      } else {
        if (window.confirm("¿Descargar el PDF ahora?")) {
          triggerPdfDownload(lastPdfObjectUrl, fname);
        } else if (window.confirm("¿Abrir el PDF en una pestaña nueva?")) {
          window.open(lastPdfObjectUrl, "_blank", "noopener,noreferrer");
        }
      }
    };

    if (typeof Swal !== "undefined") {
      Swal.fire({
        icon: "question",
        title: "Generar PDF",
        html: "Se creará el reporte con los datos visibles en pantalla.<br/><small>Incluye totales de liquidación.</small>",
        showCancelButton: true,
        focusCancel: true,
        confirmButtonText: "Sí, generar",
        cancelButtonText: "Cancelar",
      }).then(function (res) {
        if (res.isConfirmed) run();
      });
    } else {
      if (window.confirm("¿Generar PDF con los datos actuales?")) run();
    }
  }

  function confirmClear() {
    var doit = function () {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (e) {
        /* ignorar */
      }
      if (lastPdfObjectUrl) {
        try {
          URL.revokeObjectURL(lastPdfObjectUrl);
        } catch (e2) {
          /* ignorar */
        }
        lastPdfObjectUrl = null;
      }
      window.location.reload();
    };

    if (typeof Swal !== "undefined") {
      Swal.fire({
        icon: "warning",
        title: "¿Limpiar todo?",
        text: "Se borrarán los datos de esta pantalla y el respaldo local.",
        showCancelButton: true,
        confirmButtonText: "Sí, limpiar",
        cancelButtonText: "No",
      }).then(function (r) {
        if (r.isConfirmed) doit();
      });
    } else if (window.confirm("¿Limpiar todo?")) doit();
  }

  function alertAddRowBlocked(sum, cap) {
    var sumS = fmtTMFlex(sum);
    var capS = fmtTMFlex(cap);
    if (typeof Swal !== "undefined") {
      Swal.fire({
        icon: "warning",
        title: "No se puede añadir otra fila",
        html:
          "<p>El total de peso de los pesajes suma <strong>" +
          sumS +
          " TN</strong>.</p>" +
          "<p>Ese total <strong>no debe superarse</strong> respecto al " +
          "<strong>Peso (TM)</strong> de la liquidación, que es <strong>" +
          capS +
          " TN</strong>.</p>" +
          "<p>Para continuar, baje algún pesaje o aumente el Peso (TM) arriba.</p>",
        confirmButtonText: "Entendido",
      });
    } else {
      window.alert(
        "Total de pesajes: " +
          sumS +
          " TN. No puede superar el Peso (TM): " +
          capS +
          " TN."
      );
    }
  }

  els.addBtn.addEventListener("click", function () {
    var cap = getPesoTotalCap();
    var sum = Math.round(sumWeights(getWeights()) * 1000) / 1000;
    if (cap != null && sum >= cap - 1e-9) {
      alertAddRowBlocked(sum, cap);
      return;
    }
    addRow("");
    recalc();
  });

  els.form.addEventListener(
    "input",
    function (e) {
      var t = e.target;
      if (!t || !isLocaleNumericField(t) || t.readOnly) return;
      formatLocaleInputLive(t);
      if (t.classList.contains("peso-input")) clampPesoInputToTotal(t);
      recalc();
    },
    true
  );

  els.form.addEventListener(
    "focusout",
    function (e) {
      var t = e.target;
      if (!t || !isLocaleNumericField(t)) return;
      blurFormatLocaleField(t);
      if (t.classList.contains("peso-input")) {
        clampPesoInputToTotal(t);
        blurFormatLocaleField(t);
      }
      recalc();
    },
    true
  );

  els.pesoTotal.addEventListener("change", function () {
    enforceTotalWeightCapFromStart();
    recalc();
  });
  els.lote.addEventListener("input", recalc);
  els.fecha.addEventListener("change", recalc);
  els.supervisor.addEventListener("input", recalc);
  els.btnPdf.addEventListener("click", generatePdf);
  els.btnClear.addEventListener("click", confirmClear);
  if (els.partTwo && els.partTwoToggle) {
    els.partTwoToggle.addEventListener("click", function () {
      var collapsed = els.partTwo.classList.toggle("is-collapsed");
      var icon = els.partTwoToggle.querySelector("[data-lucide]");
      if (icon) icon.setAttribute("data-lucide", collapsed ? "chevron-down" : "chevron-up");
      els.partTwoToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      els.partTwoToggle.setAttribute("aria-label", collapsed ? "Abrir pesajes" : "Cerrar pesajes");
      els.partTwoToggle.setAttribute("title", collapsed ? "Abrir pesajes" : "Cerrar pesajes");
      refreshIcons();
    });
  }

  function seedRows() {
    addRow("");
    addRow("");
    addRow("");
  }

  function boot() {
    refreshIcons();
    var restored = loadState();
    if (!restored) {
      els.fecha.value = todayIso();
      seedRows();
    }
    recalc();
    refreshIcons();

    registerServiceWorker();

    if (restored && typeof Swal !== "undefined") {
      Swal.fire({
        icon: "info",
        title: "Datos recuperados",
        text: "Se cargó el último registro guardado en este equipo.",
        confirmButtonText: "Continuar",
        timer: 6000,
        timerProgressBar: true,
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
