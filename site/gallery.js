// ============================================================
// The gallery page. Reads index.json (what the editor reads too) and shows
// each template as a card that plays while it is on screen, in a masonry
// board; a card opens the viewer, and "Open in GoatEdit" hands the template to
// the editor as a ?project-template= link, which makes a new project from it.
//
// Cards play the small clip the build cut from each preview (`card.video`),
// never the full preview: that one is only fetched in the viewer.
//
// Nothing here renders a template's contents — only the videos its author
// exported — so the page runs no one else's code.
// ============================================================

const $ = id => document.getElementById(id);
const grid = $('grid');
const search = $('q');
const viewer = $('viewer');
const viewerVideo = $('v-video');

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const saveData = navigator.connection?.saveData === true;
/** Cards play by themselves while on screen, unless the visitor asked for less motion or data. */
const autoplay = !reduceMotion && !saveData;
const NEW_FOR = 7 * 24 * 3600 * 1000;

let templates = [];
let shown = [];
let activeShape = null;
let activeCat = null;
const activeStyles = new Set();
let activeSwap = null;
// Labels come from index.json; these are only what shows before it loads.
let CATEGORIES = [];
let STYLES = [];
let current = null;
/** Whether the open viewer added the history entry it is showing. */
let pushed = false;

// --- Small helpers -----------------------------------------------------

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'text') e.textContent = v;
    else if (k === 'style' && typeof v === 'object') for (const [p, x] of Object.entries(v)) e.style.setProperty(p, x);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...children.filter(c => c !== null && c !== undefined && c !== false));
  return e;
}

function svg(path) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = path;
  return s;
}
const ARROW = '<path d="M7 17 17 7M9 7h8v8" />';

const SHAPES = [
  { id: '16:9', label: 'Landscape', w: 16, h: 9 },
  { id: '9:16', label: 'Portrait', w: 9, h: 16 },
  { id: '1:1', label: 'Square', w: 12, h: 12 },
  { id: '4:5', label: 'Feed', w: 10, h: 12.5 },
];

const catLabel = id => CATEGORIES.find(c => c.id === id)?.label ?? '';
const styleLabel = id => STYLES.find(c => c.id === id)?.label ?? id;

/** What someone brings to make it theirs: the filter for "I have no footage". */
const SWAPS = [
  { id: 'text', label: 'Just edit text' },
  { id: 'footage', label: 'Your footage' },
  { id: 'images', label: 'Your images' },
];
function swap(t) {
  const s = t.slots;
  if (!s) return null;
  return s.footage ? 'footage' : s.images ? 'images' : 'text';
}
function swapLine(t) {
  const s = t.slots;
  if (!s) return null;
  const n = (c, one, many) => `${c} ${c === 1 ? one : many}`;
  if (s.footage) return `Your footage · ${n(s.footage, 'clip', 'clips')}`;
  if (s.images) return `Your images · ${n(s.images, 'image', 'images')}`;
  return s.texts ? `Just edit text · ${n(s.texts, 'layer', 'layers')}` : 'Nothing to swap';
}

function shape(t) {
  const r = t.width / t.height;
  for (const s of SHAPES) if (Math.abs(r - s.w / s.h) < 0.02) return s.id;
  return 'Other';
}

const time = s => {
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m ? `${m}:${String(r).padStart(2, '0')}` : `0:${String(r).padStart(2, '0')}`;
};

