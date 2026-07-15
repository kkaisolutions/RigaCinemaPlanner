import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractNuxtState,
  mergeSourceResults,
  parseApolloMovieDetail,
  parseApolloSchedule,
  parseCinamonSchedule,
  parseForumEvents,
  parseForumPage,
  parseForumSchedule
} from '../scripts/scrape.mjs';

test('keeps a current-day source snapshot stale after 90 minutes without a main warning', () => {
  const previous = {
    date: '2026-06-27',
    sources: [{ id: 'apollo', dataDate: '2026-06-27', fetchedAt: '2026-06-27T07:00:00.000Z', lastSuccessAt: '2026-06-27T07:00:00.000Z' }],
    showtimes: [{ id: 'apollo-1', source: 'apollo', cinema: 'Apollo Akropole', movieUrl: 'https://example.test', serviceDate: '2026-06-27', startTime: '2026-06-27T13:00:00+03:00' }]
  };
  const payload = mergeSourceResults({
    date: '2026-06-27',
    generatedAt: new Date('2026-06-27T09:00:00.000Z'),
    previous,
    results: new Map()
  });
  const apollo = payload.sources.find((source) => source.id === 'apollo');
  assert.equal(apollo.status, 'stale');
  assert.equal(payload.showtimes.length, 1);
  assert.equal(payload.warnings.some((warning) => warning.source === 'apollo'), false);
});

test('keeps a successful zero-session source cached without a waiting warning', () => {
  const previous = {
    date: '2026-06-27',
    sources: [{ id: 'forum', dataDate: '2026-06-27', fetchedAt: '2026-06-27T20:00:00.000Z', lastSuccessAt: '2026-06-27T20:00:00.000Z' }],
    showtimes: []
  };
  const payload = mergeSourceResults({
    date: '2026-06-27',
    generatedAt: new Date('2026-06-27T20:30:00.000Z'),
    previous,
    results: new Map()
  });
  const forum = payload.sources.find((source) => source.id === 'forum');
  assert.equal(forum.status, 'cached');
  assert.equal(payload.warnings.some((warning) => warning.source === 'forum'), false);
});

test('warns when a source has not yet acquired data for the current day', () => {
  const previous = {
    date: '2026-06-26',
    sources: [{ id: 'cinamon', dataDate: '2026-06-26', fetchedAt: '2026-06-26T20:00:00.000Z', lastSuccessAt: '2026-06-26T20:00:00.000Z' }],
    showtimes: []
  };
  const payload = mergeSourceResults({
    date: '2026-06-27',
    generatedAt: new Date('2026-06-27T05:15:00.000Z'),
    previous,
    results: new Map()
  });
  const cinamon = payload.sources.find((source) => source.id === 'cinamon');
  assert.equal(cinamon.status, 'waiting');
  assert.match(payload.warnings.find((warning) => warning.source === 'cinamon').message, /waiting/i);
});

test('keeps Today and Tomorrow source snapshots independently', () => {
  const previous = {
    dates: ['2026-06-27', '2026-06-28'],
    days: {
      '2026-06-27': {
        date: '2026-06-27',
        sources: [{ id: 'apollo', dataDate: '2026-06-27', lastSuccessAt: '2026-06-27T18:00:00.000Z' }],
        showtimes: [{ id: 'apollo-today', source: 'apollo', cinema: 'Apollo Akropole', movieUrl: 'https://example.test/today', serviceDate: '2026-06-27', startTime: '2026-06-27T21:00:00+03:00' }]
      },
      '2026-06-28': {
        date: '2026-06-28',
        sources: [{ id: 'apollo', dataDate: '2026-06-28', lastSuccessAt: '2026-06-27T18:00:00.000Z' }],
        showtimes: [{ id: 'apollo-tomorrow', source: 'apollo', cinema: 'Apollo Akropole', movieUrl: 'https://example.test/tomorrow', serviceDate: '2026-06-28', startTime: '2026-06-28T11:00:00+03:00' }]
      }
    }
  };
  const payload = mergeSourceResults({
    dates: ['2026-06-27', '2026-06-28'],
    generatedAt: new Date('2026-06-27T17:00:00.000Z'),
    previous,
    results: new Map()
  });
  assert.equal(payload.days['2026-06-27'].showtimes[0].id, 'apollo-today');
  assert.equal(payload.days['2026-06-28'].showtimes[0].id, 'apollo-tomorrow');
  assert.equal(payload.days['2026-06-27'].warnings.some((warning) => warning.source === 'apollo'), false);
  assert.equal(payload.days['2026-06-28'].warnings.some((warning) => warning.source === 'apollo'), false);
});

