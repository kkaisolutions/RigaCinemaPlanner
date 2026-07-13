const DATA_URL = './data/schedule.json';
const TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Riga'
});
const UPDATED_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Riga'
});

const state = {
  data: null,
  cinemas: new Set(),
  query: ''
};

const els = {
  status: document.querySelector('#status'),
  search: document.querySelector('#movie-search'),
  cinemaOptions: document.querySelector('#cinema-options'),
  count: document.querySelector('#result-count'),
  warning: document.querySelector('#warning-note'),
  list: document.querySelector('#showtime-list'),
  empty: document.querySelector('#empty-state'),
  emptyTitle: document.querySelector('#empty-title')
};

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function fromUrlState() {
  const params = new URLSearchParams(window.location.search);
  state.query = params.get('q') || '';
  state.cinemas = new Set(params.getAll('cinema'));
  els.search.value = state.query;
}

function writeUrlState() {
  const params = new URLSearchParams();
  if (state.query) params.set('q', state.query);
  for (const cinema of [...state.cinemas].sort()) params.append('cinema', cinema);
  const query = params.toString();
  const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  window.history.replaceState(null, '', nextUrl);
}

function formatUpdated(value) {
  if (!value) return 'Waiting for first update';
  return `Updated ${UPDATED_FORMATTER.format(new Date(value))} Riga time`;
}

function formatTime(value) {
  return TIME_FORMATTER.format(new Date(value));
}

function showtimeServiceDate(showtime) {
  return showtime.serviceDate || String(showtime.startTime || '').slice(0, 10);
}

function formatAge(value) {
  if (!value) return '';
  const raw = String(value).toUpperCase().trim();
  if (['U', 'BEZ VECUMA IEROBEŽOJUMA', 'ALL AGES'].includes(raw)) return 'All ages';
  if (raw.includes('7')) return '7+';
  if (raw.includes('12')) return '12+';
  if (raw.includes('16')) return '16+';
  if (raw.includes('18')) return '18+';
  return value;
}

function titleText(showtime) {
  const local = showtime.title || '';
  const original = showtime.originalTitle || '';
  if (!original || normalizeText(local) === normalizeText(original)) return local;
  return `${local} / ${original}`;
}

function availabilityText(availability) {
  if (!availability) return '';
  const occupancy = availability.occupiedPercent != null
    ? `${availability.occupiedPercent}% occupied`
    : '';
  if (availability.takenSeats != null && availability.totalSeats != null) {
    return `${occupancy ? `${occupancy} · ` : ''}${availability.takenSeats} / ${availability.totalSeats} taken seats`;
  }
  if (availability.freeSeats != null) {
    return `${occupancy ? `${occupancy} · ` : ''}${availability.freeSeats} free seats`;
  }
  return occupancy;
}

function imdbText(showtime) {
  if (showtime.imdbRating) return `IMDb ${showtime.imdbRating}`;
  if (showtime.imdbUrl) return 'IMDb';
  return 'IMDb search';
}

function imdbUrl(showtime) {
  if (showtime.imdbUrl) return showtime.imdbUrl;
  const query = showtime.originalTitle || showtime.title;
  return `https://www.imdb.com/find/?q=${encodeURIComponent(query)}&s=tt&ttype=ft`;
}

function renderCinemaFilters(showtimes) {
  const names = [...new Set(showtimes.map((item) => item.cinema).filter(Boolean))].sort();
  if (state.cinemas.size === 0) state.cinemas = new Set(names);
  els.cinemaOptions.innerHTML = names.map((name) => {
    const checked = state.cinemas.has(name) ? 'checked' : '';
    return `<label class="cinema-choice"><input type="checkbox" value="${escapeHtml(name)}" ${checked}>${escapeHtml(name)}</label>`;
  }).join('');
}

function renderWarnings(data) {
  if (!data.warnings || data.warnings.length === 0) {
    els.warning.hidden = true;
    els.warning.textContent = '';
    return;
  }
  els.warning.hidden = false;
  els.warning.textContent = data.warnings.map((warning) => warning.message || warning.source).join(' · ');
}

