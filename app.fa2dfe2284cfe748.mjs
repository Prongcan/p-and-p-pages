import { unlockVault, decryptRecord, readCipher } from './vault.e6c8eab54fee9f86.mjs';

const entrance = document.querySelector('#entrance');
const site = document.querySelector('#private-site');
const form = document.querySelector('#unlock-form');
const input = document.querySelector('#access-key');
const submit = document.querySelector('#unlock-button');
const error = document.querySelector('#gate-error');
const viewer = document.querySelector('#photo-viewer');
const viewerImage = document.querySelector('#viewer-image');
const viewerCaption = document.querySelector('#viewer-caption');
const manifestPath = document.querySelector('script[data-vault]').dataset.vault;
let session = null;
let generation = 0;
let renderVersion = 0;
let clock = null;
let observer = null;
let gallery = [];
let photoIndex = 0;
let photoVersion = 0;
const urls = new Map();
const pendingImages = new Map();
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const paths = {
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  camera: '<path d="M14.5 4h-5L7 7H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-4Z"/><circle cx="12" cy="13" r="4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18m-12 5h6"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  home: '<path d="m3 10 9-7 9 7v10H3Zm6 10v-7h6v7"/>',
  photos: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 16 5-5 5 5 3-3 5 5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  theme: '<path d="M21 12.8A9 9 0 0 1 11.2 3 9 9 0 1 0 21 12.8Z"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.heart}</svg>`;

function theme() {
  document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
theme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', theme);

document.querySelector('#key-visibility').addEventListener('click', event => {
  const visible = input.type === 'password';
  input.type = visible ? 'text' : 'password';
  event.currentTarget.textContent = visible ? '隐藏' : '显示';
  event.currentTarget.setAttribute('aria-pressed', String(visible));
  event.currentTarget.setAttribute('aria-label', visible ? '隐藏密钥' : '显示密钥');
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submit.disabled) return;
  const attempt = ++generation;
  let password = input.value.trim();
  input.value = '';
  submit.disabled = true;
  submit.textContent = '正在打开回忆…';
  error.hidden = true;
  try {
    if (!globalThis.crypto?.subtle) throw new Error('unsupported');
    const response = await fetch(manifestPath, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('download');
    const unlocked = await unlockVault(password, await response.json());
    if (generation !== attempt) return;
    session = unlocked;
    entrance.hidden = true;
    site.hidden = false;
    document.body.classList.remove('is-locked');
    render();
  } catch {
    if (generation !== attempt) return;
    error.textContent = globalThis.crypto?.subtle
      ? '暗号不对，或者回忆还没下载好。检查密钥和网络，再试一次吧。'
      : '这个浏览器暂时打不开回忆，请用新版浏览器通过 HTTPS 访问。';
    error.hidden = false;
    input.focus();
  } finally {
    password = '';
    if (generation === attempt) {
      submit.disabled = false;
      submit.innerHTML = '打开我们的小宇宙 <span aria-hidden="true">↗</span>';
    }
  }
});

function lock(focus = true) {
  generation++;
  renderVersion++;
  session = null;
  gallery = [];
  clearInterval(clock);
  observer?.disconnect();
  closePhoto();
  site.replaceChildren();
  site.hidden = true;
  entrance.hidden = false;
  input.value = '';
  submit.disabled = false;
  submit.innerHTML = '打开我们的小宇宙 <span aria-hidden="true">↗</span>';
  document.body.classList.add('is-locked');
  document.title = 'P&P · 我们的小宇宙';
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
  pendingImages.clear();
  if (focus) input.focus();
}

function image(id, alt = '', extra = '') {
  return id ? `<img data-photo="${escape(id)}" alt="${escape(alt)}" decoding="async" ${extra}>` : '';
}

async function photoUrl(id, full = false) {
  if (!session) throw new Error('locked');
  const cacheKey = id + (full ? ':full' : ':preview');
  if (urls.has(cacheKey)) return urls.get(cacheKey);
  if (pendingImages.has(cacheKey)) return pendingImages.get(cacheKey);
  const owner = session;
  const task = (async () => {
    const media = owner.data.media[id];
    if (!media) throw new Error('missing photo');
    const record = full ? media.full : media.preview;
    const bytes = await decryptRecord(owner.key, record, readCipher);
    if (session !== owner) { bytes.fill(0); throw new Error('locked'); }
    const url = URL.createObjectURL(new Blob([bytes], { type: record.mime }));
    bytes.fill(0);
    urls.set(cacheKey, url);
    return url;
  })();
  pendingImages.set(cacheKey, task);
  try { return await task; } finally { pendingImages.delete(cacheKey); }
}

function loadPhotos() {
  observer?.disconnect();
  const version = renderVersion;
  const load = async element => {
    observer?.unobserve(element);
    try {
      const url = await photoUrl(element.dataset.photo);
      if (version === renderVersion && element.isConnected && session) element.src = url;
    } catch {
      if (version === renderVersion && element.isConnected && session) {
        element.alt = '这张照片暂时没打开，请刷新后再试';
        element.classList.add('image-error');
      }
    }
  };
  if ('IntersectionObserver' in globalThis) {
    observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) load(entry.target); }), { rootMargin: '500px' });
    site.querySelectorAll('img[data-photo]').forEach(element => observer.observe(element));
  } else site.querySelectorAll('img[data-photo]').forEach(load);
}

