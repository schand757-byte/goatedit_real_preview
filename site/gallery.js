// ============================================================
// The gallery page. Reads index.json (what the editor reads too), shows each
// template as its preview video, and hands "Open in GoatEdit" to the editor
// as a ?project-template= link, which makes a new project from it.
//
// Nothing here renders a template's contents — only the preview video its
// author exported — so the page runs no one else's code.
// ============================================================

const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const count = document.getElementById('count');
const search = document.getElementById('q');
const tagBar = document.getElementById('tags');
const shapeBar = document.getElementById('shapes');
const viewer = document.getElementById('viewer');
const viewerVideo = document.getElementById('viewer-video');

const activeTags = new Set();
let activeShape = null;

function shape(t) {
  const r = t.width / t.height;
  if (Math.abs(r - 16 / 9) < 0.02) return '16:9';
  if (Math.abs(r - 9 / 16) < 0.02) return '9:16';
  if (Math.abs(r - 1) < 0.02) return '1:1';
  if (Math.abs(r - 4 / 5) < 0.02) return '4:5';
  return 'Other';
}

const time = s => {
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m ? `${m}:${String(r).padStart(2, '0')}` : `${r}s`;
};

const size = n => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...children.filter(Boolean));
  return e;
}

function card(t) {
  const media = el('div', { class: 'card__media', style: `aspect-ratio: ${t.width} / ${t.height}` });
  if (t.thumbnailUrl) media.append(el('img', { src: t.thumbnailUrl, alt: '', loading: 'lazy' }));
  let video = null;
  const play = () => {
    if (!t.previewUrl) return;
    if (!video) {
      video = el('video', { src: t.previewUrl, muted: true, loop: true, playsinline: true, preload: 'auto' });
      video.muted = true;
      media.append(video);
    }
    video.play().catch(() => {});
  };
  const stop = () => { if (video && t.thumbnailUrl) video.pause(); };
  // With no thumbnail, the video's first frame is the thumbnail.
  if (!t.thumbnailUrl && t.previewUrl) {
    video = el('video', { src: `${t.previewUrl}#t=0.5`, muted: true, loop: true, playsinline: true, preload: 'metadata' });
    video.muted = true;
    media.append(video);
  }
  media.append(el('span', { class: 'card__badge', text: `${shape(t) === 'Other' ? `${t.width}×${t.height}` : shape(t)} · ${time(t.duration)}` }));
  return el('button', {
    class: 'card', type: 'button', 'aria-label': `${t.name} by ${t.author}`,
    onmouseenter: play, onmouseleave: stop, onfocus: play, onblur: stop,
    onclick: () => open(t),
  },
    media,
    el('div', { class: 'card__body' },
      el('div', { class: 'card__name', text: t.name }),
      el('div', { class: 'card__by', text: `by ${t.author}` })),
  );
}

function open(t) {
  document.getElementById('viewer-name').textContent = t.name;
  const by = document.getElementById('viewer-by');
  by.textContent = 'by ';
  by.append(t.authorUrl ? el('a', { href: t.authorUrl, target: '_blank', rel: 'noopener', text: t.author }) : t.author);
  document.getElementById('viewer-desc').textContent = t.description;
  document.getElementById('viewer-meta').textContent =
    `${t.width}×${t.height} · ${t.fps} fps · ${time(t.duration)} · ${size(t.bytes)} of files · ${t.license}${t.tags.length ? ` · ${t.tags.join(', ')}` : ''}`;
  document.getElementById('viewer-open').href = t.openUrl;
  const src = document.getElementById('viewer-src');
  src.hidden = !t.sourceUrl;
  if (t.sourceUrl) src.href = t.sourceUrl;
  viewerVideo.hidden = !t.previewUrl;
  if (t.previewUrl) {
    viewerVideo.src = t.previewUrl;
    viewerVideo.poster = t.thumbnailUrl ?? '';
    viewerVideo.play().catch(() => {});
  }
  history.replaceState(null, '', `#${t.id}`);
  viewer.showModal();
}

viewer.addEventListener('close', () => {
  viewerVideo.pause();
  viewerVideo.removeAttribute('src');
  viewerVideo.load();
  history.replaceState(null, '', location.pathname + location.search);
});
document.getElementById('viewer-close').addEventListener('click', () => viewer.close());
viewer.addEventListener('click', e => { if (e.target === viewer) viewer.close(); });

function chips(bar, values, isOn, toggle) {
  bar.replaceChildren(...values.map(v =>
    el('button', { class: 'chip', type: 'button', 'aria-pressed': String(isOn(v)), text: v, onclick: () => { toggle(v); render(); } })));
}

let templates = [];

function render() {
  const q = search.value.trim().toLowerCase();
  const shown = templates.filter(t =>
    (!activeShape || shape(t) === activeShape) &&
    [...activeTags].every(x => t.tags.includes(x)) &&
    (!q || `${t.name} ${t.description} ${t.author} ${t.tags.join(' ')}`.toLowerCase().includes(q)));
  grid.replaceChildren(...shown.map(card));
  empty.hidden = shown.length > 0;
  count.textContent = `${shown.length} of ${templates.length} template${templates.length === 1 ? '' : 's'}`;
  const shapes = [...new Set(templates.map(shape))];
  chips(shapeBar, shapes.length > 1 ? shapes : [], s => s === activeShape, s => { activeShape = activeShape === s ? null : s; });
  const tags = [...new Set(templates.flatMap(t => t.tags))].sort();
  chips(tagBar, tags, x => activeTags.has(x), x => { activeTags.has(x) ? activeTags.delete(x) : activeTags.add(x); });
}

search.addEventListener('input', render);

try {
  const res = await fetch('index.json', { cache: 'no-cache' });
  const manifest = await res.json();
  templates = manifest.templates ?? [];
  render();
  const linked = templates.find(t => `#${t.id}` === location.hash);
  if (linked) open(linked);
  if (!templates.length) { empty.textContent = 'No templates published yet.'; empty.hidden = false; }
} catch {
  empty.textContent = 'Could not load the gallery.';
  empty.hidden = false;
}