test('parses Forum schedule with language and auditorium', () => {
  const events = parseForumEvents(`<?xml version="1.0"?>
    <Events><Event><ID>304667</ID><Links><Link><Title>IMDB</Title><Location>https://www.imdb.com/title/tt123/</Location></Link></Links></Event></Events>`);
  const items = parseForumSchedule(`<?xml version="1.0"?>
    <Schedule><Shows><Show>
      <ID>433940</ID><dtAccounting>2026-06-27T00:00:00</dtAccounting><dttmShowStart>2026-06-27T11:05:00</dttmShowStart>
      <EventID>304667</EventID><Title>Rotaļlietu stāsts 5</Title><OriginalTitle>Toy Story 5</OriginalTitle>
      <RatingLabel>U</RatingLabel><EventType>Movie</EventType><Genres>Piedzīvojumi, Komēdija</Genres>
      <TheatreAuditorium>Auditorija 7</TheatreAuditorium><EventURL>http://www.forumcinemas.lv/event/304667/title/rota%C4%BClietu_st%C4%81sts_5/</EventURL>
      <SpokenLanguage><Name>Latviešu</Name></SpokenLanguage><Availability>75/100</Availability>
    </Show></Shows></Schedule>`, events, '2026-06-27');
  assert.equal(items.length, 1);
  assert.equal(items[0].language, 'Latviešu');
  assert.equal(items[0].auditorium, 'Auditorija 7');
  assert.equal(items[0].serviceDate, '2026-06-27');
  assert.equal(items[0].imdbUrl, 'https://www.imdb.com/title/tt123/');
  assert.equal(items[0].availability.takenSeats, 25);
  assert.equal(items[0].availability.occupiedPercent, 25);
});

test('parses Forum’s date-specific schedule page including grouped sessions', () => {
  const events = new Map([['304667', {
    imdbUrl: 'https://www.imdb.com/title/tt123/',
    posterUrl: 'https://images.example.test/toy-story.jpg'
  }]]);
  const items = parseForumPage(`
    <button class="classfilter-filter-btn" data-filterclass="classfilter_eventratings_eventrating_1105" data-displayname="Līdz 12 g.v. - neiesakām"></button>
    <div class="show-list-item classfilter_eventratings_eventrating_1105">
      <h1 class="eventName"><a href="/event/304667/title/rota%C4%BClietu_st%C4%81sts_5/"><span class="name-part">Rotaļlietu stāsts 5</span></a></h1>
      <img class="event-item-thumb" data-src="https://images.example.test/toy.jpg">
      <h4 class="showLocation">Forum Cinemas, Auditorija 7</h4>
      <div class="right-side-middle"><h2 class="showTime">11:05</h2><a href="/websales/show/433940/"></a></div>
      <span class="spokenLanguage">Latviešu</span><span class="freeSeats">75</span><span class="totalSeats">100</span>
      <div class="show-list-item-bottom"><a href="/websales/show/433941/" title="Forum Cinemas, Auditorija 8">13:40</a></div>
    </div>`, events, '2026-06-27');
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Rotaļlietu stāsts 5');
  assert.equal(items[0].ageRating, '12+');
  assert.equal(items[0].auditorium, 'Auditorija 7');
  assert.equal(items[0].availability.freeSeats, 75);
  assert.equal(items[1].auditorium, 'Auditorija 8');
  assert.equal(items[1].availability.freeSeats, undefined);
  assert.equal(items[1].startTime, '2026-06-27T13:40:00+03:00');
});

