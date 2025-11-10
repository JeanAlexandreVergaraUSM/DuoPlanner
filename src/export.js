// js/export.js
import { $, state } from './state.js';
import html2canvas from 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm';
import { jsPDF } from 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm';

// Helper: adjunta un listener solo una vez por botón/clave
function attachOnce(el, evt, fn, key) {
  if (!el) return;
  const flag = `bound_${key || evt}`;
  if (el.dataset[flag] === '1') return;
  el.addEventListener(evt, fn);
  el.dataset[flag] = '1';
}

function safeFilename(s) {
  return (s || '').replace(/[^\w\s.-]+/g, '').replace(/\s+/g, '_') || 'export';
}
function getSemLabel() { return state.activeSemesterData?.label || 'semestre'; }

async function nodeToCanvas(node, scale = 2) {
  const prev = node.style.backgroundColor;
  if (!prev) node.style.backgroundColor = getComputedStyle(document.body).backgroundColor || '#111';
  const canvas = await html2canvas(node, {
    scale, backgroundColor: null, useCORS: true, allowTaint: true,
    windowWidth: document.documentElement.scrollWidth,
    windowHeight: document.documentElement.scrollHeight,
  });
  if (!prev) node.style.backgroundColor = '';
  return canvas;
}

// 🔹 Exportar nodo a PNG
export async function exportNodeAsPNG(node, filenameBase) {
  try {
    const canvas = await nodeToCanvas(node, 2);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `${safeFilename(filenameBase)}.png`;
    a.click();
  } catch (e) {
    console.error('[exportNodeAsPNG]', e);
  }
}

// 🔹 Exportar nodo a PDF
export async function exportNodeAsPDF(node, filenameBase) {
  try {
    const canvas = await nodeToCanvas(node, 2);
    const img = canvas.toDataURL('image/png');
    const pxW = canvas.width, pxH = canvas.height;
    const orientation = (pxW >= pxH) ? 'l' : 'p';
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const ratio = Math.min(pageW / pxW, pageH / pxH);
    const imgW = pxW * ratio, imgH = pxH * ratio;
    pdf.addImage(img, 'PNG', (pageW - imgW) / 2, (pageH - imgH) / 2, imgW, imgH);
    pdf.save(`${safeFilename(filenameBase)}.pdf`);
  } catch (e) {
    console.error('[exportNodeAsPDF]', e);
  }
}

// === Vincula los botones de exportación ===
export function bindExportButtons() {
  // MALLA
  const mallaPNG = $('btn-export-malla-png');
  const mallaPDF = $('btn-export-malla-pdf');
  if (mallaPNG || mallaPDF) {
    const node = document.querySelector('#page-malla .malla-wrapper') || $('page-malla');
    const base = `malla_${getSemLabel()}`;
    attachOnce(mallaPNG, 'click', () => exportNodeAsPNG(node, base), 'malla_png');
    attachOnce(mallaPDF, 'click', () => exportNodeAsPDF(node, base), 'malla_pdf');
  }

  // HORARIO
  const horPNG = $('btn-export-horario-png');
  const horPDF = $('btn-export-horario-pdf');
  if (horPNG || horPDF) {
    const node =
      document.querySelector('#horarioCombinado:not(.hidden)') ||
      document.querySelector('#schedUSM') ||
      $('horarioPropio') ||
      $('page-horario');
    const base = `horario_${getSemLabel()}`;
    attachOnce(horPNG, 'click', () => exportNodeAsPNG(node, base), 'horario_png');
    attachOnce(horPDF, 'click', () => exportNodeAsPDF(node, base), 'horario_pdf');
  }
}

// --- helpers reutilizables ---
async function captureElement(el) {
  if (!el) throw new Error('No se encontró el elemento a exportar');
  return await html2canvas(el, { scale: 2 });
}

export async function exportGrades({ format = 'pdf' }) {
  const el = document.getElementById('coursesList');
  if (!el) throw new Error('No encontré el contenedor de notas');
  const canvas = await captureElement(el);
  if (format === 'png') downloadImage(canvas, 'notas.png');
  else downloadPDF(canvas, 'notas.pdf');
  return { ok: true };
}

export async function exportSchedule({ format = 'pdf' }) {
  const el = document.getElementById('schedUSM');
  if (!el) throw new Error('No encontré el horario');
  const canvas = await captureElement(el);
  if (format === 'png') downloadImage(canvas, 'horario.png');
  else downloadPDF(canvas, 'horario.pdf');
  return { ok: true };
}

export async function exportMalla({ format = 'pdf' }) {
  const el = document.querySelector('#page-malla .malla-wrapper');
  if (!el) throw new Error('No encontré la malla');
  const canvas = await captureElement(el);
  if (format === 'png') downloadImage(canvas, 'malla.png');
  else downloadPDF(canvas, 'malla.pdf');
  return { ok: true };
}

function downloadImage(canvas, filename) {
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function downloadPDF(canvas, filename) {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width, canvas.height] });
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
  pdf.save(filename);
}