function card(moment) {
  return `<a class="memory-card" href="#/memory/${moment.id}"><span class="memory-cover">${moment.cover
    ? image(moment.cover, moment.title) : '<span class="cover-empty">♡</span>'}</span><span class="memory-copy"><span class="memory-meta">${escape(moment.date.replaceAll('-', '.'))} · 第 ${loveDay(moment.date)} 天</span><h3>${escape(moment.title)}</h3><p>${escape(moment.summary)}</p></span></a>`;
}

function loveDay(date) {
  return Math.max(1, Math.floor((new Date(date + 'T00:00:00+08:00') - new Date(session.data.site.startedAt)) / 86400000) + 1);
}

function home() {
  const { site: about, moments, photos } = session.data;
  const person = role => {
    const boy = role === 'boy';
    const name = boy ? about.boyName : about.girlName;
    const avatar = boy ? about.boyAvatar : about.girlAvatar;
    return `<article class="person ${boy ? 'person-left' : 'person-right'}"><div class="avatar avatar-${role}">${avatar ? image(avatar, name) : `<span>${escape(name.slice(0, 1))}</span>`}</div><div><p>${boy ? 'BOY' : 'GIRL'}</p><h2>${escape(name)}</h2><span class="person-line">${escape(boy ? about.boySentence : about.girlSentence)}</span></div></article>`;
  };
  const features = [
    ['moments', 'camera', '点点滴滴', '把喜欢的日子，一页一页收藏起来。', `${moments.length} 篇日记`, 'peach'],
    ['anniversaries', 'calendar', '值得记住的日子', '生日、纪念日，还有下一个期待。', '每一个重要的你和我', 'rose'],
    ['photos', 'photos', '我们的相册', '相机替我们记住了，快乐的模样。', `${photos.length} 张小美好`, 'lilac']
  ];
  return `<main id="main"><section class="home-hero"><div class="hero-content"><p class="kicker"><i></i>WELCOME TO OUR LITTLE WORLD<i></i></p><h1>两个人的<span>小宇宙</span></h1><p class="subtitle">${escape(about.homeSentence)}</p><div class="couple">${person('boy')}<div class="love-mark"><span class="heart">${icon('heart')}</span><span>LOVE</span></div>${person('girl')}</div><div class="together"><p class="together-letter">${icon('heart')}<span>${escape(about.loveLetter)}</span></p><div class="timer" aria-label="我们在一起的时间"><div><strong data-time="days">0</strong><span>天</span></div><b>:</b><div><strong data-time="hours">00</strong><span>小时</span></div><b>:</b><div><strong data-time="minutes">00</strong><span>分钟</span></div><b>:</b><div><strong data-time="seconds">00</strong><span>秒</span></div></div><small>始于 ${escape(about.startedAt.slice(0, 10).replaceAll('-', '.'))} · 故事还在继续</small></div></div><div class="float float-one">${icon('heart')}</div><div class="float float-two">${icon('heart')}</div></section><section class="feature-section"><div class="section-title"><div><p>OUR SPACE</p><h2>我们的专属空间</h2></div><span>把平凡日子，过成闪闪发光的回忆。</span></div><div class="feature-grid pp-features">${features.map(([route, glyph, title, description, hint, tone], i) => `<a class="feature-card ${tone}" href="#/${route}"><span class="card-top"><span class="feature-icon">${icon(glyph)}</span><small>0${i + 1}</small></span><h3>${title}</h3><p>${description}</p><span class="card-bottom"><span>${hint}</span>${icon('arrow')}</span></a>`).join('')}</div>${moments.length ? `<section class="recent-moments"><div class="section-title"><div><p>LATEST MOMENTS</p><h2>最近的点点滴滴</h2></div><a class="section-more" href="#/moments">翻翻日记 ${icon('arrow')}</a></div><div class="memory-grid">${moments.slice(0, 3).map(card).join('')}</div></section>` : ''}<p class="read-only-letter">${escape(about.dailyNote)}</p></section></main>`;
}

