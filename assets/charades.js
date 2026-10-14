/* ================================================================
   ARTIST CHARADES — a pass-the-phone party game.

   One phone, two teams, thirty seconds each. The actor sees an artist and
   acts it out — no words, no humming — while their team shouts. +1 when they
   get it, Skip to move on, −1 to take back a point tapped by mistake.

   THE POOL IS THE GAME. An artist belongs here because a NAME can be acted,
   not because they are famous: Queen is a crown and a wave, Snoop Dogg is a
   dog and a sneak, Def Leppard is a hand to the ear and claws. Drake is a
   duck nobody will get to. So the level is how hard the name is to ACT
   (1 = the name is a picture, 2 = it takes a sounds-like or two, 3 = you
   need a plan), never how obscure the artist is — everybody here is famous.

   State lives in memory and is mirrored to sessionStorage, so Back, the
   lock screen or an accidental reload never costs a party its score: close
   the sheet and the card offers to carry on. Player names persist in
   localStorage, because the same friends play next weekend.

   It pays no Discs on purpose. Thirty seconds of shouting cannot be scored
   by a server, and a party game that pays is a party game somebody plays
   alone at 3am tapping +1.
   ================================================================ */
(function () {
  'use strict';

  /* name, level (1 easy to act / 2 / 3 hard to act), what they are */
  var POOL = [
    ['Queen',1,'Band'],['The Beatles',1,'Band'],['Arctic Monkeys',1,'Band'],['Red Hot Chili Peppers',1,'Band'],
    ['One Direction',1,'Band'],['Snoop Dogg',1,'Rapper'],['50 Cent',1,'Rapper'],['Pitbull',1,'Rapper'],
    ['Ice Spice',1,'Rapper'],['Gorillaz',1,'Band'],['Daft Punk',1,'Duo'],['Coldplay',1,'Band'],
    ['Green Day',1,'Band'],['Pink Floyd',1,'Band'],['Iron Maiden',1,'Band'],["Guns N' Roses",1,'Band'],
    ['Foo Fighters',1,'Band'],['The Rolling Stones',1,'Band'],['Black Eyed Peas',1,'Group'],['Spice Girls',1,'Group'],
    ['Kings of Leon',1,'Band'],['Imagine Dragons',1,'Band'],['Fall Out Boy',1,'Band'],['Radiohead',1,'Band'],
    ['Ice Cube',1,'Rapper'],['Vanilla Ice',1,'Rapper'],['Bruno Mars',1,'Singer'],['Lady Gaga',1,'Singer'],
    ['Post Malone',1,'Singer'],['Cardi B',1,'Rapper'],['Future',1,'Rapper'],['21 Savage',1,'Rapper'],
    ['The Weeknd',1,'Singer'],['Prince',1,'Singer'],['Train',1,'Band'],['Muse',1,'Band'],
    ['Kiss',1,'Band'],['The Killers',1,'Band'],['The Police',1,'Band'],['The Cure',1,'Band'],
    ['Beach Boys',1,'Band'],['Backstreet Boys',1,'Group'],['Take That',1,'Group'],['McFly',1,'Band'],
    ['Snow Patrol',1,'Band'],['Lil Baby',1,'Rapper'],['Megan Thee Stallion',1,'Rapper'],['Pop Smoke',1,'Rapper'],
    ['Juice WRLD',1,'Rapper'],['T-Pain',1,'Singer'],['Flo Rida',1,'Rapper'],['Stormzy',1,'Rapper'],
    ['Central Cee',1,'Rapper'],['Slowthai',1,'Rapper'],['Professor Green',1,'Rapper'],['Harry Styles',1,'Singer'],
    ['Sam Smith',1,'Singer'],['Sabrina Carpenter',1,'Singer'],['Taylor Swift',1,'Singer'],['Stevie Wonder',1,'Singer'],
    ['Bad Bunny',1,'Rapper'],['Ski Mask the Slump God',1,'Rapper'],['Kodak Black',1,'Rapper'],['Glass Animals',1,'Band'],
    ['Two Door Cinema Club',1,'Band'],['Vampire Weekend',1,'Band'],['The White Stripes',1,'Duo'],['The Black Keys',1,'Duo'],
    ["Rag'n'Bone Man",1,'Singer'],['Arcade Fire',1,'Band'],['Pearl Jam',1,'Band'],['Smashing Pumpkins',1,'Band'],
    ['Rage Against the Machine',1,'Band'],['Slipknot',1,'Band'],['Def Leppard',1,'Band'],['Deep Purple',1,'Band'],
    ['Bee Gees',1,'Group'],['Earth, Wind & Fire',1,'Band'],['Tears for Fears',1,'Duo'],['Madness',1,'Band'],
    ['Wham!',1,'Duo'],['Pet Shop Boys',1,'Duo'],['Talking Heads',1,'Band'],['Bananarama',1,'Group'],
    ['Village People',1,'Group'],['Chemical Brothers',1,'Duo'],['Fatboy Slim',1,'DJ'],['Clean Bandit',1,'Band'],
    ['Major Lazer',1,'Group'],['Marshmello',1,'DJ'],['DJ Snake',1,'DJ'],['Deadmau5',1,'DJ'],
    ['Jungle',1,'Band'],['Wet Leg',1,'Band'],['Wolf Alice',1,'Band'],['Royal Blood',1,'Duo'],
    ['Catfish and the Bottlemen',1,'Band'],['My Chemical Romance',1,'Band'],['Panic! at the Disco',1,'Band'],['Twenty One Pilots',1,'Duo'],
    ['Blink-182',1,'Band'],['Pixies',1,'Band'],['Massive Attack',1,'Group'],['Frank Ocean',1,'Singer'],
    ['Dr. Dre',1,'Rapper'],['Usher',1,'Singer'],['Daddy Yankee',1,'Rapper'],['Pink',1,'Singer'],
    ['Amy Winehouse',1,'Singer'],['Johnny Cash',1,'Singer'],['Dolly Parton',1,'Singer'],['Luke Combs',1,'Singer'],
    ['Neil Young',1,'Singer'],['Chuck Berry',1,'Singer'],['Little Richard',1,'Singer'],['Muddy Waters',1,'Singer'],
    ['B.B. King',1,'Singer'],['The Who',1,'Band'],['The Monkees',1,'Band'],['The Animals',1,'Band'],
    ['Yes',1,'Band'],['Rush',1,'Band'],['Heart',1,'Band'],['Europe',1,'Band'],
    ['Poison',1,'Band'],['Whitesnake',1,'Band'],['Twisted Sister',1,'Band'],['The Byrds',1,'Band'],
    ['Hall & Oates',1,'Duo'],['Kool & the Gang',1,'Band'],['Beastie Boys',1,'Group'],['Cypress Hill',1,'Group'],
    ['Lil Wayne',1,'Rapper'],['Headie One',1,'Rapper'],['Royal Blood',1,'Duo'],['Nothing But Thieves',1,'Band'],

    ['Eminem',2,'Rapper'],['Oasis',2,'Band'],['Blur',2,'Band'],['Sting',2,'Singer'],
    ['Seal',2,'Singer'],['Shaggy',2,'Singer'],['Madonna',2,'Singer'],['Journey',2,'Band'],
    ['Toto',2,'Band'],['Scorpions',2,'Band'],['Eagles',2,'Band'],['The Doors',2,'Band'],
    ['The Clash',2,'Band'],['Girls Aloud',2,'Group'],["Destiny's Child",2,'Group'],['Little Mix',2,'Group'],
    ['Linkin Park',2,'Band'],['Maroon 5',2,'Band'],['Busted',2,'Band'],['The Darkness',2,'Band'],
    ['Swedish House Mafia',2,'DJs'],['Calvin Harris',2,'DJ'],['Billie Eilish',2,'Singer'],['Ice-T',2,'Rapper'],
    ['Lil Nas X',2,'Rapper'],['Gunna',2,'Rapper'],['Young Thug',2,'Rapper'],['Polo G',2,'Rapper'],
    ['Rod Wave',2,'Rapper'],['Meek Mill',2,'Rapper'],['Doja Cat',2,'Rapper'],['Tyler, the Creator',2,'Rapper'],
    ['A$AP Rocky',2,'Rapper'],['Lil Peep',2,'Rapper'],['J. Cole',2,'Rapper'],['Busta Rhymes',2,'Rapper'],
    ['Wu-Tang Clan',2,'Group'],['Run-DMC',2,'Group'],['Public Enemy',2,'Group'],['OutKast',2,'Duo'],
    ['Little Simz',2,'Rapper'],['Aitch',2,'Rapper'],['Dizzee Rascal',2,'Rapper'],['Tinie Tempah',2,'Rapper'],
    ['Elvis Presley',2,'Singer'],['Michael Jackson',2,'Singer'],['Ed Sheeran',2,'Singer'],['Dua Lipa',2,'Singer'],
    ['Katy Perry',2,'Singer'],['Ariana Grande',2,'Singer'],['Elton John',2,'Singer'],['Rick Astley',2,'Singer'],
    ['Lana Del Rey',2,'Singer'],['Charli XCX',2,'Singer'],['Jack Harlow',2,'Rapper'],['Mac Miller',2,'Rapper'],
    ['Kid Cudi',2,'Rapper'],['Lil Uzi Vert',2,'Rapper'],['Metro Boomin',2,'Producer'],['The Strokes',2,'Band'],
    ['Foals',2,'Band'],['Florence + the Machine',2,'Band'],['Manic Street Preachers',2,'Band'],['The Kooks',2,'Band'],
    ['Soundgarden',2,'Band'],['System of a Down',2,'Band'],['Motörhead',2,'Band'],['Black Sabbath',2,'Band'],
    ['Led Zeppelin',2,'Band'],['The Jackson 5',2,'Group'],['Fleetwood Mac',2,'Band'],['Simply Red',2,'Band'],
    ['Soft Cell',2,'Duo'],['Culture Club',2,'Band'],['Spandau Ballet',2,'Band'],['Blondie',2,'Band'],
    ['The Prodigy',2,'Band'],['Chase & Status',2,'Duo'],['Fred again..',2,'Producer'],['The 1975',2,'Band'],
    ['Weezer',2,'Band'],['Portishead',2,'Band'],['Childish Gambino',2,'Rapper'],['Gnarls Barkley',2,'Duo'],
    ['Eazy-E',2,'Rapper'],['The Notorious B.I.G.',2,'Rapper'],['2Pac',2,'Rapper'],['Jay-Z',2,'Rapper'],
    ['Timbaland',2,'Producer'],['Sean Kingston',2,'Singer'],['Ricky Martin',2,'Singer'],['Nicky Jam',2,'Rapper'],
    ['Cher',2,'Singer'],['Sia',2,'Singer'],['Paloma Faith',2,'Singer'],['Lily Allen',2,'Singer'],
    ['Robbie Williams',2,'Singer'],['Boy George',2,'Singer'],['David Bowie',2,'Singer'],['Freddie Mercury',2,'Singer'],
    ['Garth Brooks',2,'Singer'],['Shania Twain',2,'Singer'],['Billy Idol',2,'Singer'],['Bruce Springsteen',2,'Singer'],
    ['Bob Marley',2,'Singer'],['The Kinks',2,'Band'],['The Hollies',2,'Band'],['Genesis',2,'Band'],
    ['Van Halen',2,'Band'],['ZZ Top',2,'Band'],['Steely Dan',2,'Band'],['Chic',2,'Band'],
    ['KC and the Sunshine Band',2,'Band'],['will.i.am',2,'Rapper'],['Lil Jon',2,'Rapper'],['Three 6 Mafia',2,'Group'],
    ['Stone Roses',2,'Band'],['Duran Duran',2,'Band'],['Sugababes',2,'Group'],['Frankie Goes to Hollywood',2,'Band'],

    ['Kendrick Lamar',3,'Rapper'],['Travis Scott',3,'Rapper'],['Nicki Minaj',3,'Rapper'],['Missy Elliott',3,'Rapper'],
    ['Ludacris',3,'Rapper'],['Nelly',3,'Rapper'],['Akon',3,'Singer'],['Sean Paul',3,'Singer'],
    ['Dave',3,'Rapper'],['Skepta',3,'Rapper'],['Tion Wayne',3,'Rapper'],['Kano',3,'Rapper'],
    ['Whitney Houston',3,'Singer'],['Beyoncé',3,'Singer'],['Rihanna',3,'Singer'],['Adele',3,'Singer'],
    ['Lewis Capaldi',3,'Singer'],['Olivia Rodrigo',3,'Singer'],['Bon Jovi',3,'Band'],['Ray Charles',3,'Singer'],
    ['Kylie Minogue',3,'Singer'],['Lizzo',3,'Singer'],['Chappell Roan',3,'Singer'],['Shakira',3,'Singer'],
    ['Rae Sremmurd',3,'Duo'],['Migos',3,'Group'],['Mac DeMarco',3,'Singer'],['Bastille',3,'Band'],
    ['Stereophonics',3,'Band'],['Biffy Clyro',3,'Band'],['Nirvana',3,'Band'],['Metallica',3,'Band'],
    ['Megadeth',3,'Band'],['AC/DC',3,'Band'],['The Supremes',3,'Group'],['UB40',3,'Band'],
    ['Depeche Mode',3,'Band'],['ABBA',3,'Group'],['Kraftwerk',3,'Band'],['Disclosure',3,'Duo'],
    ['Rudimental',3,'Group'],['Avicii',3,'DJ'],['David Guetta',3,'DJ'],['Skrillex',3,'DJ'],
    ['Kygo',3,'DJ'],['Sigala',3,'DJ'],['Paramore',3,'Band'],['Sum 41',3,'Band'],
    ['SZA',3,'Singer'],['Steve Lacy',3,'Singer'],['Kali Uchis',3,'Singer'],['N.W.A',3,'Group'],
    ['Nas',3,'Rapper'],['Pharrell Williams',3,'Singer'],['Ne-Yo',3,'Singer'],['Chris Brown',3,'Singer'],
    ['Jason Derulo',3,'Singer'],['Enrique Iglesias',3,'Singer'],['Luis Fonsi',3,'Singer'],['Ozuna',3,'Singer'],
    ['Rauw Alejandro',3,'Singer'],['Karol G',3,'Singer'],['J Balvin',3,'Singer'],['Anitta',3,'Singer'],
    ['Gloria Estefan',3,'Singer'],['Rita Ora',3,'Singer'],['Jessie J',3,'Singer'],['Ellie Goulding',3,'Singer'],
    ['Duffy',3,'Singer'],['George Michael',3,'Singer'],['Willie Nelson',3,'Singer'],['Kenny Rogers',3,'Singer'],
    ['Morgan Wallen',3,'Singer'],['Zach Bryan',3,'Singer'],['Kacey Musgraves',3,'Singer'],['Billy Joel',3,'Singer'],
    ['Bob Dylan',3,'Singer'],['Jimi Hendrix',3,'Guitarist'],['Mötley Crüe',3,'Band'],['Lynyrd Skynyrd',3,'Band'],
    ['Creedence Clearwater Revival',3,'Band'],['Simon & Garfunkel',3,'Duo'],['Boney M.',3,'Group'],['Fergie',3,'Singer'],
    ['Peggy Gou',3,'DJ'],['Idles',3,'Band'],['Sleaford Mods',3,'Duo'],['Krept & Konan',3,'Duo']
  ];
  // dedupe by name (a hand-written list repeats itself sooner or later)
  (function () { var seen = {}; POOL = POOL.filter(function (r) { var k = r[0].toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; }); })();

  var DIFFS = {
    easy:  { label: 'Easy',  line: 'Queen. Snoop Dogg. Pink. Point at things.', w: { 1: 1 } },
    mixed: { label: 'Mixed', line: 'Mostly fair, with the odd Fleetwood Mac.', w: { 1: 5, 2: 4, 3: 1 } },
    hard:  { label: 'Hard',  line: 'Good luck acting out Kraftwerk.', w: { 2: 2, 3: 3 } }
  };
  var TEAM_NAMES = [['A-Side', 'B-Side'], ['Headliners', 'Support Act'], ['Treble', 'Bass'], ['Encore', 'Soundcheck'], ['Mosh Pit', 'Front Row']];
  var STORE = 'vinall_charades_v1', LIVE = 'vinall_charades_live';
  var TURN_MS = 30000;

  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function calm() { return !!(window.motionReduced && motionReduced()); }
  function buzzIt(k) { if (window.buzz) try { buzz(k); } catch (e) {} }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function lsGet(k, s) { try { return JSON.parse((s || localStorage).getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v, s) { try { (s || localStorage).setItem(k, JSON.stringify(v)); } catch (e) {} }

  /* ---- deck ------------------------------------------------------------ */
  // Weighted by level, never repeating within a game, and steering clear of
  // whatever came up in the last game on this phone.
  function buildDeck(diff, avoid) {
    var w = DIFFS[diff].w, out = [];
    [1, 2, 3].forEach(function (lv) {
      if (!w[lv]) return;
      var rows = POOL.filter(function (r) { return r[1] === lv; });
      var fresh = shuffle(rows.filter(function (r) { return !avoid[r[0]]; })), stale = shuffle(rows.filter(function (r) { return avoid[r[0]]; }));
      rows = fresh.concat(stale);
      rows.forEach(function (r, i) { out.push({ r: r, k: (i + Math.random()) / w[lv] }); });
    });
    return out.sort(function (a, b) { return a.k - b.k; }).map(function (x) { return { a: x.r[0], lv: x.r[1], t: x.r[2] }; });
  }

  /* ---- sound ------------------------------------------------------------ */
  var ac = null;
  function soundOn() { var s = lsGet(STORE) || {}; return s.sound !== false; }
  function tone(freq, ms, type, vol, slide) {
    if (!soundOn()) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      var o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
      o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + ms / 1000);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.18, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + ms / 1000 + 0.02);
    } catch (e) {}
  }
  var SFX = {
    got: function () { tone(660, 90, 'triangle', .2); setTimeout(function () { tone(990, 160, 'triangle', .2); }, 80); },
    skip: function () { tone(420, 160, 'sine', .12, 220); },
    minus: function () { tone(300, 200, 'square', .08, 180); },
    tick: function (n) { tone(n <= 3 ? 1100 : 880, 70, 'square', .07); },
    count: function (last) { tone(last ? 1320 : 660, last ? 320 : 140, 'triangle', .2); },
    buzzer: function () { tone(160, 650, 'sawtooth', .16, 110); },
    fanfare: function () { [523, 659, 784, 1047].forEach(function (f, i) { setTimeout(function () { tone(f, i === 3 ? 600 : 160, 'triangle', .18); }, i * 130); }); }
  };

  /* ---- wake lock: the phone is face up on a table between turns -------- */
  var lock = null;
  function wake(on) {
    if (on) { if (navigator.wakeLock && !lock && document.visibilityState === 'visible') navigator.wakeLock.request('screen').then(function (l) { lock = l; l.addEventListener('release', function () { lock = null; }); }).catch(function () {}); }
    else if (lock) { try { lock.release(); } catch (e) {} lock = null; }
  }
  document.addEventListener('visibilitychange', function () { if (isOpen() && document.visibilityState === 'visible') wake(true); });

  /* ---- state ------------------------------------------------------------ */
  var S = null;          // the live game; null on the setup screen
  var setup = null;      // players + settings being edited
  var recent = {};       // artists from the last game on this phone
  var timer = { raf: 0, end: 0, last: 0, to: 0 };

  function loadSetup() {
    var s = lsGet(STORE) || {};
    var pair = TEAM_NAMES[0];
    setup = {
      players: Array.isArray(s.players) ? s.players.filter(function (p) { return p && p.name; }).slice(0, 24) : [],
      teams: Array.isArray(s.teams) && s.teams.length === 2 ? s.teams.slice() : pair.slice(),
      diff: DIFFS[s.diff] ? s.diff : 'mixed',
      mode: s.mode === 'target' ? 'target' : 'rounds',
      rounds: [3, 5, 8].indexOf(s.rounds) >= 0 ? s.rounds : 5,
      target: [10, 15, 25].indexOf(s.target) >= 0 ? s.target : 15,
      sound: s.sound !== false
    };
  }
  function saveSetup() { lsSet(STORE, setup); }
  function saveLive() { if (S) lsSet(LIVE, S, sessionStorage); else try { sessionStorage.removeItem(LIVE); } catch (e) {} }

  function teamOf(t) { return setup.players.filter(function (p) { return p.team === t; }); }
  function balanced() { var a = teamOf(0).length, b = teamOf(1).length; return a >= 2 && a === b; }

  function newGame(startTeam) {
    var players = setup.players.map(function (p) { return { name: p.name, team: p.team, pts: 0 }; });
    S = {
      players: players,
      teams: [{ name: setup.teams[0] || 'A-Side', score: 0, actor: 0 }, { name: setup.teams[1] || 'B-Side', score: 0, actor: 0 }],
      diff: setup.diff, mode: setup.mode, rounds: setup.rounds, target: setup.target,
      deck: buildDeck(setup.diff, recent), di: 0,
      round: 1, team: startTeam || 0, first: startTeam || 0,
      phase: 'pass', log: [], turns: [], sudden: false
    };
    saveLive();
  }
  function actorOf(t) {
    var list = S.players.filter(function (p) { return p.team === t; });
    return list[S.teams[t].actor % list.length];
  }
  function draw() {
    if (S.di >= S.deck.length) { S.deck = S.deck.concat(buildDeck(S.diff, {})); }
    return S.deck[S.di++];
  }

  /* ---- shell ------------------------------------------------------------ */
  var root = null;
  function isOpen() { return !!(root && root.classList.contains('open')); }
  function ensureRoot() {
    if (root) return root;
    root = document.createElement('div');
    root.id = 'charades';
    root.className = 'modal cz';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Artist Charades');
    root.innerHTML = '<div class="cz-stage" id="cz-stage"></div>';
    document.body.appendChild(root);
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    // The global back handler closes the top .modal by removing `open`.
    // Closing never ends the game: it pauses the clock and the card offers
    // to carry on.
    new MutationObserver(function () { if (!isOpen()) onClosed(); }).observe(root, { attributes: true, attributeFilter: ['class'] });
    return root;
  }
  function open() {
    ensureRoot();
    if (!setup) loadSetup();
    if (!S) { var live = lsGet(LIVE, sessionStorage); if (live && live.teams) S = live; }
    if (S && S.phase === 'play') S.phase = 'pass';      // a turn interrupted mid-clock is replayed, not resumed with no time
    root.classList.add('open');
    document.documentElement.classList.add('cz-lock');
    wake(true);
    render();
    if (window.notePlay && !open._noted) { /* counted at the end of a game, not here */ }
  }
  function close() { if (root) root.classList.remove('open'); }
  function onClosed() {
    stopClock();
    wake(false);
    document.documentElement.classList.remove('cz-lock');
    if (S && S.phase === 'play') { S.log = []; S.phase = 'pass'; S.di = Math.max(0, S.di); }
    saveLive();
    paintCard();
  }

  /* ---- render ------------------------------------------------------------ */
  function stage() { return $('#cz-stage', root); }
  function setScreen(cls, html, team) {
    var st = stage();
    st.className = 'cz-stage ' + cls;
    if (team === 0 || team === 1) { st.dataset.team = team; st.style.setProperty('--tc', 'var(--cz-t' + team + ')'); st.style.setProperty('--tc2', 'var(--cz-t' + team + 'b)'); }
    else { delete st.dataset.team; st.style.removeProperty('--tc'); st.style.removeProperty('--tc2'); }
    st.innerHTML = html;
    if (!calm()) { st.classList.remove('cz-in'); void st.offsetWidth; st.classList.add('cz-in'); }
  }
  function teamVars(t) { return ' style="--tc:var(--cz-t' + t + ');--tc2:var(--cz-t' + t + 'b)"'; }
  function topBar(extra) {
    return '<div class="cz-top"><button class="cz-x" data-cz="close" aria-label="Close">✕</button>' + (extra || '<span class="cz-brand">Artist Charades</span>') +
      '<button class="cz-snd' + (soundOn() ? '' : ' off') + '" data-cz="sound" aria-label="Sound ' + (soundOn() ? 'on' : 'off') + '">' + (soundOn() ? '♪' : '♪̸') + '</button></div>';
  }
  function render() {
    if (!root) return;
    if (!S) return renderSetup();
    if (S.phase === 'pass') return renderPass();
    if (S.phase === 'tally') return renderTally();
    if (S.phase === 'final') return renderFinal();
  }

  /* SETUP */
  function renderSetup() {
    var cols = [0, 1].map(function (t) {
      var list = setup.players.map(function (p, i) { return p.team === t ? '<li class="cz-chip"><button data-cz="move" data-i="' + i + '" title="Move to the other team">' + esc(p.name) + '<i>⇄</i></button><button class="cz-rm" data-cz="rm" data-i="' + i + '" aria-label="Remove ' + esc(p.name) + '">✕</button></li>' : ''; }).join('');
      return '<div class="cz-team"' + teamVars(t) + '><input class="cz-tname" data-team="' + t + '" value="' + esc(setup.teams[t]) + '" maxlength="18" aria-label="Team ' + (t + 1) + ' name"><ul>' + (list || '<li class="cz-empty">Nobody yet</li>') + '</ul><span class="cz-count">' + teamOf(t).length + '</span></div>';
    }).join('<div class="cz-vs">vs</div>');
    var a = teamOf(0).length, b = teamOf(1).length, n = setup.players.length;
    var hint = n < 4 ? 'Four players at least — two a side.' : a !== b ? 'Teams need the same number of players (' + a + ' v ' + b + '). Tap a name to swap sides.' : 'Each turn is 30 seconds. No talking, no humming, no pointing at the speaker.';
    setScreen('cz-setup',
      topBar() +
      '<div class="cz-scroll"><div class="cz-hero"><span class="cz-kick">Pass the phone · 4+ players</span><h1 class="cz-h1"><b>Artist</b> Charades</h1></div>' +
      '<form class="cz-add" data-cz-form><input id="cz-name" placeholder="Add a player" maxlength="20" autocomplete="off" enterkeyhint="done" aria-label="Player name"><button class="cz-addbtn" type="submit">Add</button></form>' +
      '<div class="cz-teams">' + cols + '</div>' +
      '<div class="cz-row"><button class="cz-ghost" data-cz="shuffle"' + (n < 2 ? ' disabled' : '') + '>Shuffle teams</button><button class="cz-ghost" data-cz="names">New team names</button></div>' +
      '<h3 class="cz-lbl">Difficulty <small>how hard the names are to act, not how obscure</small></h3>' +
      '<div class="cz-seg">' + Object.keys(DIFFS).map(function (k) { return '<button data-cz="diff" data-v="' + k + '" class="' + (setup.diff === k ? 'on' : '') + '"><b>' + DIFFS[k].label + '</b><small>' + DIFFS[k].line + '</small></button>'; }).join('') + '</div>' +
      '<h3 class="cz-lbl">Play to</h3>' +
      '<div class="cz-seg cz-seg-mode"><button data-cz="mode" data-v="rounds" class="' + (setup.mode === 'rounds' ? 'on' : '') + '"><b>Rounds</b></button><button data-cz="mode" data-v="target" class="' + (setup.mode === 'target' ? 'on' : '') + '"><b>Target score</b></button></div>' +
      '<div class="cz-pills">' + (setup.mode === 'rounds' ? [3, 5, 8].map(function (v) { return '<button data-cz="rounds" data-v="' + v + '" class="' + (setup.rounds === v ? 'on' : '') + '">' + v + ' rounds</button>'; }) : [10, 15, 25].map(function (v) { return '<button data-cz="target" data-v="' + v + '" class="' + (setup.target === v ? 'on' : '') + '">First to ' + v + '</button>'; })).join('') + '</div>' +
      '<p class="cz-hint">' + esc(hint) + '</p></div>' +
      '<div class="cz-foot"><button class="cz-go" data-cz="start"' + (balanced() ? '' : ' disabled') + '>Start the game</button></div>');
  }

  /* PASS — the phone changes hands */
  function scoreStrip() {
    var goal = S.mode === 'target' ? S.target : null;
    return '<div class="cz-score">' + [0, 1].map(function (t) {
      return '<div class="cz-sc' + (S.team === t ? ' now' : '') + '"' + teamVars(t) + '><span>' + esc(S.teams[t].name) + '</span><b>' + S.teams[t].score + '</b>' +
        (goal ? '<i><em style="width:' + Math.min(100, S.teams[t].score / goal * 100) + '%"></em></i>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function roundLabel() {
    if (S.sudden) return 'Sudden death';
    return S.mode === 'rounds' ? 'Round ' + S.round + ' of ' + S.rounds : 'Round ' + S.round + ' · first to ' + S.target;
  }
  function renderPass() {
    var t = S.team, actor = actorOf(t);
    var guessers = S.players.filter(function (p) { return p.team === t && p !== actor; }).map(function (p) { return esc(p.name); });
    setScreen('cz-pass', topBar('<span class="cz-brand">' + roundLabel() + '</span>') +
      '<div class="cz-pass-body"' + teamVars(t) + '>' + scoreStrip() +
      '<div class="cz-handoff"><span class="cz-kick">' + esc(S.teams[t].name) + ' · your turn</span>' +
      '<p class="cz-passto">Pass the phone to</p><h1 class="cz-who">' + esc(actor.name) + '</h1>' +
      '<p class="cz-guess">' + (guessers.length ? guessers.join(', ') + ' guess' + (guessers.length === 1 ? 'es' : '') : 'Your team guesses') + '. Everyone else: stay quiet.</p></div>' +
      '<button class="cz-go cz-ready" data-cz="ready">I’m ready</button>' +
      '<p class="cz-rules"><b>+1</b> got it · <b>Skip</b> move on · <b>−1</b> take one back</p></div>', t);
  }

  /* COUNTDOWN then PLAY */
  function countdown() {
    var t = S.team, n = 3;
    setScreen('cz-count', '<div class="cz-count-body"' + teamVars(t) + '><b class="cz-num" id="cz-num">3</b><span class="cz-count-who">' + esc(actorOf(t).name) + ' is acting</span></div>', t);
    SFX.count(false); buzzIt('tap');
    var step = function () {
      n--;
      var el = $('#cz-num', root); if (!el || !isOpen()) return;
      if (n > 0) { el.textContent = n; restart(el); SFX.count(false); buzzIt('tap'); setTimeout(step, 720); }
      else { el.textContent = 'Act!'; el.classList.add('go'); restart(el); SFX.count(true); buzzIt('good'); setTimeout(startTurn, calm() ? 250 : 520); }
    };
    setTimeout(step, 720);
  }
  function restart(el) { if (calm()) return; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }

  function startTurn() {
    if (!isOpen() || !S) return;
    S.phase = 'play'; S.log = []; S.cur = draw();
    var t = S.team;
    setScreen('cz-play',
      '<div class="cz-play-body"' + teamVars(t) + '>' +
      '<div class="cz-hud"><span class="cz-hud-team">' + esc(S.teams[t].name) + '</span><span class="cz-time" id="cz-time">30</span><span class="cz-hud-pts" id="cz-pts">0</span></div>' +
      '<div class="cz-bar"><i id="cz-bar"></i></div>' +
      '<div class="cz-card" id="cz-card">' + cardHtml(S.cur) + '</div>' +
      '<div class="cz-btns"><button class="cz-skip" data-cz="skip">Skip</button><button class="cz-got" data-cz="got"><b>+1</b><small>Got it</small></button><button class="cz-minus" data-cz="minus" disabled aria-label="Take a point back">−1</button></div>' +
      '</div>', t);
    fitName();
    timer.end = performance.now() + TURN_MS; timer.last = 31;
    tick();
    timer.to = setTimeout(timeUp, TURN_MS + 60);   // rAF stops in a hidden tab; this does not
    saveLive();
  }
  function cardHtml(c) {
    return '<span class="cz-tag">' + esc(c.t) + ' · ' + ['', 'easy to act', 'needs a plan', 'good luck'][c.lv] + '</span><h2 class="cz-name" id="cz-name-txt">' + esc(c.a) + '</h2>';
  }
  // The name fills the screen: shrink from huge until it fits, breaking only
  // between words. Measured, not guessed — "Creedence Clearwater Revival" and
  // "Yes" both have to dominate the same box.
  function fitName() {
    var el = $('#cz-name-txt', root), box = $('#cz-card', root); if (!el || !box) return;
    var w = box.clientWidth - 8, h = box.clientHeight - 60;
    var size = Math.min(170, Math.max(40, w / 2.6));
    el.style.fontSize = size + 'px';
    for (var i = 0; i < 30 && (el.scrollWidth > w || el.offsetHeight > h) && size > 22; i++) { size *= 0.92; el.style.fontSize = size + 'px'; }
  }
  window.addEventListener('resize', function () { if (S && S.phase === 'play') fitName(); });

  function tick() {
    var left = Math.max(0, timer.end - performance.now()), secs = Math.ceil(left / 1000);
    var bar = $('#cz-bar', root), tm = $('#cz-time', root), body = $('.cz-play-body', root);
    if (bar) bar.style.transform = 'scaleX(' + (left / TURN_MS) + ')';
    if (tm && secs !== timer.last) {
      timer.last = secs; tm.textContent = secs;
      if (secs <= 5 && secs > 0) { SFX.tick(secs); buzzIt('tap'); if (body) body.classList.add('cz-hurry'); if (!calm()) { tm.classList.remove('pop'); void tm.offsetWidth; tm.classList.add('pop'); } }
    }
    if (left <= 0) return timeUp();
    timer.raf = requestAnimationFrame(tick);
  }
  function stopClock() { cancelAnimationFrame(timer.raf); clearTimeout(timer.to); timer.raf = 0; }

  function act(kind) {
    if (!S || S.phase !== 'play') return;
    if (kind === 'minus') {
      for (var i = S.log.length - 1; i >= 0; i--) if (S.log[i].r === 'got') { S.log[i].r = 'skip'; break; }
      SFX.minus(); buzzIt('bad'); flash('−1', 'minus'); paintPts(); return;
    }
    S.log.push({ a: S.cur.a, r: kind });
    if (kind === 'got') { SFX.got(); buzzIt('good'); flash('+1', 'got'); }
    else { SFX.skip(); buzzIt('tap'); }
    var card = $('#cz-card', root), next = draw();
    S.cur = next;
    if (calm() || !card) { if (card) { card.innerHTML = cardHtml(next); fitName(); } paintPts(); return; }
    card.classList.remove('cz-out-got', 'cz-out-skip', 'cz-in-card'); void card.offsetWidth;
    card.classList.add(kind === 'got' ? 'cz-out-got' : 'cz-out-skip');
    setTimeout(function () {
      if (!S || S.phase !== 'play') return;
      card.classList.remove('cz-out-got', 'cz-out-skip'); card.innerHTML = cardHtml(next); fitName();
      void card.offsetWidth; card.classList.add('cz-in-card');
    }, 170);
    paintPts();
  }
  function turnPts(log) { return (log || S.log).filter(function (x) { return x.r === 'got'; }).length; }
  function paintPts() {
    var p = $('#cz-pts', root); if (p) { p.textContent = turnPts(); if (!calm()) { p.classList.remove('pop'); void p.offsetWidth; p.classList.add('pop'); } }
    var m = $('[data-cz="minus"]', root); if (m) m.disabled = !turnPts();
  }
  function flash(txt, kind) {
    if (calm()) return;
    var body = $('.cz-play-body', root); if (!body) return;
    var f = document.createElement('span'); f.className = 'cz-flash ' + kind; f.textContent = txt;
    body.appendChild(f); setTimeout(function () { f.remove(); }, 900);
  }

  function timeUp() {
    if (!S || S.phase !== 'play') return;
    stopClock();
    // The artist on screen when time ran out was neither got nor skipped:
    // it goes back into the deck rather than counting as a pass.
    S.deck.splice(S.di, 0, S.cur); S.cur = null;
    S.phase = 'tally'; saveLive();
    SFX.buzzer(); buzzIt('big');
    var body = $('.cz-play-body', root);
    if (body && !calm()) {
      var slam = document.createElement('div'); slam.className = 'cz-timeup'; slam.innerHTML = '<b>Time!</b>';
      body.appendChild(slam);
      setTimeout(render, 1100);
    } else render();
  }

  /* TALLY — fix any mistakes, then bank it */
  function renderTally() {
    var t = S.team, pts = turnPts();
    var rows = S.log.map(function (x, i) {
      return '<li><button data-cz="flip" data-i="' + i + '" class="' + x.r + '"><span>' + esc(x.a) + '</span><i>' + (x.r === 'got' ? '✓' : 'skip') + '</i></button></li>';
    }).join('');
    setScreen('cz-tally', topBar('<span class="cz-brand">' + roundLabel() + '</span>') +
      '<div class="cz-tally-body"' + teamVars(t) + '>' +
      '<span class="cz-kick">' + esc(actorOf(t).name) + ' for ' + esc(S.teams[t].name) + '</span>' +
      '<div class="cz-big"><b id="cz-turn-pts">' + pts + '</b><span>' + (pts === 1 ? 'point' : 'points') + '</span></div>' +
      (rows ? '<p class="cz-hint">Tap one to fix it.</p><ul class="cz-log">' + rows + '</ul>' : '<p class="cz-hint">Not a single one. It happens to the best of us.</p>') +
      '<button class="cz-go" data-cz="bank">' + (pts ? 'Bank ' + pts + ' for ' + esc(S.teams[t].name) : 'Next turn') + '</button></div>', t);
  }
  function bank() {
    var t = S.team, pts = turnPts(), actor = actorOf(t);
    actor.pts += pts;
    S.teams[t].score += pts;
    S.turns.push({ team: t, name: actor.name, pts: pts, round: S.round });
    S.teams[t].actor++;
    S.log = [];
    // A round is one turn each. The game can only end once both teams have
    // had the same number of turns, so going first is never an advantage.
    var roundDone = t !== S.first;
    S.team = 1 - t;
    if (roundDone) {
      var a = S.teams[0].score, b = S.teams[1].score;
      var over = S.mode === 'rounds' ? S.round >= S.rounds : (a >= S.target || b >= S.target);
      if (over && a === b) { S.sudden = true; over = false; }
      else if (S.sudden && a !== b) over = true;
      if (over || S.round >= 40) { S.phase = 'final'; saveLive(); return renderFinal(); }
      S.round++;
    }
    S.phase = 'pass'; saveLive();
    renderPass();
    var me = $('.cz-sc' + '.now', root); // the team about to play
    var them = root.querySelectorAll('.cz-sc')[t];
    if (them && pts && !calm()) { them.classList.add('bump'); if (window.burst) try { burst(them, { count: 12 + pts * 2, spread: 90, colors: [t ? '#33d6ff' : '#ff4f8a', '#ffffff'] }); } catch (e) {} }
    void me;
  }

  /* FINAL */
  function renderFinal() {
    stopClock();
    var a = S.teams[0].score, b = S.teams[1].score, w = a > b ? 0 : b > a ? 1 : -1;
    var mvp = S.players.slice().sort(function (x, y) { return y.pts - x.pts; })[0];
    var best = S.turns.slice().sort(function (x, y) { return y.pts - x.pts; })[0];
    recent = {}; S.deck.slice(0, S.di).forEach(function (c) { recent[c.a] = 1; });
    if (window.notePlay) try { notePlay('charades'); } catch (e) {}
    try { localStorage.setItem('crate_charades_last', JSON.stringify({ at: Date.now(), w: w >= 0 ? S.teams[w].name : null, a: a, b: b })); } catch (e) {}
    saveLive();
    setScreen('cz-final', topBar() +
      '<div class="cz-final-body" style="--wc:' + (w < 0 ? 'var(--cz-t0)' : 'var(--cz-t' + w + ')') + ';--wc2:' + (w < 0 ? 'var(--cz-t1)' : 'var(--cz-t' + w + 'b)') + '">' +
      '<div class="cz-drum" id="cz-drum"><span>And the winner is</span><i></i><i></i><i></i></div>' +
      '<div class="cz-reveal" id="cz-reveal" hidden>' +
      '<span class="cz-kick">' + (w < 0 ? 'Nobody. Somehow.' : 'Winners') + '</span>' +
      '<h1 class="cz-champ">' + (w < 0 ? 'A draw' : esc(S.teams[w].name)) + '</h1>' +
      '<div class="cz-final-score">' + [0, 1].map(function (t) { return '<span' + teamVars(t) + ' class="' + (t === w ? 'win' : '') + '"><small>' + esc(S.teams[t].name) + '</small><b data-to="' + S.teams[t].score + '">0</b></span>'; }).join('<em>–</em>') + '</div>' +
      '<div class="cz-awards">' +
      (mvp && mvp.pts ? '<div><small>MVP</small><b>' + esc(mvp.name) + '</b><span>' + mvp.pts + ' got</span></div>' : '') +
      (best && best.pts ? '<div><small>Best turn</small><b>' + esc(best.name) + '</b><span>' + best.pts + ' in 30s</span></div>' : '') +
      '<div><small>Artists acted</small><b>' + S.di + '</b><span>' + DIFFS[S.diff].label + '</span></div>' +
      '</div>' +
      '<div class="cz-final-btns"><button class="cz-go" data-cz="rematch">Rematch</button><button class="cz-ghost" data-cz="newgame">Change players</button></div>' +
      '</div></div>');
    var reveal = function () {
      var d = $('#cz-drum', root), r = $('#cz-reveal', root); if (!r) return;
      if (d) d.hidden = true; r.hidden = false;
      SFX.fanfare(); buzzIt('big');
      r.querySelectorAll('[data-to]').forEach(function (el) { countTo(el, +el.dataset.to); });
      if (window.burst && !calm()) try { burst($('.cz-champ', root), { count: 70, spread: 280, colors: w === 1 ? ['#33d6ff', '#6b7bff', '#ffffff'] : w === 0 ? ['#ff4f8a', '#ff9a3d', '#ffffff'] : ['#ff4f8a', '#33d6ff', '#ffffff'] }); } catch (e) {}
    };
    if (calm()) reveal(); else { tone(110, 1500, 'triangle', .08, 160); setTimeout(reveal, 1700); }
  }
  function countTo(el, to) {
    if (calm() || !to) { el.textContent = to; return; }
    var t0 = performance.now(), d = 900;
    (function f(now) { var k = Math.min(1, (now - t0) / d); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(f); })(t0);
  }

  /* ---- input ------------------------------------------------------------ */
  function onClick(e) {
    var b = e.target.closest('[data-cz]'); if (!b || b.disabled) return;
    var k = b.dataset.cz, i = +b.dataset.i;
    if (k === 'close') return confirmClose();
    if (k === 'sound') { var s = lsGet(STORE) || {}; s.sound = !soundOn(); setup.sound = s.sound; lsSet(STORE, Object.assign({}, setup, { sound: s.sound })); b.classList.toggle('off', !s.sound); b.textContent = s.sound ? '♪' : '♪̸'; if (s.sound) SFX.got(); return; }
    if (k === 'move') { setup.players[i].team = 1 - setup.players[i].team; saveSetup(); buzzIt('tap'); return renderSetup(); }
    if (k === 'rm') { setup.players.splice(i, 1); saveSetup(); return renderSetup(); }
    if (k === 'shuffle') { var ps = shuffle(setup.players.slice()); ps.forEach(function (p, j) { p.team = j % 2; }); setup.players = ps; saveSetup(); buzzIt('tap'); return renderSetup(); }
    if (k === 'names') { var cur = TEAM_NAMES.map(function (p) { return p.join(); }).indexOf(setup.teams.join()); setup.teams = TEAM_NAMES[(cur + 1) % TEAM_NAMES.length].slice(); saveSetup(); return renderSetup(); }
    if (k === 'diff') { setup.diff = b.dataset.v; saveSetup(); return renderSetup(); }
    if (k === 'mode') { setup.mode = b.dataset.v; saveSetup(); return renderSetup(); }
    if (k === 'rounds') { setup.rounds = +b.dataset.v; saveSetup(); return renderSetup(); }
    if (k === 'target') { setup.target = +b.dataset.v; saveSetup(); return renderSetup(); }
    if (k === 'start') { if (!balanced()) return; tone(1, 1, 'sine', 0.0001); newGame(Math.random() < .5 ? 0 : 1); return renderPass(); }
    if (k === 'ready') { tone(1, 1, 'sine', 0.0001); S.phase = 'count'; return countdown(); }
    if (k === 'got' || k === 'skip' || k === 'minus') return act(k);
    if (k === 'flip') { var x = S.log[i]; x.r = x.r === 'got' ? 'skip' : 'got'; saveLive(); buzzIt('tap'); return renderTally(); }
    if (k === 'bank') return bank();
    if (k === 'rematch') { var first = 1 - (S.first || 0); newGame(first); return renderPass(); }
    if (k === 'newgame') { S = null; saveLive(); return renderSetup(); }
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return confirmClose(); }
    if (!S || S.phase !== 'play' || e.target.closest('input')) return;
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowUp') { e.preventDefault(); act('got'); }
    else if (e.key === 'ArrowRight' || e.key === 's') { e.preventDefault(); act('skip'); }
    else if (e.key === 'Backspace' || e.key === 'ArrowDown') { e.preventDefault(); act('minus'); }
  }
  document.addEventListener('submit', function (e) {
    if (!e.target.matches || !e.target.matches('[data-cz-form]')) return;
    e.preventDefault();
    var inp = $('#cz-name', root), name = (inp.value || '').trim().replace(/\s+/g, ' ').slice(0, 20);
    if (!name) return;
    if (setup.players.some(function (p) { return p.name.toLowerCase() === name.toLowerCase(); })) { inp.select(); return; }
    var a = teamOf(0).length, b = teamOf(1).length;
    setup.players.push({ name: name, team: a <= b ? 0 : 1 });
    saveSetup(); renderSetup(); buzzIt('tap');
    var again = $('#cz-name', root); if (again) again.focus();
  });
  document.addEventListener('input', function (e) {
    if (!e.target.classList || !e.target.classList.contains('cz-tname')) return;
    setup.teams[+e.target.dataset.team] = e.target.value.trim().slice(0, 18) || (+e.target.dataset.team ? 'B-Side' : 'A-Side');
    saveSetup();
  });
  function confirmClose() {
    if (S && S.phase === 'play') {
      if (!window.ask) return close();
      stopClock();
      ask({ title: 'Stop this turn?', body: 'The game is kept — this turn is replayed from the start when you come back.', confirm: 'Stop turn', cancel: 'Keep acting' }).then(function (y) {
        if (y) { S.log = []; S.deck.splice(S.di, 0, S.cur); S.phase = 'pass'; saveLive(); close(); }
        else { timer.end = performance.now() + Math.max(1000, timer.end - performance.now()); tick(); timer.to = setTimeout(timeUp, Math.max(1000, timer.end - performance.now()) + 60); }
      });
      return;
    }
    close();
  }

  /* ---- the Arcade card ---------------------------------------------------- */
  function paintCard() {
    var st = document.getElementById('charades-card-go'); if (!st) return;
    var live = S || lsGet(LIVE, sessionStorage);
    st.textContent = live && live.phase && live.phase !== 'final' ? 'Carry on: ' + live.teams[0].score + '–' + live.teams[1].score + ' →' : 'Get the party going →';
  }
  function wireCard() {
    var c = document.getElementById('charades-card'); if (!c) return;
    c.setAttribute('role', 'button'); c.tabIndex = 0;
    c.addEventListener('click', open);
    c.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    // The name on the card rotates through the pool, the way a party game's
    // box art would.
    var name = c.querySelector('.cz-art-name'), i = 0;
    var easy = POOL.filter(function (r) { return r[1] === 1 && r[0].length <= 14; });
    if (name && !calm()) setInterval(function () {
      if (document.hidden || !c.offsetParent) return;
      i = (i + 1 + Math.floor(Math.random() * 7)) % easy.length;
      name.classList.remove('swap'); void name.offsetWidth; name.textContent = easy[i][0]; name.classList.add('swap');
    }, 2600);
    paintCard();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireCard); else wireCard();

  window.Charades = { open: open, POOL: POOL, buildDeck: buildDeck };
  window.openCharades = open;
})();
