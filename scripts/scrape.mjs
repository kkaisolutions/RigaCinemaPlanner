import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
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
  cinamonSchedule: 'https://cinamonkino.com/akropole-alfa/saraksts/lv'
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true
});

export async function main() {
  const generatedAt = new Date();
  const date = rigaDate(generatedAt);
  const scrapers = [
    { id: 'forum', run: () => scrapeForum(date) },
    { id: 'apollo', run: () => scrapeApollo(date) },
    { id: 'cinamon', run: () => scrapeCinamon(date) }
  ];
  const results = await Promise.all(scrapers.map(async (scraper) => {
    try {
      return { status: 'fulfilled', value: await scraper.run() };
    } catch (error) {
      return { status: 'rejected', source: scraper.id, reason: error };
    }
  }));

  const showtimes = [];
  const sources = [];
  const warnings = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      showtimes.push(...result.value.showtimes);
      sources.push(result.value.source);
      if (result.value.warnings) warnings.push(...result.value.warnings);
    } else {
      warnings.push({
        source: result.source,
        message: sourceFailureMessage(result.source, result.reason)
      });
    }
  }

  const payload = {
    generatedAt: generatedAt.toISOString(),
    timezone: TIMEZONE,
    date,
    sources,
    warnings,
    showtimes: showtimes
      .filter((showtime) => showtime.movieUrl)
      .filter((showtime) => new Date(showtime.startTime) > generatedAt)
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
  };

  await mkdir(dirname(OUTPUT_PATH.pathname), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${payload.showtimes.length} upcoming showtimes for ${date}`);
  console.log(`Sources: ${payload.sources.map((source) => `${source.id}=${source.count}`).join(', ') || 'none'}`);
  if (payload.warnings.length) console.warn(`Warnings: ${payload.warnings.map((warning) => `${warning.source}: ${warning.message}`).join(' | ')}`);
}

async function scrapeForum(date) {
  const [scheduleText, eventsText] = await Promise.all([
    fetchText(SOURCES.forumSchedule),
    fetchText(SOURCES.forumEvents)
  ]);
  const eventsById = parseForumEvents(eventsText);
  const showtimes = parseForumSchedule(scheduleText, eventsById, date);
  return {
    source: {
      id: 'forum',
      name: 'Forum Cinemas',
      url: SOURCES.forumSchedule,
      status: 'ok',
      count: showtimes.length
    },
    showtimes
  };
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
  return shows
    .filter((show) => String(show.dtAccounting || '').startsWith(date))
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
        auditorium: clean(show.TheatreAuditorium),
        language: show.SpokenLanguage?.Name || '',
        movieUrl: absolutize(show.EventURL, 'https://www.forumcinemas.lv'),
        availability: {}
      });
    });
}

async function scrapeApollo(date) {
  const scheduleText = await fetchText(SOURCES.apolloSchedule, {
    headers: {
      referer: 'https://www.apollokino.lv/'
    }
  });
  const baseShowtimes = parseApolloSchedule(scheduleText, date);
  const uniqueMovieUrls = [...new Set(baseShowtimes.map((showtime) => showtime.movieUrl).filter(Boolean))];
  const detailEntries = await Promise.all(uniqueMovieUrls.map(async (movieUrl) => {
    try {
      return [movieUrl, parseApolloMovieDetail(await fetchText(movieUrl, {
        headers: {
          referer: SOURCES.apolloSchedule
        }
      }))];
    } catch {
      return [movieUrl, {}];
    }
  }));
  const details = new Map(detailEntries);
  const showtimes = baseShowtimes.map((showtime) => ({
    ...showtime,
    posterUrl: details.get(showtime.movieUrl)?.posterUrl || showtime.posterUrl,
    ageRating: details.get(showtime.movieUrl)?.ageRating || showtime.ageRating
  }));
  return {
    source: {
      id: 'apollo',
      name: 'Apollo Kino',
      url: SOURCES.apolloSchedule,
      status: 'ok',
      count: showtimes.length
    },
    showtimes
  };
}

export function parseApolloSchedule(htmlText, date = rigaDate()) {
  const $ = cheerio.load(htmlText);
  const showtimes = [];
  $('.schedule-card').each((_, card) => {
    const node = $(card);
    const movieUrl = absolutize(node.find('.schedule-card__title-container a').first().attr('href'), 'https://www.apollokino.lv');
    const ticketUrl = node.find('a[href*="/websales/show/"]').first().attr('href');
    const showId = ticketUrl?.match(/show\/(\d+)/)?.[1] || hashId(movieUrl + node.text());
    const datetime = node.find('time[datetime]').first().attr('datetime') || '';
    if (!datetime.startsWith(date)) return;
    const image = firstSrcsetUrl(node.find('.schedule-card__image img').attr('data-srcset'));
    const cinemaRaw = clean(node.find('.schedule-card__cinema--desktop').first().text());
    const graphValue = Number(node.find('.js-graph').first().attr('data-value'));
    const freeSeats = numberFromText(node.find('.schedule-card__option-seats .schedule-card__option-title').first().text());
    showtimes.push(normalizeShowtime({
      id: `apollo-${showId}`,
      source: 'apollo',
      cinema: shortCinemaName(cinemaRaw),
      title: clean(node.find('.schedule-card__title').first().text()),
      originalTitle: clean(node.find('.schedule-card__secondary-title').first().text()),
      posterUrl: absolutize(image, 'https://www.apollokino.lv'),
      imdbUrl: '',
      ageRating: clean(node.find('.schedule-card__tag').first().text()),
      genres: node.find('.schedule-card__genre').toArray().map((genre) => clean($(genre).text()).replace(/,$/, '')).filter(Boolean),
      startTime: withRigaOffset(datetime),
      auditorium: clean(node.find('.schedule-card__hall').first().text()),
      language: findOptionValue($, node, 'Valoda'),
      movieUrl,
      availability: {
        freeSeats,
        occupiedPercent: Number.isFinite(graphValue) ? graphValue : null
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
  const htmlText = await fetchText(SOURCES.cinamonSchedule);
  const showtimes = parseCinamonSchedule(htmlText, date);
  return {
    source: {
      id: 'cinamon',
      name: 'Cinamon Alfa',
      url: SOURCES.cinamonSchedule,
      status: 'ok',
      count: showtimes.length
    },
    showtimes
  };
}

export function parseCinamonSchedule(htmlText, date = rigaDate()) {
  const nuxt = extractNuxtState(htmlText);
  const schedule = nuxt?.data?.[0]?.schedule || [];
  return schedule
    .filter((item) => item.date === date || String(item.showtime || '').startsWith(date))
    .filter((item) => item.film)
    .map((item) => {
      const film = item.film;
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
        ageRating: film.rating || '',
        genres: film.genre?.name ? [film.genre.name] : [],
        startTime: withRigaOffset(item.showtime),
        auditorium: item.screen_name,
        language: item.audio_label || '',
        movieUrl: `https://cinamonkino.com/akropole-alfa/filma/${film.slug || film.coded_film_id}/lv`,
        availability: {
          totalSeats,
          freeSeats,
          takenSeats: totalSeats != null && freeSeats != null ? Number(totalSeats) - Number(freeSeats) : null
        }
      });
    });
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