function visibleShowtimes() {
  const query = normalizeText(state.query);
  return state.data.showtimes.filter((showtime) => {
    if (showtimeServiceDate(showtime) !== state.data.date) return false;
    if (!state.cinemas.has(showtime.cinema)) return false;
    if (!query) return true;
    return normalizeText(`${showtime.title} ${showtime.originalTitle}`).includes(query);
  });
}

function render() {
  if (!state.data) return;
  writeUrlState();
  const showtimes = visibleShowtimes();
  els.count.textContent = `${showtimes.length} upcoming session${showtimes.length === 1 ? '' : 's'}`;
  els.list.innerHTML = showtimes.map(renderCard).join('');
  els.emptyTitle.textContent = 'No upcoming sessions today';
  els.empty.hidden = showtimes.length !== 0;
}

function renderCard(showtime) {
  const age = formatAge(showtime.ageRating);
  const imdb = imdbText(showtime);
  const availability = availabilityText(showtime.availability);
  const details = [showtime.language].filter(Boolean).map(escapeHtml).join(' · ');
  const meta = [
    `<span class="cinema-name">${escapeHtml(showtime.cinema)}</span>`,
    showtime.genres?.length ? `<span>${escapeHtml(showtime.genres.join(', '))}</span>` : '',
    imdb ? renderImdb(showtime, imdb) : ''
  ].filter(Boolean).join('');
  const poster = showtime.posterUrl
    ? `<img class="poster" src="${escapeHtml(showtime.posterUrl)}" alt="">`
    : `<div class="poster poster-fallback" aria-hidden="true">${escapeHtml((showtime.title || '?').slice(0, 1))}</div>`;

  return `
    <a class="showtime-card" href="${escapeHtml(showtime.movieUrl)}">
      ${poster}
      <div class="card-main">
        <span class="title-line">${escapeHtml(titleText(showtime))}</span>
        <div class="meta-line">${age ? `<span class="rating">${escapeHtml(age)}</span>` : ''}${meta}</div>
        ${details ? `<div class="detail-line">${details}</div>` : ''}
        ${availability ? `<div class="seat-line">${escapeHtml(availability)}</div>` : ''}
      </div>
      <div class="time-block">
        <time class="time" datetime="${escapeHtml(showtime.startTime)}">${escapeHtml(formatTime(showtime.startTime))}</time>
        ${showtime.auditorium ? `<span class="auditorium">${escapeHtml(showtime.auditorium)}</span>` : ''}
      </div>
    </a>
  `;
}

function renderImdb(showtime, label) {
  return `<span class="imdb-link" role="link" tabindex="0" data-imdb-url="${escapeHtml(imdbUrl(showtime))}">${escapeHtml(label)}</span>`;
}

els.list.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest('[data-imdb-url]') : null;
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  window.open(target.dataset.imdbUrl, '_blank', 'noopener,noreferrer');
});

els.list.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const target = event.target instanceof Element ? event.target.closest('[data-imdb-url]') : null;
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  window.open(target.dataset.imdbUrl, '_blank', 'noopener,noreferrer');
});

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

els.search.addEventListener('input', () => {
  state.query = els.search.value;
  render();
});

els.cinemaOptions.addEventListener('change', (event) => {
  if (event.target instanceof HTMLInputElement) {
    if (event.target.checked) state.cinemas.add(event.target.value);
    else state.cinemas.delete(event.target.value);
    render();
  }
});

async function loadData() {
  try {
    const response = await fetch(DATA_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    els.status.textContent = formatUpdated(state.data.generatedAt);
    renderWarnings(state.data);
    renderCinemaFilters(state.data.showtimes || []);
    render();
  } catch (error) {
    els.status.textContent = 'Could not load schedule data';
    els.warning.hidden = false;
    els.warning.textContent = error.message;
  }
}

fromUrlState();
await loadData();