const size = n => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(n >= 100 * 1024 * 1024 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function resolution(t) {
  const k = Math.max(t.width, t.height);
  const name = k >= 3840 ? ' · 4K' : k >= 2560 ? ' · 2.5K' : k >= 1920 ? ' · HD' : '';
  return `${t.width}×${t.height}${name}`;
}

function ago(iso) {
  const d = (Date.now() - Date.parse(iso)) / 1000;
  if (!(d >= 0)) return '';
  const units = [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
  for (const [s, name] of units) {
    const n = Math.floor(d / s);
    if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

const isNew = t => t.addedAt && Date.now() - Date.parse(t.addedAt) < NEW_FOR;
const cardVideo = t => t.card?.video ?? t.previewUrl;
const poster = t => t.card?.poster ?? t.thumbnailUrl;

/** A colour pair from a name, so each author keeps the same avatar. */
function avatar(name, big = false) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.codePointAt(0)) >>> 0;
  const h1 = h % 360;
  return el('span', {
    class: `avatar${big ? ' avatar--lg' : ''}`,
    style: { '--h1': `${h1}deg`, '--h2': `${(h1 + 60) % 360}deg` },
    text: [...name.trim()][0] ?? '?',
  });
}

let toastTimer = 0;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  t.style.animation = 'none';
  void t.offsetWidth;
  t.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
}

// --- Cards ---------------------------------------------------------------

const cards = new Map();

/** Plays a card's clip while it is at least partly on screen; builds the <video> the first time. */
const playing = new IntersectionObserver(entries => {
  for (const e of entries) {
    const c = e.target.__card;
    if (e.isIntersecting && e.intersectionRatio >= 0.35) c.play(); else c.pause();
  }
}, { threshold: [0, 0.35, 0.7] });

/** Fades cards in the first time they come into view, a beat apart. */
const reveal = new IntersectionObserver(entries => {
  let n = 0;
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.style.setProperty('--delay', `${Math.min(n++, 6) * 70}ms`);
    e.target.classList.add('is-in');
    reveal.unobserve(e.target);
  }
}, { rootMargin: '0px 0px -40px 0px' });

/** Shown in the gallery, but its project is not published. */
const viewOnly = t => t.access === 'view';

function makeCard(t) {
  const still = poster(t);
  const media = el('button', {
    class: 'card__media', type: 'button', 'aria-label': `Watch ${t.name} by ${t.author}`,
    style: { 'aspect-ratio': `${t.width} / ${t.height}`, '--c': t.card?.color ?? '#18181b' },
    onclick: () => openViewer(t),
  });
  if (still) media.append(el('img', { src: still, alt: '', loading: 'lazy', decoding: 'async' }));

  let video = null;
  let hovering = false;
  const ensureVideo = () => {
    if (video || !cardVideo(t)) return video;
    video = el('video', { src: cardVideo(t), muted: true, loop: true, playsinline: true, preload: 'auto', 'aria-hidden': 'true' });
    video.muted = true;
    video.addEventListener('playing', () => video.classList.add('is-playing'));
    media.append(video);
    return video;
  };
  if (!still) {
    // No poster: the clip's own first frame stands in for one.
    ensureVideo();
    video.preload = 'metadata';
    video.classList.add('is-playing');
  }
  const api = {
    play() { if (autoplay || hovering) ensureVideo()?.play().catch(() => {}); },
    pause() { if (video && !hovering) video.pause(); },
  };

  media.append(
    el('span', { class: 'badge badge--time', text: time(t.duration) }),
    isNew(t) ? el('span', { class: 'badge badge--new', text: 'New' }) : null,
    viewOnly(t) ? el('span', { class: 'badge badge--view', text: 'View only' }) : null,
    el('span', { class: 'badge badge--live', text: shape(t) === 'Other' ? `${t.width}×${t.height}` : shape(t) }),
  );

  const open = viewOnly(t)
    ? (t.buyUrl ? el('a', { class: 'card__open', href: t.buyUrl, target: '_blank', rel: 'noopener', 'aria-label': `Buy ${t.name}` }, 'Buy', svg(ARROW)) : null)
    : el('a', { class: 'card__open', href: t.openUrl, target: '_blank', rel: 'noopener', 'aria-label': `Open ${t.name} in GoatEdit` }, 'Use', svg(ARROW));

  const card = el('article', {
    class: 'card',
    onpointerenter: () => { hovering = true; ensureVideo()?.play().catch(() => {}); },
    onpointerleave: () => { hovering = false; if (!autoplay) video?.pause(); },
    onpointermove: e => {
      const r = media.getBoundingClientRect();
      media.style.setProperty('--mx', `${e.clientX - r.left}px`);
      media.style.setProperty('--my', `${e.clientY - r.top}px`);
    },
  },
    el('div', { style: { position: 'relative' } }, media, open),
    el('div', { class: 'card__meta' },
      avatar(t.author),
      el('div', { class: 'card__text' },
        el('div', { class: 'card__name', text: t.name }),
        el('div', { class: 'card__by', text: [t.author, catLabel(t.category)].filter(Boolean).join(' · ') }))),
  );
  card.__card = api;
  playing.observe(card);
  reveal.observe(card);
  return card;
}

