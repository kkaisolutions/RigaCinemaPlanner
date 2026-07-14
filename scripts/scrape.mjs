import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import vm from 'node:vm';
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';

const TIMEZONE = 'Europe/Riga';
const execFileAsync = promisify(execFile);
const OUTPUT_PATH = new URL('../site/data/schedule.json', import.meta.url);
const SOURCES = {
  forumSchedule: 'https://www.forumcinemas.lv/xml/Schedule/?area=1011',
  forumEvents: 'https://www.forumcinemas.lv/xml/Events/?area=1011&includePictures=true&includeLinks=true',
  apolloSchedule: 'https://www.apollokino.lv/schedule?theatreAreaID=1014',
  apolloDominaSchedule: 'https://www.apollokino.lv/schedule?theatreAreaID=1015',
  cinamonSchedule: 'https://cinamonkino.com/akropole-alfa/saraksts/lv'
};
const CINAMON_API = 'https://cinamonkino.com/api/schedule';
const CINAMON_CINEMA_ID = '1633064176';

// Published sellable seat capacity by Apollo auditorium. These values are
// maintained separately from the live free-seat count because Apollo exposes
// the latter on its schedule but not a percentage.
const APOLLO_CAPACITIES = {
  'Apollo Akropole': {
    '1. IMAX zāle': 277,
    '2. zāle': 227,
    '3. zāle Radio SWH': 109,
    '4. zāle Kronenbourg 1664 Blanc': 171,
    '5. zāle': 90,
    '6. zāle ApolloStar': 50,
    '7. zāle Cinema Restaurant': 40,
    '8. zāle Cinema Restaurant': 40,
    '9. zāle': 127
  },
  'Apollo Domina': {
    '1. zāle': 70,
    '2. zāle': 70,
    '3. zāle': 70
  }
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true
});

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const generatedAt = options.generatedAt ? new Date(options.generatedAt) : new Date();
  if (Number.isNaN(generatedAt.valueOf())) throw new Error('Invalid --generated-at value');
  const dates = requestedDates(options, generatedAt);
  const previous = options.previous ? JSON.parse(await readFile(options.previous, 'utf8')) : null;
  const results = await collectSourceResults({ dates, options });
  const payload = mergeSourceResults({ dates, generatedAt, previous, results });
  const outputPath = options.output || OUTPUT_PATH.pathname;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${payload.showtimes.length} upcoming showtimes for ${dates.join(', ')}`);
  console.log(`Sources: ${dates.map((date) => `${date} ${payload.days[date].sources.map((source) => `${source.id}=${source.status}:${source.count}`).join(', ')}`).join(' | ')}`);
  return payload;
}

async function runSource(id, task) {
  try {
    return { ok: true, value: await task() };
  } catch (error) {
    return { ok: false, id, error };
  }
}

async function collectSourceResults({ dates, options }) {
  const results = new Map();
  if (!options.skipForum) {
    const forum = await runSource('forum', () => scrapeForum(dates));
    for (const date of dates) results.set(resultKey(date, 'forum'), forum.ok
      ? { ok: true, value: sourceResult('forum', forum.value.get(date) || [], SOURCES.forumSchedule) }
      : forum);
  }

  for (const date of dates) {
    if (!options.forumOnly) {
      const apolloFiles = [options.apolloFiles.get(date), options.apolloDominaFiles.get(date)].filter(Boolean);
      if (apolloFiles.length > 0) {
        results.set(resultKey(date, 'apollo'), await runSource('apollo', async () => {
          const pages = await Promise.all(apolloFiles.map((path) => readFile(path, 'utf8')));
          return sourceResult('apollo', dedupeShowtimes(pages.flatMap((page) => parseApolloSchedule(page, date))), SOURCES.apolloSchedule);
        }));
      } else if (!options.hasLocalAssets) {
        results.set(resultKey(date, 'apollo'), await runSource('apollo', () => scrapeApollo(date)));
      }

      const cinamonFile = options.cinamonFiles.get(date);
      if (cinamonFile) {
        results.set(resultKey(date, 'cinamon'), await runSource('cinamon', async () => sourceResult('cinamon', parseCinamonSchedule(await readFile(cinamonFile, 'utf8'), date), SOURCES.cinamonSchedule)));
      } else if (!options.hasLocalAssets) {
        results.set(resultKey(date, 'cinamon'), await runSource('cinamon', () => scrapeCinamon(date)));
      }
    }
  }
  return results;
}

export function mergeSourceResults({ date, dates: requested = null, generatedAt = new Date(), previous = null, results = new Map() }) {
  const dates = requested || [date];
  if (!dates.length) throw new Error('At least one service date is required');
  const generatedAtIso = generatedAt.toISOString();
  const previousDays = previous?.days || (previous?.date ? {
    [previous.date]: { date: previous.date, sources: previous.sources || [], warnings: previous.warnings || [], showtimes: previous.showtimes || [] }
  } : {});
  const days = Object.fromEntries(dates.map((serviceDate) => [serviceDate, mergeDay({ serviceDate, generatedAt, generatedAtIso, previousDay: previousDays[serviceDate], results })]));
  const primary = days[dates[0]];

  return {
    generatedAt: generatedAtIso,
    timezone: TIMEZONE,
    date: dates[0],
    dates,
    days,
    // Keep top-level aliases for existing consumers while the site transitions
    // to date tabs.
    sources: primary.sources,
    warnings: primary.warnings,
    showtimes: primary.showtimes
  };
}

function mergeDay({ serviceDate, generatedAt, generatedAtIso, previousDay, results }) {
  const previousSources = new Map((previousDay?.sources || []).map((source) => [source.id, source]));
  const previousShowtimes = previousDay?.showtimes || [];
  const warnings = [];
  const sources = [];
  const showtimes = [];
  for (const id of ['forum', 'apollo', 'cinamon']) {
    const result = results.get(resultKey(serviceDate, id));
    const oldSource = previousSources.get(id);
    const oldShowtimes = previousShowtimes.filter((showtime) => showtime.source === id);
    if (result?.ok) {
      sources.push({ ...result.value.source, status: 'fresh', dataDate: serviceDate, fetchedAt: generatedAtIso, lastSuccessAt: generatedAtIso, error: null });
      showtimes.push(...result.value.showtimes);
      continue;
    }

    const error = result ? sourceFailureMessage(id, result.error) : null;
    const lastSuccessAt = oldSource?.lastSuccessAt || oldSource?.fetchedAt || null;
    const ageMs = lastSuccessAt ? generatedAt - new Date(lastSuccessAt) : Number.POSITIVE_INFINITY;
    const dataDate = oldSource?.dataDate || previousDay?.date || null;
    // An empty result is valid only after this source has successfully been
    // acquired for *this* date. Yesterday's data must not mask a missing
    // morning update for today's schedule.
    const hasCurrentDaySnapshot = dataDate === serviceDate && Boolean(lastSuccessAt);
    const status = hasCurrentDaySnapshot ? (ageMs <= 90 * 60 * 1000 ? 'cached' : 'stale') : 'waiting';
    const source = { id, name: sourceName(id), url: sourceUrl(id), status, dataDate, count: oldShowtimes.length, fetchedAt: oldSource?.fetchedAt || null, lastSuccessAt, error };
    sources.push(source);
    showtimes.push(...oldShowtimes);
    if (status === 'waiting') warnings.push({ source: id, message: sourceWarning(source, serviceDate) });
  }

  return {
    date: serviceDate,
    sources,
    warnings,
    showtimes: dedupeShowtimes(showtimes)
      .filter((showtime) => showtime.movieUrl)
      .filter((showtime) => showtime.serviceDate === serviceDate)
      .filter((showtime) => new Date(showtime.startTime) > generatedAt)
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
  };
}

async function scrapeForum(dates) {
  const [scheduleText, eventsText] = await Promise.all([
    fetchText(SOURCES.forumSchedule),
    fetchText(SOURCES.forumEvents)
  ]);
  const eventsById = parseForumEvents(eventsText);
  return new Map(dates.map((date) => [date, parseForumSchedule(scheduleText, eventsById, date)]));
}

export function parseForumEvents(xmlText) {
  const parsed = xmlParser.parse(xmlText);
  const events = asArray(parsed?.Events?.Event);
  const byId = new Map();
  for (const event of events) {
    const links = asArray(event.Links?.Link);
    const pictures = asArray(event.Pictures?.Picture);
    const imdbUrl = links.find((link) => /imdb/i.test(link.Title || link.Location || ''))?.Location || '';
    const posterUrl =
      pictures.find((picture) => picture.PictureType === 'EventPosterExtraExtraLargeImage')?.Location ||
      pictures.find((picture) => picture.PictureType === 'EventPosterExtraLargeImage')?.Location ||
      pictures.find((picture) => picture.PictureType === 'EventPosterLargeImage')?.Location ||
      event.Images?.EventLargeImagePortrait ||
      '';
    byId.set(String(event.ID), { imdbUrl: absolutize(posterSafe(imdbUrl), 'https://www.forumcinemas.lv'), posterUrl });
  }
  return byId;
}

export function parseForumSchedule(xmlText, eventsById = new Map(), date = rigaDate()) {
  const parsed = xmlParser.parse(xmlText);
  const shows = asArray(parsed?.Schedule?.Shows?.Show);
  const dates = dateList(date);
  return shows
    .filter((show) => dates.includes(serviceDateFrom(show.dtAccounting)))
    .filter((show) => show.EventType === 'Movie')
    .map((show) => {
      const eventMeta = eventsById.get(String(show.EventID)) || {};
      return normalizeShowtime({
        id: `forum-${show.ID}`,
        source: 'forum',
        cinema: 'Forum Cinemas',
        title: show.Title,
        originalTitle: show.OriginalTitle,
        posterUrl: eventMeta.posterUrl || show.Images?.EventLargeImagePortrait || '',
        imdbUrl: eventMeta.imdbUrl || '',
        ageRating: show.RatingLabel || show.Rating,
        genres: splitList(show.Genres),
        startTime: withRigaOffset(show.dttmShowStart),
        serviceDate: serviceDateFrom(show.dtAccounting),
        auditorium: clean(show.TheatreAuditorium),
        language: show.SpokenLanguage?.Name || '',
        movieUrl: absolutize(show.EventURL, 'https://www.forumcinemas.lv'),
        availability: parseForumAvailability(show)
      });
    });
}

async function scrapeApollo(date) {
  const scheduleUrl = apolloScheduleUrl(SOURCES.apolloSchedule, date);
  const scheduleText = await fetchText(scheduleUrl, {
    headers: {
      referer: 'https://www.apollokino.lv/'
    }
  });
  return sourceResult('apollo', parseApolloSchedule(scheduleText, date), scheduleUrl);
}

export function parseApolloSchedule(htmlText, date = rigaDate()) {
  const $ = cheerio.load(htmlText);
  const showtimes = [];
  const dates = dateList(date);
  $('.schedule-card').each((_, card) => {
    const node = $(card);
    const movieUrl = absolutize(node.find('.schedule-card__title-container a').first().attr('href'), 'https://www.apollokino.lv');
    const ticketUrl = node.find('a[href*="/websales/show/"]').first().attr('href');
    const showId = ticketUrl?.match(/show\/(\d+)/)?.[1] || hashId(movieUrl + node.text());
    const datetime = node.find('time[datetime]').first().attr('datetime') || '';
    const serviceDate = dates.find((candidate) => datetime.startsWith(candidate));
    if (!serviceDate) return;
    const image = firstSrcsetUrl(node.find('.schedule-card__image img').attr('data-srcset'));
    const cinemaRaw = clean(node.find('.schedule-card__cinema--desktop').first().text());
    const freeSeats = numberFromText(node.find('.schedule-card__option-seats .schedule-card__option-title').first().text());
    const cinema = shortCinemaName(cinemaRaw);
    const auditorium = clean(node.find('.schedule-card__hall').first().text());
    const totalSeats = APOLLO_CAPACITIES[cinema]?.[auditorium] ?? null;
    showtimes.push(normalizeShowtime({
      id: `apollo-${showId}`,
      source: 'apollo',
      cinema,
      title: clean(node.find('.schedule-card__title').first().text()),
      originalTitle: clean(node.find('.schedule-card__secondary-title').first().text()),
      posterUrl: absolutize(image, 'https://www.apollokino.lv'),
      imdbUrl: '',
      ageRating: clean(node.find('.schedule-card__tag').first().text()),
      genres: node.find('.schedule-card__genre').toArray().map((genre) => clean($(genre).text()).replace(/,$/, '')).filter(Boolean),
      startTime: withRigaOffset(datetime),
      serviceDate,
      auditorium,
      language: findOptionValue($, node, 'Valoda'),
      movieUrl,
      availability: {
        freeSeats,
        totalSeats,
        takenSeats: totalSeats != null && freeSeats != null ? totalSeats - freeSeats : null,
        occupiedPercent: totalSeats != null && freeSeats != null ? percentage(totalSeats - freeSeats, totalSeats) : null
      }
    }));
  });
  return showtimes;
}

export function parseApolloMovieDetail(htmlText) {
  const $ = cheerio.load(htmlText);
  const posterUrl = firstSrcsetUrl($('.media-chess__image img, img[data-srcset*="poster"]').first().attr('data-srcset'));
  let ageRating = '';
  $('.specs__item').each((_, item) => {
    const node = $(item);
    if (/Reitings/i.test(node.find('.specs__key').text())) {
      ageRating = clean(node.find('.specs__value').text());
    }
  });
  return {
    posterUrl: absolutize(posterUrl, 'https://www.apollokino.lv'),
    ageRating
  };
}

async function scrapeCinamon(date) {
  const scheduleUrl = cinamonScheduleUrl(date);
  const scheduleText = await fetchText(scheduleUrl, { headers: { accept: 'application/json' } });
  return sourceResult('cinamon', parseCinamonSchedule(scheduleText, date), scheduleUrl);
}

export function parseCinamonSchedule(htmlText, date = rigaDate()) {
  const trimmed = String(htmlText).trim();
  const directSchedule = trimmed.startsWith('[') ? JSON.parse(trimmed) : null;
  const nuxt = directSchedule ? null : extractNuxtState(htmlText);
  const schedule = directSchedule || nuxt?.data?.[0]?.schedule || [];
  const dates = dateList(date);
  return schedule
    .filter((item) => dates.includes(item.date) || dates.some((candidate) => String(item.showtime || '').startsWith(candidate)))
    .filter((item) => item.film)
    .map((item) => {
      const film = item.film;
      const serviceDate = dates.find((candidate) => item.date === candidate || String(item.showtime || '').startsWith(candidate));
      const totalSeats = item.seats_left?.seats_total ?? item.screen?.seats_totall ?? null;
      const freeSeats = item.seats_left?.seats_left ?? null;
      return normalizeShowtime({
        id: `cinamon-${item.pid || item.hash}`,
        source: 'cinamon',
        cinema: 'Cinamon Alfa',
        title: film.name,
        originalTitle: film.original_name,
        posterUrl: film.poster || film.cover || '',
        imdbRating: film.imdb_rating || '',
        imdbUrl: film.imdb_url || film.imdb_link || film.imdb || '',
        ageRating: film.rating || '',
        genres: film.genre?.name ? [film.genre.name] : [],
        startTime: withRigaOffset(item.showtime),
        serviceDate,
        auditorium: item.screen_name,
        language: item.audio_label || '',
        movieUrl: `https://cinamonkino.com/akropole-alfa/filma/${film.slug || film.coded_film_id}/lv`,
        availability: {
          totalSeats,
          freeSeats,
          takenSeats: totalSeats != null && freeSeats != null ? Number(totalSeats) - Number(freeSeats) : null,
          occupiedPercent: totalSeats != null && freeSeats != null ? percentage(Number(totalSeats) - Number(freeSeats), Number(totalSeats)) : null
        }
      });
    });
}