function heading(kicker, title, description, count = '') {
  return `<header class="snapshot-heading"><div><p class="kicker">${kicker}</p><h1>${escape(title)}</h1><p>${escape(description)}</p></div><small>${escape(count)}</small></header>`;
}

function memories() {
  const { moments } = session.data;
  return `<main id="main" class="snapshot-page">${heading('LITTLE MOMENTS', '点点滴滴', '一些小事，因为和你一起，就变得很值得记住。', `${moments.length} 篇小日记`)}<div class="memory-grid">${moments.map(card).join('')}</div>${moments.length ? '' : '<p class="empty-page">下一篇回忆，正在路上。</p>'}</main>`;
}

function memory(id) {
  const moment = session.data.moments.find(item => String(item.id) === id);
  if (!moment) return memories();
  return `<main id="main" class="article-page moment-article"><article><header><a class="back-moments" href="#/moments">← 返回点点滴滴</a><div class="article-moment-meta"><span>${icon('heart')} 相恋第 ${loveDay(moment.date)} 天</span>${moment.mood ? `<span>${escape(moment.mood)}</span>` : ''}${moment.location ? `<span>${escape(moment.location)}</span>` : ''}</div><time datetime="${escape(moment.date)}">${escape(moment.date.replaceAll('-', ' . '))}</time><h1>${escape(moment.title)}</h1><p class="article-byline">把今天留给以后，一起慢慢翻。</p></header><div class="article-body">${moment.html}</div></article></main>`;
}