// --- Masonry ----------------------------------------------------------------

function columnCount() {
  const w = grid.clientWidth || innerWidth;
  return w >= 1600 ? 5 : w >= 1180 ? 4 : w >= 820 ? 3 : 2;
}

let laidOut = { n: 0, ids: '' };

/** Deals the cards into columns, each to the shortest so far, keeping reading order left to right. */
function layout(force = false) {
  const n = columnCount();
  const ids = shown.map(t => t.id).join(',');
  if (!force && n === laidOut.n && ids === laidOut.ids) return;
  laidOut = { n, ids };
  const cols = Array.from({ length: n }, () => el('div', { class: 'col' }));
  const heights = new Array(n).fill(0);
  for (const t of shown) {
    let card = cards.get(t.id);
    if (!card) { card = makeCard(t); cards.set(t.id, card); }
    const i = heights.indexOf(Math.min(...heights));
    cols[i].append(card);
    heights[i] += t.height / t.width + 0.22; // the picture, plus the name under it
  }
  grid.replaceChildren(...cols);
}

function skeleton() {
  const n = columnCount();
  const shapes = [0.56, 1.3, 0.75, 1, 0.56, 1.6, 0.8, 0.56];
  grid.replaceChildren(...Array.from({ length: n }, (_, c) =>
    el('div', { class: 'col' }, ...[0, 1, 2].map(i =>
      el('div', { class: 'skeleton', style: { 'aspect-ratio': `1 / ${shapes[(c * 3 + i) % shapes.length]}` } })))));
}

// --- Filters -----------------------------------------------------------------

function renderFilters() {
  const present = new Set(templates.map(shape));
  const options = SHAPES.filter(s => present.has(s.id));
  const seg = $('shapes');
  seg.hidden = options.length < 2;
  seg.replaceChildren(
    el('button', { type: 'button', 'aria-pressed': String(!activeShape), text: 'All', onclick: () => { activeShape = null; apply(); } }),
    ...options.map(s => el('button', {
      type: 'button', 'aria-pressed': String(activeShape === s.id), title: s.id,
      onclick: () => { activeShape = activeShape === s.id ? null : s.id; apply(); },
    }, el('i', { style: { width: `${s.w * 0.9}px`, height: `${s.h * 0.9}px` } }), s.label)),
  );
  // Only what something is filed under: a chip that matches nothing is a dead end.
  const count = id => templates.filter(t => t.category === id).length;
  const cats = CATEGORIES.filter(c => count(c.id));
  $('cats').replaceChildren(
    el('button', { type: 'button', 'aria-pressed': String(!activeCat), onclick: () => { activeCat = null; apply(); } }, 'All'),
    ...cats.map(c => el('button', {
      type: 'button', 'aria-pressed': String(activeCat === c.id),
      onclick: () => { activeCat = activeCat === c.id ? null : c.id; apply(); },
    }, c.label, el('sup', { text: String(count(c.id)) }))),
  );

  const styles = STYLES.filter(st => templates.some(t => t.styles?.includes(st.id)));
  const swaps = SWAPS.filter(w => templates.some(t => swap(t) === w.id));
  const chip = (label, on, onclick) => el('button', { class: 'chip', type: 'button', 'aria-pressed': String(on), text: label, onclick });
  $('tags').replaceChildren(...[
    ...styles.map(st => chip(st.label, activeStyles.has(st.id), () => {
      activeStyles.has(st.id) ? activeStyles.delete(st.id) : activeStyles.add(st.id); apply();
    })),
    styles.length && swaps.length ? el('span', { class: 'chips__sep', 'aria-hidden': 'true' }) : null,
    ...swaps.map(w => chip(w.label, activeSwap === w.id, () => { activeSwap = activeSwap === w.id ? null : w.id; apply(); })),
  ].filter(Boolean));
}