function parseForumAvailability(show) {
  const pair = findSeatPair(show);
  const totalSeats = pair?.total ?? firstNumber(show, ['SeatsTotal', 'TotalSeats', 'SeatCount', 'Capacity']);
  const freeSeats = pair?.free ?? firstNumber(show, ['SeatsAvailable', 'AvailableSeats', 'FreeSeats']);
  return {
    totalSeats,
    freeSeats,
    takenSeats: totalSeats != null && freeSeats != null ? totalSeats - freeSeats : null,
    occupiedPercent: totalSeats != null && freeSeats != null ? percentage(totalSeats - freeSeats, totalSeats) : null
  };
}

function findSeatPair(value) {
  if (typeof value === 'string') {
    const match = value.match(/(?:^|\D)(\d+)\s*\/\s*(\d+)(?:\D|$)/);
    return match ? { free: Number(match[1]), total: Number(match[2]) } : null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const child of Object.values(value)) {
    const pair = findSeatPair(child);
    if (pair) return pair;
  }
  return null;
}

export function extractNuxtState(htmlText) {
  const match = htmlText.match(/window\.__NUXT__=\(function[\s\S]*?\)\);<\/script>/);
  if (!match) return null;
  const code = match[0].replace(/<\/script>$/, '');
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(code, context, { timeout: 1000 });
  return context.window.__NUXT__;
}

