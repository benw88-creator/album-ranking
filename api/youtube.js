// /api/youtube?artist=<artist>&title=<song>
//
// Finds the YouTube upload of one song, so Community Choice can let somebody
// pick ANY thirty seconds of it. Deezer's preview is one fixed clip per track
// and the API offers no other window, which made "pick the best part" a choice
// between a few seconds either way of whatever Deezer chose.
//
// YouTube is played only through its own embedded player, visible, with the
// start and end the picker chose — which is what the IFrame API is for. No
// audio is extracted and nothing is played hidden; both would break YouTube's
// terms, and the player being on screen is the price of the whole song.
//
// Search costs 100 of the 10,000 daily quota units, so ~100 lookups a day. A
// pick stores the video id it was made on, so this runs once per PICK, never
// per play, and the edge caches each query for a day on top.
//
// Needs YOUTUBE_API_KEY (Google Cloud → APIs & Services → enable "YouTube Data
// API v3" → Credentials → API key). Without it this answers 503 and the picker
// falls back to the Deezer preview, so nothing breaks while it is unset.

import { cors } from './_cors.js';

const BAD = /\b(karaoke|cover|tribute|instrumental|8-?bit|slowed|sped up|reverb|nightcore|remix|lyrics?|reaction|live at|live from|concert|tutorial|piano version|1 hour|loop)\b/i;

function loose(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}
function iso(d) { // PT4M13S -> ms
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d || '');
  return m ? ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000 : 0;
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) { res.setHeader('Cache-Control', 'no-store'); res.status(503).json({ error: 'YOUTUBE_API_KEY is not set' }); return; }
  const artist = String((req.query && req.query.artist) || '').slice(0, 120);
  const title = String((req.query && req.query.title) || '').slice(0, 160);
  if (!artist || !title) { res.status(400).json({ error: 'artist and title are required' }); return; }

  try {
    const q = artist + ' ' + title.replace(/\((feat|ft|with)[^)]*\)/gi, '');
    const s = await fetch('https://www.googleapis.com/youtube/v3/search?' + new URLSearchParams({
      part: 'snippet', type: 'video', maxResults: '10', videoEmbeddable: 'true',
      videoCategoryId: '10', q, key
    })).then(r => r.json());
    if (s.error) throw new Error(s.error.message || 'search failed');
    const ids = (s.items || []).map(i => i.id && i.id.videoId).filter(Boolean);
    if (!ids.length) { res.setHeader('Cache-Control', 'public, s-maxage=86400'); res.status(200).json({ videos: [] }); return; }

    // Durations, plus the embeddable/region facts search does not carry. One unit.
    const v = await fetch('https://www.googleapis.com/youtube/v3/videos?' + new URLSearchParams({
      part: 'snippet,contentDetails,status', id: ids.join(','), key
    })).then(r => r.json());
    if (v.error) throw new Error(v.error.message || 'videos failed');

    const wa = loose(artist), wt = loose(title);
    const scored = (v.items || []).filter(x => x.status && x.status.embeddable !== false).map((x) => {
      const t = x.snippet.title || '', ch = x.snippet.channelTitle || '', lt = loose(t), lc = loose(ch);
      const ms = iso(x.contentDetails && x.contentDetails.duration);
      let sc = 0;
      if (lt.includes(wt)) sc += 5;
      if (lc.includes(wa) || lc.endsWith(' topic') || /vevo$/.test(lc)) sc += 4;   // the artist's own channel or YouTube's auto "Topic" upload
      if (lt.includes(wa)) sc += 1;
      if (/official (audio|video|music video)/i.test(t)) sc += 2;
      if (BAD.test(t) && !BAD.test(title)) sc -= 8;
      if (ms < 60000 || ms > 20 * 60000) sc -= 6;
      return { id: x.id, title: t, channel: ch, ms, thumb: (x.snippet.thumbnails && (x.snippet.thumbnails.medium || x.snippet.thumbnails.default) || {}).url || null, score: sc };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);

    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=3600');
    res.status(200).json({ videos: scored.map(({ score, ...r }) => r) });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: String((e && e.message) || e) });
  }
}