test('parses Apollo showtime cards and detail poster', () => {
  const items = parseApolloSchedule(`
    <div class="schedule-card">
      <a href="https://www.apollokino.lv/event/304052/supermeitene?theatreAreaID=1014"><figure class="schedule-card__image"><img data-srcset="//images.markus.live/poster.jpg?width=350 350w"></figure><div class="schedule-card__tag">12+</div></a>
      <time datetime="2026-06-27T11:30:00.0000000">11:30</time>
      <p class="schedule-card__cinema--desktop">Apollo Kino Akropole Rīga</p><p class="schedule-card__hall">1. IMAX zāle</p>
      <div class="schedule-card__title-container"><a href="/event/304052/supermeitene?theatreAreaID=1014"><p class="schedule-card__title">Supermeitene</p></a></div>
      <p class="schedule-card__secondary-title">Supergirl</p><span class="schedule-card__genre">Asa sižeta filma,</span>
      <a href="https://www.apollokino.lv/websales/show/509877"></a>
      <div class="schedule-card__option-seats"><div class="js-graph" data-value="3"></div><p class="schedule-card__option-title">269</p></div>
      <div class="schedule-card__option"><p class="schedule-card__option-label">Valoda</p><p class="schedule-card__option-title">Angļu</p></div>
    </div>`, '2026-06-27');
  assert.equal(items.length, 1);
  assert.equal(items[0].cinema, 'Apollo Akropole');
  assert.equal(items[0].language, 'Angļu');
  assert.equal(items[0].auditorium, '1. IMAX zāle');
  assert.equal(items[0].availability.freeSeats, 269);
  assert.equal(items[0].availability.totalSeats, 277);
  assert.equal(items[0].availability.occupiedPercent, 3);
  assert.equal(items[0].serviceDate, '2026-06-27');

  const detail = parseApolloMovieDetail(`
    <figure class="media-chess__image"><img data-srcset="//images.markus.live/poster_large.jpg?width=675 675w"></figure>
    <div class="specs__item"><p class="specs__key">Reitings</p><p class="specs__value">Līdz 12 g.v. - neiesakām</p></div>`);
  assert.equal(detail.ageRating, 'Līdz 12 g.v. - neiesakām');
  assert.match(detail.posterUrl, /poster_large/);
});

test('parses Cinamon Nuxt schedule with exact seats', () => {
  const html = `<script>window.__NUXT__=(function(){return {data:[{schedule:[{
    pid:123,screen_name:"Zāle 1",time:"18:30",date:"2026-06-27",showtime:"2026-06-27 18:30:00",
    audio_label:"Angļu",seats_left:{seats_total:100,seats_left:70},
    film:{name:"Sātans Pradas brunčos 2",original_name:"The Devil Wears Prada 2",slug:"satans-pradas-bruncos-2",poster:"https://cinamonkino.com/poster.jpg",rating:"12+",imdb_rating:"7.4",genre:{name:"Komēdija"}}
  }]}]}}());</script>`;
  assert.equal(extractNuxtState(html).data[0].schedule.length, 1);
  const items = parseCinamonSchedule(html, '2026-06-27');
  assert.equal(items.length, 1);
  assert.equal(items[0].language, 'Angļu');
  assert.equal(items[0].auditorium, 'Zāle 1');
  assert.equal(items[0].availability.takenSeats, 30);
  assert.equal(items[0].availability.occupiedPercent, 30);
  assert.equal(items[0].serviceDate, '2026-06-27');
  assert.equal(items[0].imdbRating, '7.4');
});

test('parses a date-specific Cinamon API response', () => {
  const items = parseCinamonSchedule(JSON.stringify([{
    pid: 456, screen_name: 'Zāle 2', date: '2026-06-28', showtime: '2026-06-28 10:10:00',
    film: { name: 'Rīt', original_name: 'Tomorrow', slug: 'tomorrow', genre: { name: 'Drāma' } }
  }]), '2026-06-28');
  assert.equal(items.length, 1);
  assert.equal(items[0].serviceDate, '2026-06-28');
});

test('parses a chunk-framed Cinamon API response saved by an ESP stream', () => {
  const payload = JSON.stringify([{
    pid: 789, screen_name: 'Zāle 3', date: '2026-06-29', showtime: '2026-06-29 11:00:00',
    film: { name: 'Rīt pēc', original_name: 'The Day After', slug: 'the-day-after', genre: { name: 'Drāma' } }
  }]);
  const chunked = `${payload.length.toString(16)}\r\n${payload}\r\n0\r\n\r\n`;
  const items = parseCinamonSchedule(chunked, '2026-06-29');
  assert.equal(items.length, 1);
  assert.equal(items[0].auditorium, 'Zāle 3');
});
