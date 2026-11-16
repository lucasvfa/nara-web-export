// Nara web export builder. Called as: await BUILD(data, imageHashes, opts)
// data: compact payload (see compact.py), imageHashes: {I index -> imageHash}
async function BUILD(D, H, opts) {
  const FALLBACK = { 'FH Noetica': 'Geist', '-apple-system': 'SF Pro', 'system-ui': 'SF Pro', 'BlinkMacSystemFont': 'SF Pro' };
  const WN = { 100: ['Thin'], 200: ['ExtraLight', 'Extra Light', 'Ultralight'], 300: ['Light'], 400: ['Regular', 'Book'], 500: ['Medium'], 600: ['SemiBold', 'Semi Bold', 'Semibold'], 700: ['Bold'], 800: ['ExtraBold', 'Extra Bold', 'Heavy'], 900: ['Black'] };
  const avail = (globalThis.__naraFonts) || (globalThis.__naraFonts = await figma.listAvailableFontsAsync());
  const fam = {}; for (const f of avail) (fam[f.fontName.family] = fam[f.fontName.family] || []).push(f.fontName.style);
  const loaded = {};
  const missing = new Set();
  const FXERR = [];
  async function font(ff, w, it) {
    let family = fam[ff] ? ff : (FALLBACK[ff] || 'SF Pro');
    if (!fam[ff]) missing.add(ff);
    if (!fam[family]) family = 'Roboto';
    const styles = fam[family];
    const want = (WN[Math.round(w / 100) * 100] || ['Regular']);
    let st = null;
    for (const c of want) { const s2 = it ? (c === 'Regular' ? 'Italic' : c + ' Italic') : c; if (styles.includes(s2)) { st = s2; break; } }
    if (!st) st = styles.includes(it ? 'Italic' : 'Regular') ? (it ? 'Italic' : 'Regular') : styles[0];
    const key = family + '|' + st;
    if (!loaded[key]) { await figma.loadFontAsync({ family, style: st }); loaded[key] = 1; }
    return { family, style: st };
  }
  const col = c => { if (!c) return null; const h = Array.isArray(c) ? c[0] : c; const a = Array.isArray(c) ? c[1] : 1; return { r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255, a }; };
  const solid = c => { const k = col(c); return { type: 'SOLID', color: { r: k.r, g: k.g, b: k.b }, opacity: k.a }; };
  function parseGrad(g, w, h) {
    const m = g.match(/linear-gradient\((.*)\)/); if (!m) return null;
    let parts = [], d = 0, cur = '';
    for (const ch of m[1]) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { parts.push(cur.trim()); cur = ''; } else cur += ch; }
    parts.push(cur.trim());
    let ang = 180;
    if (/deg$/.test(parts[0])) { ang = parseFloat(parts[0]); parts.shift(); }
    else if (/^to /.test(parts[0])) { const t = parts.shift(); ang = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270, 'to top right': 45, 'to bottom right': 135, 'to bottom left': 225, 'to top left': 315 }[t] || 180; }
    const stops = [];
    parts.forEach((p, i) => { const cm = p.match(/rgba?\(([^)]+)\)/); if (!cm) return; const v = cm[1].split(/[ ,\/]+/).filter(Boolean).map(Number); const pm = p.replace(cm[0], '').match(/([\d.]+)%/); stops.push({ position: pm ? parseFloat(pm[1]) / 100 : i / Math.max(1, parts.length - 1), color: { r: v[0] / 255, g: v[1] / 255, b: v[2] / 255, a: v.length > 3 ? v[3] : 1 } }); });
    if (stops.length < 2) return null;
    const rad = (ang - 90) * Math.PI / 180, cx = Math.cos(rad), cy = Math.sin(rad);
    // transform maps gradient x axis along the angle, centered
    const t = [[cx, cy, 0.5 - cx / 2 - cy / 2], [-cy, cx, 0.5 + cy / 2 - cx / 2]];
    return { type: 'GRADIENT_LINEAR', gradientTransform: t, gradientStops: stops };
  }
  function paintBox(node, p, w, h) {
    const fills = [];
    if (p.bg) fills.push(solid(p.bg));
    if (p.gr) { const g = parseGrad(p.gr, w, h); if (g) fills.push(g); }
    if (p.bi !== undefined && H[p.bi]) fills.push({ type: 'IMAGE', imageHash: H[p.bi], scaleMode: p.bs === 'contain' ? 'FIT' : 'FILL' });
    node.fills = fills;
    if (p.bw) {
      node.strokes = [solid(p.bc)]; node.strokeAlign = 'INSIDE';
      const [t, r, b, l] = p.bw;
      if (t === r && r === b && b === l) node.strokeWeight = t;
      else { node.strokeTopWeight = t; node.strokeRightWeight = r; node.strokeBottomWeight = b; node.strokeLeftWeight = l; }
    }
    if (p.rd) { const [a, b, c, d] = p.rd; if (a === b && b === c && c === d) node.cornerRadius = a; else { node.topLeftRadius = a; node.topRightRadius = b; node.bottomRightRadius = c; node.bottomLeftRadius = d; } }
    const fx = [];
    if (p.sh) for (const s of p.sh) { const k = col(s[0]); const e = { type: s[5] ? 'INNER_SHADOW' : 'DROP_SHADOW', color: k, offset: { x: s[1], y: s[2] }, radius: Math.max(0, s[3]), spread: s[4], visible: true, blendMode: 'NORMAL' }; if (!s[5]) e.showShadowBehindNode = false; fx.push(e); }
    if (p.bb) fx.push({ type: 'BACKGROUND_BLUR', blurType: 'NORMAL', radius: p.bb, visible: true });
    if (fx.length) { try { node.effects = fx; } catch (e) { try { node.effects = fx.filter(f => f.type !== 'BACKGROUND_BLUR'); } catch (e2) { FXERR.push(String(e.message || e).slice(0, 120)); } } }
    if (p.op !== undefined) node.opacity = p.op;
  }
  let count = 0;
  async function make(n, parent, ox, oy) {
    const [kind, x, y, w, h] = n;
    count++;
    if (kind === 0) {
      const f = figma.createFrame();
      f.name = n[5]; f.resize(w, h); f.x = x - ox; f.y = y - oy;
      f.fills = []; f.clipsContent = !!n[6].cl;
      paintBox(f, n[6], w, h);
      parent.appendChild(f);
      for (const k of n[7]) await make(k, f, x, y);
      return;
    }
    if (kind === 1) {
      const st = D.T[n[6]];
      const t = figma.createText();
      t.fontName = await font(st.f, st.w, st.i);
      const runs = Array.isArray(n[5]) ? n[5] : [[n[5], n[6]]];
      t.characters = runs.map(q => q[0]).join('');
      t.fontSize = st.s;
      if (st.l) t.lineHeight = { value: st.l, unit: 'PIXELS' };
      if (st.k) t.letterSpacing = { value: st.k, unit: 'PIXELS' };
      t.fills = [solid(st.c)];
      if (st.u) t.textDecoration = 'UNDERLINE';
      if (runs.length > 1) { let p0 = 0; for (const [s2, si] of runs) { const q = D.T[si]; const p1 = p0 + s2.length; if (p1 > p0) { t.setRangeFontName(p0, p1, await font(q.f, q.w, q.i)); t.setRangeFontSize(p0, p1, q.s); t.setRangeFills(p0, p1, [solid(q.c)]); if (q.l) t.setRangeLineHeight(p0, p1, { value: q.l, unit: 'PIXELS' }); t.setRangeLetterSpacing(p0, p1, { value: q.k || 0, unit: 'PIXELS' }); t.setRangeTextDecoration(p0, p1, q.u ? 'UNDERLINE' : 'NONE'); } p0 = p1; } }
      const al = { center: 'CENTER', right: 'RIGHT', end: 'RIGHT', justify: 'JUSTIFIED' }[st.a] || 'LEFT';
      t.textAlignHorizontal = al;
      t.name = t.characters.slice(0, 40);
      parent.appendChild(t);
      if (n[7]) { t.textAutoResize = 'HEIGHT'; t.resize(w + 2, h); t.x = x - ox; }
      else {
        t.textAutoResize = 'WIDTH_AND_HEIGHT';
        const dw = t.width - w;
        t.x = x - ox - (al === 'CENTER' ? dw / 2 : al === 'RIGHT' ? dw : 0);
      }
      t.y = y - oy + (h - t.height) / 2;
      return;
    }
    if (kind === 2) {
      const r = figma.createRectangle();
      r.resize(w, h); r.x = x - ox; r.y = y - oy;
      const p = n[7] || {};
      r.name = 'image \u00b7 ' + (D.I[n[5]] || '').split('/').pop();
      if (H[n[5]]) { const f0 = { type: 'IMAGE', imageHash: H[n[5]], scaleMode: n[6] === 'contain' ? 'FIT' : 'FILL' }; if (p.gs) f0.filters = { exposure: 0, contrast: 0, saturation: -1, temperature: 0, tint: 0, highlights: 0, shadows: 0 }; r.fills = [f0]; }
      else r.fills = [solid('#d9d9d9')];
      if (p.rd) { const [a, b, c, d] = p.rd; r.topLeftRadius = a; r.topRightRadius = b; r.bottomRightRadius = c; r.bottomLeftRadius = d; }
      if (p.op !== undefined) r.opacity = p.op;
      parent.appendChild(r);
      return;
    }
    if (kind === 3) {
      let node;
      try { node = figma.createNodeFromSvg(D.S[n[5]]); } catch (e) { node = figma.createRectangle(); node.fills = [solid(['#000000', 0.08])]; }
      node.name = n[6] || 'icon';
      parent.appendChild(node);
      try { node.resize(w, h); } catch (e) {}
      node.x = x - ox; node.y = y - oy;
      if (n[7] && 'findAll' in node) { const gray = p => { if (p.type !== 'SOLID') return p; const l = 0.299 * p.color.r + 0.587 * p.color.g + 0.114 * p.color.b; return Object.assign({}, p, { color: { r: l, g: l, b: l } }); }; for (const v of [node, ...node.findAll(() => true)]) { try { if (v.fills && v.fills !== figma.mixed) v.fills = v.fills.map(gray); if (v.strokes) v.strokes = v.strokes.map(gray); } catch (e) {} } }
      return;
    }
    if (kind === 4) {
      const r = figma.createRectangle(); r.resize(w, h); r.x = x - ox; r.y = y - oy; r.name = 'video (placeholder)'; r.fills = [solid('#1a1a1a')]; parent.appendChild(r); return;
    }
  }
  const page = figma.createFrame();
  page.name = opts.name || D.n;
  page.resize(D.w, D.h);
  page.fills = [solid(D.bg || '#ffffff')];
  page.clipsContent = true;
  page.x = opts.x || 0; page.y = opts.y || 0;
  if (opts.parent) opts.parent.appendChild(page);
  for (const n of D.R) await make(n, page, 0, 0);
  page.setPluginData('naraUrl', D.u || '');
  return { id: page.id, nodes: count, missing: [...missing], fxerr: FXERR.slice(0, 3) };
}
