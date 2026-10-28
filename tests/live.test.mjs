import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseChzzkId, parseYoutubeRef, kstToIso, chzzkLive, chzzkChannel, chzzkOpenChannels,
  youtubeChannelInfo, rssVideoIds, youtubeLiveByChannel, decideLive
} from '../supabase/functions/_shared/live.js';

const CH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const UC = 'UC' + 'x'.repeat(22);

test('치지직 채널 ID 뽑기', () => {
  assert.equal(parseChzzkId(`https://chzzk.naver.com/${CH}`), CH);
  assert.equal(parseChzzkId(`https://chzzk.naver.com/live/${CH.toUpperCase()}`), CH);
  assert.equal(parseChzzkId('없음'), '');
});

test('유튜브 주소 해석', () => {
  assert.deepEqual(parseYoutubeRef('https://www.youtube.com/@lumia_native'), { kind: 'handle', value: '@lumia_native' });
  assert.deepEqual(parseYoutubeRef('youtube.com/@%EB%AC%B4%EB%AA%85%EC%84%AC/videos'), { kind: 'handle', value: '@무명섬' });
  assert.deepEqual(parseYoutubeRef('@무명섬'), { kind: 'handle', value: '@무명섬' });
  assert.deepEqual(parseYoutubeRef(`https://m.youtube.com/channel/${UC}?si=1`), { kind: 'id', value: UC });
  assert.deepEqual(parseYoutubeRef(UC), { kind: 'id', value: UC });
  assert.deepEqual(parseYoutubeRef('https://www.youtube.com/user/oldname'), { kind: 'user', value: 'oldname' });
  assert.deepEqual(parseYoutubeRef('https://www.youtube.com/c/CustomName'), { kind: 'custom', value: 'CustomName' });
  assert.equal(parseYoutubeRef('https://www.youtube.com/watch?v=abc'), null);
  assert.equal(parseYoutubeRef('https://youtu.be/abc'), null);
  assert.equal(parseYoutubeRef('https://example.com/@x'), null);
  assert.equal(parseYoutubeRef(''), null);
});

test('치지직 라이브 상태', () => {
  assert.equal(kstToIso('2026-10-28 20:01:02'), '2026-10-28T11:01:02.000Z');
  assert.deepEqual(chzzkLive({ code: 200, content: { status: 'OPEN', liveTitle: ' 내전 연습 ', concurrentUserCount: 321, openDate: '2026-10-28 20:01:02' } }),
    { live: true, title: '내전 연습', viewers: 321, startedAt: '2026-10-28T11:01:02.000Z' });
  assert.deepEqual(chzzkLive({ code: 200, content: { status: 'CLOSE', liveTitle: '지난 방송', concurrentUserCount: 0 } }),
    { live: false, title: '', viewers: null, startedAt: null });
  assert.equal(chzzkLive({ code: 200, content: null }).live, false);   // 방송한 적 없는 채널
  assert.equal(chzzkLive({ code: 404, message: 'not found' }).live, false);
  assert.equal(chzzkLive({ code: 500 }), null);                         // 모르는 응답은 건드리지 않아요
  assert.equal(chzzkLive('x'), null);
});

test('치지직 채널 정보', () => {
  assert.deepEqual(chzzkChannel({ content: { channelName: '루미', channelImageUrl: 'https://img/1.png', openLive: true } }), { name: '루미', image: 'https://img/1.png', openLive: true });
  assert.equal(chzzkChannel({ content: null }), null);
  assert.equal(chzzkOpenChannels({ content: { data: [{ channelId: CH, channelImageUrl: 'https://img/2.png' }] } }).get(CH), 'https://img/2.png');
});

test('유튜브 채널 · RSS · 라이브', () => {
  assert.deepEqual(youtubeChannelInfo({ id: UC, snippet: { title: '채널', thumbnails: { default: { url: 'd' }, high: { url: 'h' } } } }), { id: UC, title: '채널', image: 'h' });
  const xml = '<feed><entry><yt:videoId>AAAAAAAAAAA</yt:videoId></entry><entry><yt:videoId>BBBBBBBBBBB</yt:videoId></entry><entry><yt:videoId>AAAAAAAAAAA</yt:videoId></entry></feed>';
  assert.deepEqual(rssVideoIds(xml), ['AAAAAAAAAAA', 'BBBBBBBBBBB']);
  assert.deepEqual(rssVideoIds(xml, 1), ['AAAAAAAAAAA']);
  const live = youtubeLiveByChannel({ items: [
    { id: 'v1', snippet: { channelId: UC, liveBroadcastContent: 'none', title: '지난 영상' } },
    { id: 'v2', snippet: { channelId: UC, liveBroadcastContent: 'live', title: '내전 생방' }, liveStreamingDetails: { concurrentViewers: '57', actualStartTime: '2026-10-28T11:00:00Z' } },
    { id: 'v3', snippet: { channelId: 'UCother', liveBroadcastContent: 'upcoming', title: '예약' } },
    { id: 'v4', snippet: { channelId: 'UCended', liveBroadcastContent: 'live', title: '끝남' }, liveStreamingDetails: { actualEndTime: '2026-10-28T12:00:00Z' } }
  ] });
  assert.deepEqual([...live.keys()], [UC]);
  assert.deepEqual(live.get(UC), { videoId: 'v2', title: '내전 생방', viewers: 57, startedAt: '2026-10-28T11:00:00Z' });
});

test('어느 방송을 보여 줄지', () => {
  const chz = { live: true, title: '치지직 방송', viewers: 10, startedAt: null };
  const yt = { videoId: 'v2', title: '유튜브 방송', viewers: 99, startedAt: null };
  assert.equal(decideLive({ chzzkId: CH, chzzk: chz, youtube: yt }).live_platform, 'chzzk');
  assert.equal(decideLive({ chzzkId: CH, chzzk: chz, youtube: null }).live_url, `https://chzzk.naver.com/live/${CH}`);
  const y = decideLive({ chzzkId: CH, chzzk: { live: false }, youtube: yt });
  assert.equal(y.live_platform, 'youtube');
  assert.equal(y.live_url, 'https://www.youtube.com/watch?v=v2');
  assert.deepEqual(decideLive({ chzzkId: '', chzzk: null, youtube: null }), { is_live: false, live_platform: null, live_title: null, live_viewers: null, live_url: null, live_started_at: null });
});
