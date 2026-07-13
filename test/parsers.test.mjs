import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractNuxtState,
  mergeSourceResults,
  parseApolloMovieDetail,
  parseApolloSchedule,
  parseCinamonSchedule,
  parseForumEvents,
  parseForumSchedule
} from '../scripts/scrape.mjs';

test('keeps a previous source snapshot and marks it stale after 90 minutes', () => {
  const previous = {
    date: '2026-06-27',
    sources: [{ id: 'apollo', fetchedAt: '2026-06-27T07:00:00.000Z', lastSuccessAt: '2026-06-27T07:00:00.000Z' }],
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
  assert.match(payload.warnings.find((warning) => warning.source === 'apollo').message, /stale/i);
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