/** Everything a search can match: the words on the card, and what is inside it. */
function haystack(t) {
  return [
    t.name, t.description, t.author, catLabel(t.category), ...t.tags,
    ...(t.styles ?? []).map(styleLabel), ...(t.uses ?? []), swapLine(t) ?? '',
  ].join(' ').toLowerCase();
}

function apply() {
  const q = search.value.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  shown = templates.filter(t => {
    if (activeShape && shape(t) !== activeShape) return false;
    if (activeCat && t.category !== activeCat) return false;
    if (![...activeStyles].every(x => t.styles?.includes(x))) return false;
    if (activeSwap && swap(t) !== activeSwap) return false;
    const hay = haystack(t);
    return words.every(w => hay.includes(w));
  });
  renderFilters();
  layout();
  const filtered = q || activeShape || activeCat || activeStyles.size || activeSwap;
  $('count').textContent = filtered ? `${shown.length} of ${templates.length}` : `${templates.length} template${templates.length === 1 ? '' : 's'}`;
  $('empty').hidden = shown.length > 0;
  $('empty-text').textContent = templates.length ? 'Try fewer words or another filter.' : 'No templates have been published yet.';
  $('clear').hidden = !filtered;
}

function clearFilters() {
  search.value = '';
  activeShape = null;
  activeCat = null;
  activeStyles.clear();
  activeSwap = null;
  apply();
}
$('clear').addEventListener('click', clearFilters);

let scrolledToBoard = false;
search.addEventListener('input', () => {
  apply();
  // Typing in the hero: bring the results into view once.
  const board = $('browse').getBoundingClientRect();
  if (!scrolledToBoard && board.top > innerHeight * 0.6) {
    scrolledToBoard = true;
    $('browse').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  }
});

// --- Hero wall ------------------------------------------------------------------

function buildWall() {
  const stills = templates.filter(poster);
  if (!stills.length) return;
  const wall = $('wall');
  const rows = [0, 1, 2].map(r => {
    // Enough frames to overfill the widest screen, then the same again so the loop is seamless.
    const order = stills.map((_, i) => stills[(i + r) % stills.length]);
    const run = [];
    while (run.length < 9) run.push(...order);
    return el('div', { class: 'wall__row', style: { '--dur': `${70 + r * 25}s` } },
      ...[...run, ...run].map(t => el('img', { src: poster(t), alt: '', decoding: 'async', style: { '--ar': `${t.width} / ${t.height}` } })));
  });
  wall.replaceChildren(...rows);
  const first = wall.querySelector('img');
  const ready = () => wall.classList.add('is-ready');
  first.complete ? ready() : first.addEventListener('load', ready, { once: true });
}

// --- Viewer ----------------------------------------------------------------------

const glow = $('v-glow');
const glowCtx = glow.getContext('2d');
let glowFrame = 0;
let glowLast = 0;

/** Paints the playing frame, a few pixels wide, behind the stage: the room takes the video's light. */
function paintGlow(now) {
  glowFrame = requestAnimationFrame(paintGlow);
  if (now - glowLast < 120 || viewerVideo.readyState < 2) return;
  glowLast = now;
  try { glowCtx.drawImage(viewerVideo, 0, 0, glow.width, glow.height); } catch { /* not decodable yet */ }
}