function todayInChina() {
  const fields = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts().map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function nextYearly(date, today) {
  let year = Number(today.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const inYear = currentYear => {
    const last = new Date(Date.UTC(currentYear, month, 0)).getUTCDate();
    return `${currentYear}-${String(month).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
  };
  let next = inYear(year);
  if (next < today) next = inYear(++year);
  return next;
}

function anniversaries() {
  const { site: about } = session.data;
  const today = todayInChina();
  const cards = session.data.anniversaries.map(item => {
    const next = item.repeatYearly ? nextYearly(item.date, today) : item.date;
    const remaining = Math.round((new Date(next + 'T00:00:00+08:00') - new Date(today + 'T00:00:00+08:00')) / 86400000);
    return `<article class="anniversary-card"><span class="date-tag">${item.kind === 1 ? 'HAPPY BIRTHDAY' : 'A SPECIAL DAY'}</span><h2>${escape(item.title)}</h2><strong>${Math.abs(remaining)}</strong><span class="date-unit">${remaining === 0 ? '天 · 就是今天' : remaining > 0 ? '天后见' : '天前'}</span><p>${escape(item.note || '因为是你，所以要好好记得。')}</p><time datetime="${escape(item.date)}">${escape(item.date.replaceAll('-', '.'))}${item.repeatYearly ? ' · 每年都陪你过' : ''}</time></article>`;
  });
  return `<main id="main" class="snapshot-page">${heading('SAVE THE DATE', '值得记住的日子', '有些日期，一想到就会偷偷笑。')}<div class="anniversary-grid"><article class="anniversary-card"><span class="date-tag">OUR BEGINNING</span><h2>我们在一起啦</h2><strong>${loveDay(today)}</strong><span class="date-unit">天 · 还要好久好久</span><p>从这一刻开始，每个明天都有你。</p><time datetime="${escape(about.startedAt.slice(0, 10))}">${escape(about.startedAt.slice(0, 10).replaceAll('-', '.'))}</time></article>${cards.join('')}</div></main>`;
}

function photos() {
  return `<main id="main" class="snapshot-page">${heading('COLLECTING SUNSHINE', '我们的相册', '照片会替我们记得，那天的风、阳光和笑。', `${session.data.photos.length} 张小美好`)}<div class="photo-grid">${session.data.photos.map(photo => `<figure class="photo-card">${image(photo.media, photo.alt, 'tabindex="0" role="button" data-open-photo')}<figcaption>${photo.title ? `<strong>${escape(photo.title)}</strong>` : ''}${escape(photo.caption)}</figcaption></figure>`).join('')}</div></main>`;
}

function render() {
  if (!session) return;
  clearInterval(clock);
  renderVersion++;
  closePhoto();
  const route = location.hash.slice(1) || '/';
  const active = route.startsWith('/memory/') ? '/moments' : route;
  const nav = [['/', '首页'], ['/moments', '点滴'], ['/anniversaries', '纪念日'], ['/photos', '相册']];
  const content = route === '/moments' ? memories() : route === '/anniversaries' ? anniversaries()
    : route === '/photos' ? photos() : route.startsWith('/memory/') ? memory(route.slice(8)) : home();
  site.innerHTML = `<a class="skip-link" href="#main">跳到主要内容</a><header class="site-nav is-scrolled readonly-nav"><div class="nav-inner"><a class="logo" href="#/"><span>P</span> ${escape(session.data.site.title)}</a><nav aria-label="站内导航">${nav.map(([path, name]) => `<a href="#${path}"${active === path ? ' aria-current="page"' : ''}>${name}</a>`).join('')}</nav><div class="nav-actions"><button type="button" class="quiet-button" data-theme-toggle aria-label="切换明暗主题">${icon('theme')}</button><button type="button" class="quiet-button" data-lock aria-label="锁上小宇宙" title="锁上小宇宙">${icon('lock')}</button></div></div></header>${content}<footer class="pp-footer"><a class="logo" href="#/"><span>P</span> ${escape(session.data.site.title)}</a><p>Made with ♡ for the two of us.</p></footer>`;
  document.title = (nav.find(([path]) => path === active)?.[1] || '我们的故事') + ' · ' + session.data.site.title;
  gallery = [...site.querySelectorAll('[data-open-photo],.article-body img[data-photo]')].map(element => ({
    media: element.dataset.photo, alt: element.alt,
    caption: element.closest('figure')?.querySelector('figcaption')?.textContent || element.alt
  }));
  site.querySelectorAll('[data-open-photo],.article-body img[data-photo]').forEach((element, index) => {
    element.dataset.photoIndex = index;
    element.tabIndex = 0;
    element.setAttribute('role', 'button');
  });
  const tick = () => {
    if (!session) return;
    const elapsed = Math.max(0, Math.floor((Date.now() - new Date(session.data.site.startedAt)) / 1000));
    const values = { days: Math.floor(elapsed / 86400), hours: Math.floor(elapsed / 3600) % 24,
      minutes: Math.floor(elapsed / 60) % 60, seconds: elapsed % 60 };
    for (const [unit, value] of Object.entries(values)) site.querySelectorAll(`[data-time="${unit}"]`).forEach(element => { element.textContent = unit === 'days' ? value : String(value).padStart(2, '0'); });
  };
  tick();
  if (site.querySelector('[data-time]')) clock = setInterval(tick, 1000);
  loadPhotos();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function openPhoto(index) {
  if (!session || !gallery.length) return;
  photoIndex = (index + gallery.length) % gallery.length;
  const photo = gallery[photoIndex];
  const version = ++photoVersion;
  viewerImage.removeAttribute('src');
  viewerImage.alt = photo.alt;
  viewerCaption.textContent = '正在打开照片…';
  if (!viewer.open) viewer.showModal();
  document.body.classList.add('modal-open');
  try {
    const url = await photoUrl(photo.media, true);
    if (version !== photoVersion || !viewer.open || !session) return;
    viewerImage.src = url;
    viewerCaption.textContent = `${photoIndex + 1} / ${gallery.length} · ${photo.caption}`;
  } catch {
    if (version === photoVersion && viewer.open) viewerCaption.textContent = '这张照片还没打开，请稍后重试。';
  }
}

function closePhoto() {
  photoVersion++;
  if (viewer.open) viewer.close();
  viewerImage.removeAttribute('src');
  viewerImage.alt = '';
  viewerCaption.textContent = '';
  document.body.classList.remove('modal-open');
}

site.addEventListener('click', event => {
  if (event.target.closest('a[href="#main"]')) {
    event.preventDefault();
    const main = site.querySelector('#main');
    main?.setAttribute('tabindex', '-1');
    main?.focus();
  }
  if (event.target.closest('[data-lock]')) lock();
  if (event.target.closest('[data-theme-toggle]')) document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  const photo = event.target.closest('[data-photo-index]');
  if (photo) openPhoto(Number(photo.dataset.photoIndex));
});
site.addEventListener('keydown', event => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-photo-index]')) {
    event.preventDefault();
    openPhoto(Number(event.target.dataset.photoIndex));
  }
});
viewer.addEventListener('click', event => {
  if (event.target.closest('[data-viewer-close]') || event.target === viewer) closePhoto();
  const step = event.target.closest('[data-viewer-step]');
  if (step) openPhoto(photoIndex + Number(step.dataset.viewerStep));
});
viewer.addEventListener('cancel', event => { event.preventDefault(); closePhoto(); });
document.addEventListener('keydown', event => {
  if (viewer.open && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) openPhoto(photoIndex + (event.key === 'ArrowLeft' ? -1 : 1));
});
window.addEventListener('hashchange', render);
window.addEventListener('pagehide', () => lock(false));