function normalizeShowtime(input) {
  return {
    id: String(input.id),
    source: input.source,
    cinema: input.cinema,
    title: clean(input.title),
    originalTitle: clean(input.originalTitle),
    posterUrl: clean(input.posterUrl),
    imdbRating: clean(input.imdbRating),
    imdbUrl: clean(input.imdbUrl),
    ageRating: clean(input.ageRating),
    genres: asArray(input.genres).map(clean).filter(Boolean),
    startTime: input.startTime,
    serviceDate: clean(input.serviceDate) || serviceDateFrom(input.startTime),
    auditorium: clean(input.auditorium),
    language: clean(input.language),
    movieUrl: clean(input.movieUrl),
    availability: cleanAvailability(input.availability)
  };
}

function cleanAvailability(value = {}) {
  const availability = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === '' || raw == null || Number.isNaN(raw)) continue;
    availability[key] = typeof raw === 'number' ? raw : Number(raw);
  }
  return availability;
}

function findOptionValue($, node, label) {
  let value = '';
  node.find('.schedule-card__option').each((_, option) => {
    const optionNode = $(option);
    if (clean(optionNode.find('.schedule-card__option-label').text()) === label) {
      value = clean(optionNode.find('.schedule-card__option-title').first().text());
    }
  });
  return value;
}

