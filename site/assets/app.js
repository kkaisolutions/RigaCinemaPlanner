const DATA_URL = './data/schedule.json';
const KNOWN_CINEMAS = [
  'Apollo Akropole',
  'Apollo Domina',
  'Apollo Plaza',
  'Cinamon Alfa',
  'Forum Cinemas'
];
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
const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'Europe/Riga'
});
const RIGA_PARTS_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Europe/Riga'
});

const state = {
  data: null,
  cinemas: new Set(),
  query: '',
  selectedDate: null
};

const els = {
  status: document.querySelector('#status'),
  search: document.querySelector('#movie-search'),
  cinemaOptions: document.querySelector('#cinema-options'),
  cinemaSummary: document.querySelector('#cinema-summary'),
  sourceInfo: document.querySelector('#source-info'),
  sourceTooltip: document.querySelector('#source-tooltip'),
  dateTabs: document.querySelector('#date-tabs'),
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
  state.selectedDate = params.get('date') || null;
  els.search.value = state.query;
}

function writeUrlState() {
  const params = new URLSearchParams();
  if (state.selectedDate) params.set('date', state.selectedDate);
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

function rigaNow() {
  const parts = Object.fromEntries(RIGA_PARTS_FORMATTER.formatToParts(new Date())
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function addDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function availableDates() {
  return state.data?.dates || (state.data?.date ? [state.data.date] : []);
}

function selectedDay() {
  if (!state.data) return null;
  return state.data.days?.[state.selectedDate] || {
    date: state.data.date || rigaNow().date,
    sources: state.data.sources || [],
    warnings: state.data.warnings || [],
    showtimes: state.data.showtimes || []
  };
}

function chooseInitialDate() {
  const dates = availableDates();
  if (dates.includes(state.selectedDate)) return;
  const { date: today, hour } = rigaNow();
  const preferred = hour >= 23 || hour < 3 ? addDays(today, 1) : today;
  state.selectedDate = dates.includes(preferred) ? preferred : dates[0] || null;
}

function tabLabel(date) {
  if (!date) return 'Today';
  const today = rigaNow().date;
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  return date;
}

function renderDateTabs() {
  const dates = availableDates();
  els.dateTabs.hidden = dates.length < 2;
  els.dateTabs.innerHTML = dates.map((date) => {
    const active = date === state.selectedDate;
    return `<button type="button" class="date-tab${active ? ' is-active' : ''}" data-date="${escapeHtml(date)}" aria-pressed="${active}">${escapeHtml(tabLabel(date))}<span>${escapeHtml(DATE_FORMATTER.format(new Date(`${date}T12:00:00Z`)))}</span></button>`;
  }).join('');
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

function imdbUrl(showtime) {
  if (showtime.imdbUrl) return showtime.imdbUrl;
  const query = showtime.originalTitle || showtime.title;
  return `https://www.imdb.com/find/?q=${encodeURIComponent(query)}&s=tt&ttype=ft`;
}

function renderCinemaFilters(showtimes) {
  const names = [...new Set([...KNOWN_CINEMAS, ...showtimes.map((item) => item.cinema).filter(Boolean)])];
  if (state.cinemas.size === 0) state.cinemas = new Set(names);
  else state.cinemas = new Set([...state.cinemas].filter((name) => names.includes(name)));
  els.cinemaOptions.innerHTML = names.map((name) => {
    const checked = state.cinemas.has(name) ? 'checked' : '';
    return `<label class="cinema-choice"><input type="checkbox" value="${escapeHtml(name)}" ${checked}>${escapeHtml(name)}</label>`;
  }).join('');
  updateCinemaSummary();
}

function updateCinemaSummary() {
  const count = state.cinemas.size;
  els.cinemaSummary.textContent = `${count} selected`;
}

function renderWarnings(day) {
  if (!day?.warnings || day.warnings.length === 0) {
    els.warning.hidden = true;
    els.warning.textContent = '';
    return;
  }
  els.warning.hidden = false;
  els.warning.textContent = day.warnings.map((warning) => warning.message || warning.source).join(' · ');
}

function sourceStatusLabel(source) {
  return ({
    fresh: 'up to date',
    cached: 'scheduled update pending',
    stale: 'scheduled update overdue',
    waiting: 'selected date missing'
  })[source.status] || source.status;
}

function formatSourceTime(value) {
  return value ? UPDATED_FORMATTER.format(new Date(value)) : 'no successful update';
}

function renderSourceInfo(day) {
  const sources = day?.sources || [];
  const hasDelayedSource = sources.some((source) => source.status !== 'fresh');
  els.sourceInfo.hidden = !hasDelayedSource;
  if (!hasDelayedSource) return;
  els.sourceTooltip.innerHTML = `
    <strong>Update details · ${escapeHtml(DATE_FORMATTER.format(new Date(`${day.date}T12:00:00Z`)))}</strong>
    <ul>${sources.map((source) => `<li><b>${escapeHtml(source.name)}</b><span>${escapeHtml(sourceStatusLabel(source))} · ${escapeHtml(formatSourceTime(source.lastSuccessAt || source.fetchedAt))}</span></li>`).join('')}</ul>
  `;
}

function visibleShowtimes() {
  const query = normalizeText(state.query);
  const day = selectedDay();
  return (day?.showtimes || []).filter((showtime) => {
    if (showtimeServiceDate(showtime) !== day.date) return false;
    if (!state.cinemas.has(showtime.cinema)) return false;
    if (!query) return true;
    return normalizeText(`${showtime.title} ${showtime.originalTitle}`).includes(query);
  });
}

function render() {
  if (!state.data) return;
  const day = selectedDay();
  renderDateTabs();
  writeUrlState();
  updateCinemaSummary();
  renderWarnings(day);
  renderSourceInfo(day);
  const showtimes = visibleShowtimes();
  els.count.textContent = `${showtimes.length} upcoming session${showtimes.length === 1 ? '' : 's'}`;
  els.list.innerHTML = showtimes.map(renderCard).join('');
  els.emptyTitle.textContent = `No upcoming sessions ${tabLabel(day.date).toLowerCase()}`;
  els.empty.hidden = showtimes.length !== 0;
}

function renderCard(showtime) {
  const age = formatAge(showtime.ageRating);
  const availability = availabilityText(showtime.availability);
  const details = [showtime.language, showtime.genres?.join(', ')].filter(Boolean).map(escapeHtml).join(' | ');
  const meta = [
    renderCinemaName(showtime),
    renderImdb(showtime)
  ].filter(Boolean).join('');
  const poster = showtime.posterUrl
    ? `<img class="poster" src="${escapeHtml(showtime.posterUrl)}" alt="">`
    : `<div class="poster poster-fallback" aria-hidden="true">${escapeHtml((showtime.title || '?').slice(0, 1))}</div>`;

  return `
    <article class="showtime-card${showtime.movieUrl ? ' showtime-card-link' : ''}"${showtime.movieUrl ? ` data-movie-url="${escapeHtml(showtime.movieUrl)}" tabindex="0" role="link" aria-label="Open ${escapeHtml(titleText(showtime))} at ${escapeHtml(showtime.cinema)} in a new tab"` : ''}>
      ${poster}
      <div class="card-main">
        <div class="title-line"><span class="title-text">${escapeHtml(titleText(showtime))}</span>${age ? `<span class="rating">${escapeHtml(age)}</span>` : ''}</div>
        <div class="meta-line">${meta}</div>
        ${details ? `<div class="detail-line">${details}</div>` : ''}
        ${availability ? `<div class="seat-line">${escapeHtml(availability)}</div>` : ''}
      </div>
      <div class="time-block">
        <time class="time" datetime="${escapeHtml(showtime.startTime)}">${escapeHtml(formatTime(showtime.startTime))}</time>
        ${showtime.auditorium ? `<span class="auditorium">${escapeHtml(showtime.auditorium)}</span>` : ''}
      </div>
    </article>
  `;
}

function renderCinemaName(showtime) {
  return `<span class="cinema-name">${escapeHtml(showtime.cinema)}</span>`;
}

function renderImdb(showtime) {
  return `<a class="imdb-link" href="${escapeHtml(imdbUrl(showtime))}" target="_blank" rel="noopener noreferrer" aria-label="Open IMDb in a new tab" title="Open IMDb in a new tab">IMDb</a>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function openMovieFromCard(card) {
  const url = card.dataset.movieUrl;
  if (url) window.open(url, '_blank', 'noopener');
}

els.list.addEventListener('click', (event) => {
  const card = event.target.closest('.showtime-card-link');
  if (!card || event.target.closest('a, button, input, select, textarea')) return;
  openMovieFromCard(card);
});

els.list.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const card = event.target.closest('.showtime-card-link');
  if (!card || event.target.closest('a, button, input, select, textarea')) return;
  event.preventDefault();
  openMovieFromCard(card);
});

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

els.dateTabs.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-date]');
  if (!button || !availableDates().includes(button.dataset.date)) return;
  state.selectedDate = button.dataset.date;
  render();
});

async function loadData() {
  try {
    const response = await fetch(DATA_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    els.status.textContent = formatUpdated(state.data.generatedAt);
    chooseInitialDate();
    renderCinemaFilters(Object.values(state.data.days || {}).flatMap((day) => day.showtimes || []).concat(state.data.showtimes || []));
    render();
  } catch (error) {
    els.status.textContent = 'Could not load schedule data';
    els.warning.hidden = false;
    els.warning.textContent = error.message;
  }
}

fromUrlState();
await loadData();