function spec(label, value) {
  return el('div', {}, el('dt', { text: label }), el('dd', { text: value }));
}

const LICENCE_NAMES = { 'CC-BY-4.0': 'CC BY 4.0', 'CC0-1.0': 'CC0 (free)', 'CC-BY-NC-4.0': 'CC BY-NC 4.0', MIT: 'MIT' };

function related(t) {
  const score = x =>
    (t.category && x.category === t.category ? 3 : 0) +
    (x.styles ?? []).filter(g => t.styles?.includes(g)).length * 2 +
    x.tags.filter(g => t.tags.includes(g)).length +
    (shape(x) === shape(t) ? 1 : 0) + (x.author === t.author ? 1 : 0);
  return templates.filter(x => x.id !== t.id).sort((a, b) => score(b) - score(a)).slice(0, 4);
}

function openViewer(t, { push = true } = {}) {
  current = t;
  const by = t.authorUrl ? el('a', { href: t.authorUrl, target: '_blank', rel: 'noopener' }, el('b', { text: t.author })) : el('b', { text: t.author });
  $('v-who').replaceChildren(avatar(t.author, true), el('div', {}, by, el('span', { text: t.addedAt ? `Published ${ago(t.addedAt)}` : 'Template' })));
  $('v-name').textContent = t.name;
  $('v-desc').textContent = t.description;
  // Each chip files the board the way it is labelled: a category or a style
  // becomes that filter, a free tag becomes a search.
  const jump = set => () => { closeViewer(); clearFilters(); set(); apply(); $('browse').scrollIntoView(); };
  $('v-tags').replaceChildren(...[
    t.category ? el('button', { class: 'chip', type: 'button', 'aria-pressed': 'true', text: catLabel(t.category), onclick: jump(() => { activeCat = t.category; }) }) : null,
    ...(t.styles ?? []).map(x => el('button', { class: 'chip', type: 'button', text: styleLabel(x), onclick: jump(() => activeStyles.add(x)) })),
    ...t.tags.map(x => el('button', { class: 'chip', type: 'button', text: `#${x}`, onclick: jump(() => { search.value = x; }) })),
  ].filter(Boolean));
  $('v-specs').replaceChildren(...[
    swapLine(t) && !viewOnly(t) ? spec('You change', swapLine(t)) : null,
    spec('Frame', resolution(t)),
    spec('Rate', `${Math.round(t.fps * 100) / 100} fps`),
    spec('Length', time(t.duration)),
    viewOnly(t) ? spec('Access', 'View only') : spec('Files', t.bytes ? size(t.bytes) : '—'),
    spec('Shape', shape(t) === 'Other' ? `${t.width}:${t.height}` : shape(t)),
    spec('Licence', LICENCE_NAMES[t.license] ?? t.license),
  ].filter(Boolean));
  // View-only: the project is not published, so the button goes to the
  // seller (or the author's page) instead of the editor.
  const open = $('v-open');
  const href = viewOnly(t) ? t.buyUrl ?? t.authorUrl : t.openUrl;
  open.hidden = !href;
  if (href) open.href = href;
  open.target = '_blank';
  $('v-open-label').textContent = !viewOnly(t) ? 'Open in GoatEdit' : t.buyUrl ? 'Buy this template' : 'Contact the author';
  $('v-hint').textContent = viewOnly(t)
    ? 'View only. The author keeps the project; it does not open in the editor from here.'
    : 'Opens as a new project. The original stays as it is.';

  const more = related(t);
  $('v-more-wrap').hidden = !more.length;
  $('v-more').replaceChildren(...more.map(x => el('button', {
    type: 'button', style: { '--c': x.card?.color ?? '#18181b' }, onclick: () => openViewer(x, { push: false }),
    'aria-label': `Watch ${x.name}`,
  }, poster(x) ? el('img', { src: poster(x), alt: '', loading: 'lazy' }) : null, el('span', { text: x.name }))));
  $('v-prev').hidden = $('v-next').hidden = shown.length < 2 || !shown.includes(t);

  glowCtx.fillStyle = t.card?.color ?? '#000';
  glowCtx.fillRect(0, 0, glow.width, glow.height);
  viewerVideo.poster = poster(t) ?? '';
  viewerVideo.hidden = !t.previewUrl;
  if (t.previewUrl) {
    viewerVideo.src = t.previewUrl;
    viewerVideo.play().catch(() => {});
  }
  document.querySelector('.viewer__side').scrollTop = 0;
  viewer.scrollTop = 0;

  if (push) {
    if (!viewer.open) { history.pushState({ viewer: true }, '', `#${t.id}`); pushed = true; }
  } else {
    history.replaceState(history.state, '', `#${t.id}`);
  }
  if (!viewer.open) {
    viewer.showModal();
    $('v-close').focus({ preventScroll: true });
    viewer.scrollTop = 0;
    document.body.classList.add('is-locked');
    cancelAnimationFrame(glowFrame);
    glowFrame = requestAnimationFrame(paintGlow);
  }
}