function firstSrcsetUrl(srcset = '') {
  const first = srcset.split(',')[0]?.trim().split(/\s+/)[0] || '';
  return first;
}

function absolutize(value, base) {
  if (!value) return '';
  if (value.startsWith('//')) return `https:${value}`;
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
}

function posterSafe(value) {
  return clean(value).replace(/\?ref_.+$/, '');
}

function shortCinemaName(value) {
  const name = clean(value);
  if (/Akropole/i.test(name)) return 'Apollo Akropole';
  if (/Domina/i.test(name)) return 'Apollo Domina';
  if (/Plaza/i.test(name)) return 'Apollo Plaza';
  return name || 'Apollo Kino';
}

function withRigaOffset(value) {
  if (!value) return '';
  if (/[zZ]|[+-]\d\d:\d\d$/.test(value)) return value;
  const datePart = value.includes('T') ? value : value.replace(' ', 'T');
  return `${datePart}${rigaOffset(datePart)}`;
}

function rigaOffset(isoLike) {
  const guessedUtc = new Date(`${isoLike}Z`);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    timeZoneName: 'longOffset'
  }).formatToParts(guessedUtc);
  return parts.find((part) => part.type === 'timeZoneName')?.value.replace('GMT', '') || '+02:00';
}

function rigaDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(value);
}

function requestedDates(options, generatedAt) {
  if (options.dates?.length) return options.dates;
  const first = options.date || rigaDate(generatedAt);
  return Array.from({ length: options.days || 1 }, (_, index) => addRigaDays(first, index));
}

function resultKey(date, id) {
  return `${date}:${id}`;
}

function apolloScheduleUrl(base, date) {
  const url = new URL(base);
  const [year, month, day] = date.split('-');
  url.searchParams.set('2958-dt', `${day}.${month}.${year}`);
  return url.toString();
}

function cinamonScheduleUrl(date) {
  const url = new URL(CINAMON_API);
  url.searchParams.set('cinema_id', CINAMON_CINEMA_ID);
  url.searchParams.set('timezone', 'Europe/Riga');
  url.searchParams.set('locale', 'lv');
  url.searchParams.set('date', date);
  url.searchParams.set('include', 'film.genre,screen,relatedAttributes,seatsLeft');
  return url.toString();
}

function splitList(value = '') {
  return clean(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function clean(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function numberFromText(value) {
  const match = clean(value).match(/\d+/);
  return match ? Number(match[0]) : null;
}

function dateList(value) {
  return [...new Set(asArray(value).map(String).filter(Boolean))];
}

function serviceDateFrom(value) {
  return String(value || '').slice(0, 10);
}

function addRigaDays(date, days) {
  const [year, month, day] = String(date).split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

function firstNumber(object, keys) {
  for (const key of keys) {
    const value = Number(object?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function percentage(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 100);
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function hashId(value) {
  let hash = 0;
  for (const char of String(value)) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

function sourceFailureMessage(source, error) {
  const name = source === 'apollo' ? 'Apollo Kino' : source === 'cinamon' ? 'Cinamon Alfa' : source;
  const message = String(error?.message || error || 'unknown error');
  if (/HTTP 403/.test(message)) return `${name} blocked the GitHub Actions runner (HTTP 403).`;
  if (/timed out|fetch failed|Connection timed out/i.test(message)) return `${name} could not be reached from the GitHub Actions runner.`;
  return `${name} failed: ${message.split('\n')[0]}`;
}

function sourceResult(id, showtimes, url) {
  return {
    source: {
      id,
      name: sourceName(id),
      url,
      count: showtimes.length
    },
    showtimes
  };
}

function sourceName(id) {
  return ({ forum: 'Forum Cinemas', apollo: 'Apollo Kino', cinamon: 'Cinamon Alfa' })[id] || id;
}

function sourceUrl(id) {
  return ({ forum: SOURCES.forumSchedule, apollo: SOURCES.apolloSchedule, cinamon: SOURCES.cinamonSchedule })[id] || '';
}

function sourceWarning(source, serviceDate) {
  if (source.status === 'waiting') return `Waiting for ${serviceDate} ${source.name} update.`;
  const detail = source.error ? ` ${source.error}` : '';
  return `${source.name} data is stale.${detail}`;
}

function dedupeShowtimes(showtimes) {
  const seen = new Set();
  return showtimes.filter((showtime) => {
    const key = showtime.id || `${showtime.source}|${showtime.movieUrl}|${showtime.startTime}|${showtime.cinema}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseArguments(argv) {
  const options = { apolloFiles: new Map(), apolloDominaFiles: new Map(), cinamonFiles: new Map() };
  const aliases = {
    '--output': 'output',
    '--previous': 'previous',
    '--date': 'date',
    '--dates': 'dates',
    '--days': 'days',
    '--generated-at': 'generatedAt',
    '--apollo-file': 'apolloFiles',
    '--apollo-domina-file': 'apolloDominaFiles',
    '--cinamon-file': 'cinamonFiles'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--forum-only') options.forumOnly = true;
    else if (argument === '--skip-forum') options.skipForum = true;
    else if (aliases[argument]) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
      const key = aliases[argument];
      if (key === 'dates') options.dates = dateList(value.split(','));
      else if (key === 'days') {
        options.days = Number(value);
        if (!Number.isInteger(options.days) || options.days < 1 || options.days > 7) throw new Error('--days must be an integer from 1 to 7');
      } else if (key.endsWith('Files')) {
        const separator = value.indexOf(':');
        const hasExplicitDate = separator === 10 && /^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, separator));
        const assetDate = hasExplicitDate ? value.slice(0, separator) : options.date || rigaDate();
        const path = hasExplicitDate ? value.slice(separator + 1) : value;
        options[key].set(assetDate, path);
        options.hasLocalAssets = true;
      } else options[key] = value;
      index += 1;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'lv-LV,lv;q=0.9,en-US;q=0.8,en;q=0.7',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'sec-ch-ua': '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1'
};

async function fetchText(url, options = {}) {
  const attempts = options.attempts ?? 2;
  const timeoutMs = options.timeoutMs ?? 20000;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: {
          ...BROWSER_HEADERS,
          ...options.headers
        },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(attempt * 750);
    } finally {
      clearTimeout(timeout);
    }
  }

  if (options.curlFallback !== false) {
    try {
      return await fetchTextWithCurl(url, { ...options, timeoutMs });
    } catch (error) {
      throw new Error(`${lastError?.message || lastError}; curl fallback failed: ${error.message}`);
    }
  }

  throw lastError;
}

async function fetchTextWithCurl(url, options = {}) {
  const timeoutSeconds = Math.ceil((options.timeoutMs ?? 20000) / 1000);
  const headers = {
    ...BROWSER_HEADERS,
    ...options.headers
  };
  const args = [
    '-L',
    '--silent',
    '--show-error',
    '--fail',
    '--ipv4',
    '--http1.1',
    '--compressed',
    '--max-time',
    String(timeoutSeconds)
  ];

  for (const [name, value] of Object.entries(headers)) {
    args.push('-H', `${headerCase(name)}: ${value}`);
  }
  args.push(url);

  const { stdout } = await execFileAsync('curl', args, {
    maxBuffer: 20 * 1024 * 1024
  });
  return stdout;
}

function headerCase(value) {
  return value.split('-').map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join('-');
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