function step(d) {
  if (!current || shown.length < 2) return;
  const i = shown.indexOf(current);
  if (i < 0) return;
  openViewer(shown[(i + d + shown.length) % shown.length], { push: false });
}

function closeViewer() {
  if (!viewer.open) return;
  viewer.close();
}

viewer.addEventListener('close', () => {
  cancelAnimationFrame(glowFrame);
  viewerVideo.pause();
  viewerVideo.removeAttribute('src');
  viewerVideo.load();
  document.body.classList.remove('is-locked');
  current = null;
  if (pushed) { pushed = false; history.back(); } else if (location.hash) history.replaceState(null, '', location.pathname + location.search);
});

addEventListener('popstate', () => {
  const t = templates.find(x => `#${x.id}` === location.hash);
  if (t) { openViewer(t, { push: false }); return; }
  if (viewer.open) { pushed = false; viewer.close(); }
});

$('v-close').addEventListener('click', () => closeViewer());
$('v-prev').addEventListener('click', () => step(-1));
$('v-next').addEventListener('click', () => step(1));
viewer.addEventListener('click', e => { if (e.target === viewer || e.target.classList.contains('viewer__stage')) closeViewer(); });
$('v-copy').addEventListener('click', async () => {
  if (!current) return;
  const url = `${location.origin}${location.pathname}#${current.id}`;
  try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { prompt('Copy this link', url); }
});

// --- Keys and scroll ---------------------------------------------------------------

addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');
  if (viewer.open) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    return;
  }
  if (e.key === '/' && !typing) { e.preventDefault(); search.focus(); }
  if (e.key === 'Escape' && document.activeElement === search) { search.value ? clearFilters() : search.blur(); }
});

const bar = $('bar');
const onScroll = () => bar.classList.toggle('is-scrolled', scrollY > 12);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

let resizeTimer = 0;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => layout(), 120); });

// --- Start -------------------------------------------------------------------------

skeleton();
try {
  const res = await fetch('index.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(String(res.status));
  const manifest = await res.json();
  templates = (manifest.templates ?? []).filter(t => t && t.id && t.width > 0 && t.height > 0);
  CATEGORIES = Array.isArray(manifest.categories) ? manifest.categories : [];
  STYLES = Array.isArray(manifest.styles) ? manifest.styles : [];
  $('eyebrow').textContent = templates.length ? `${templates.length} template${templates.length === 1 ? '' : 's'}` : 'Templates';
  buildWall();
  apply();
  const linked = templates.find(t => `#${t.id}` === location.hash);
  if (linked) openViewer(linked, { push: false });
} catch {
  grid.replaceChildren();
  $('empty').hidden = false;
  $('empty-text').textContent = 'Could not load the gallery. Check your connection and reload.';
  $('clear').hidden = true;
}
