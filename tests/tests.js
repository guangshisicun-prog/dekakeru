// myでかけるのテスト
// アプリ（../index.html）を画面の中の小窓で開いて、計算と操作をたしかめる。
// ほんとうのデータを消さないように、テストの前にとっておいて、最後に元にもどす。

const KEY = 'dekakeru-data-v1';
const groups = [];
let current = null;
function group(name, fn) { current = { name, tests: [] }; groups.push(current); fn(); }
function test(name, fn) { current.tests.push({ name, fn }); }

class Fail extends Error {}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Fail(`${msg || ''}\n  期待: ${e}\n  実際: ${a}`);
}
function ok(cond, msg) { if (!cond) throw new Fail(msg || '条件が成り立っていません'); }

// 「今日」は 2026-10-22（木）に決めておく
const TODAY = new Date(2026, 9, 22, 8, 0);

// アプリを開く。data を入れておくと、それが保存されている状態で始まる
function loadApp(data) {
  localStorage.removeItem(KEY);
  if (data) localStorage.setItem(KEY, JSON.stringify(data));
  const frame = document.getElementById('app');
  return new Promise((resolve) => {
    frame.onload = () => {
      const w = frame.contentWindow;
      w.__errors = [];
      w.addEventListener('error', (e) => w.__errors.push(e.message));
      w.confirm = () => true;
      w.__alerts = [];
      w.alert = (m) => w.__alerts.push(m);
      w.__today = TODAY;
      w.renderHome();
      const $ = (s) => w.document.querySelector(s);
      resolve({
        w, $,
        click(s) { (typeof s === 'string' ? $(s) : s).click(); },
        set(el, v, ev = 'input') { el = typeof el === 'string' ? $(el) : el; el.value = v; el.dispatchEvent(new w.Event(ev, { bubbles: true })); },
        stored: () => JSON.parse(localStorage.getItem(KEY)),
      });
    };
    frame.src = '../index.html?' + Date.now();
  });
}

// よく使うルートの見本：家→駅 歩き10分 → 電車20分 → 駅→大学 歩き8分
const T = (s) => s.split(' ').map((x) => { const [h, m] = x.split(':'); return +h * 60 + +m; });
function sampleRoute(extra = {}) {
  return Object.assign({
    id: 'r1', name: '家→大学', buffer: 5,
    legs: [
      { type: 'walk', label: '家→駅', minutes: 10 },
      { type: 'ride', label: '電車', minutes: 20, times: { weekday: T('7:30 7:45 8:00 8:15 8:30'), holiday: T('7:40 8:20') } },
      { type: 'walk', label: '駅→大学', minutes: 8 },
    ],
  }, extra);
}
function sampleData() { return { version: 1, routes: [sampleRoute()], lastRouteId: 'r1', lastArrive: '09:00' }; }

// =====================================================================
group('時刻の読みかた', () => {
  test('「7:05」を分になおせる', async () => {
    const { w } = await loadApp();
    eq(w.toMin('7:05'), 425); eq(w.toMin('07:05'), 425); eq(w.toMin('24:10'), 1450);
    eq(w.toMin('7時'), null); eq(w.toMin('7:60'), null);
    eq(w.fmt(425), '7:05'); eq(w.fmt(600), '10:00');
  });
  test('時刻を並べた書きかたを読める', async () => {
    const { w } = await loadApp();
    eq(w.parseTimetable('7:05 7:20, 8:10'), T('7:05 7:20 8:10'));
  });
  test('駅の時刻表の書きかた（7: 05 20）を読める', async () => {
    const { w } = await loadApp();
    eq(w.parseTimetable('7: 05 20 35\n8: 00 15'), T('7:05 7:20 7:35 8:00 8:15'));
    eq(w.parseTimetable('7時 05 20\n８時'), T('7:05 7:20'));
  });
  test('全角のコロン・順番ばらばら・重なりも直す', async () => {
    const { w } = await loadApp();
    eq(w.parseTimetable('8：10 7:05 7:05'), T('7:05 8:10'));
  });
  test('便ごとの着く時刻（6:50→7:43）を読める', async () => {
    const { w } = await loadApp();
    eq(w.parseTimetable('6:50→7:43 7:01-8:00 7:06 → 7:59\n7: 20'), [[410, 463], [421, 480], [426, 479], 440]);
    eq(w.timetableText(w.parseTimetable('7:20 6:50→7:43')), '6:50→7:43 7:20');
  });
  test('着く時刻が発車より前なら、発車時刻だけにする', async () => {
    const { w } = await loadApp();
    eq(w.parseTimetable('8:00→7:00'), [480]);
  });
  test('空っぽや変な文字は無視する', async () => {
    const { w } = await loadApp();
    eq(w.parseTimetable(''), []); eq(w.parseTimetable('あいう 99:99'), []);
  });
  test('平日と土日がわかる', async () => {
    const { w } = await loadApp();
    eq(w.dayTypeOf(new Date(2026, 9, 22)), 'weekday');
    eq(w.dayTypeOf(new Date(2026, 9, 24)), 'holiday');
    eq(w.dayTypeOf(new Date(2026, 9, 25)), 'holiday');
  });
});

// =====================================================================
group('逆算', () => {
  test('9:00に着きたい → 8:20に出て8:58着（よゆう5分）', async () => {
    const { w } = await loadApp();
    const r = w.plan(sampleRoute(), 540, 'weekday');
    // 8:55までに着く必要がある。8:30発だと8:58着でダメ、8:15発→8:43着
    eq(r.target, 535);
    eq(w.fmt(r.best.leave), '8:05'); eq(w.fmt(r.best.arrive), '8:43');
    eq(w.fmt(r.earlier.leave), '7:50'); eq(w.fmt(r.later.leave), '8:20');
  });
  test('ぴったり間に合う便はOK', async () => {
    const { w } = await loadApp();
    const r = w.plan(sampleRoute({ buffer: 0 }), T('8:58')[0], 'weekday');
    eq(w.fmt(r.best.leave), '8:20');
    eq(r.later, null, '最終便なので1本後はない');
  });
  test('土日祝は土日の時刻表を使う', async () => {
    const { w } = await loadApp();
    const r = w.plan(sampleRoute(), 540, 'holiday');
    eq(w.fmt(r.best.leave), '8:10'); eq(w.fmt(r.earlier.leave), '7:30');
  });
  test('間に合う便がないときは best が空', async () => {
    const { w } = await loadApp();
    const r = w.plan(sampleRoute(), T('7:30')[0], 'weekday');
    eq(r.best, null); eq(w.fmt(r.later.leave), '7:20');
  });
  test('乗りかえ：2本目の電車を待つ時間も入る', async () => {
    const { w } = await loadApp();
    const route = sampleRoute({ buffer: 0 });
    route.legs.splice(2, 0, { type: 'walk', label: '乗りかえ', minutes: 3 },
      { type: 'ride', label: 'バス', minutes: 10, times: { weekday: T('8:00 8:30 9:00'), holiday: [] } });
    const r = w.plan(route, 540, 'weekday');
    // 8:00発の電車→8:20着→歩き3分→8:23→バス8:30まで7分待ち→8:40→歩き8分→8:48着。8:15発だとバスに間に合わない
    eq(w.fmt(r.best.leave), '7:50'); eq(w.fmt(r.best.arrive), '8:48');
    eq(r.best.steps[3].wait, 7, 'バスを7分待つ');
    eq(w.fmt(r.earlier.arrive), '8:18');
  });
  test('同じ時刻に着く便がいくつかあれば、おそく出るほうにする', async () => {
    const { w } = await loadApp();
    const route = sampleRoute({ buffer: 0 });
    route.legs.splice(2, 0, { type: 'ride', label: 'バス', minutes: 10, times: { weekday: T('9:00'), holiday: [] } });
    const r = w.plan(route, 600, 'weekday');
    eq(w.fmt(r.best.leave), '8:20'); eq(r.earlier, null);
  });
  test('便ごとに着く時刻がちがうバスでは、その時刻で計算する', async () => {
    const { w } = await loadApp();
    // 6:50発は7:43着（53分）、7:01発は8:00着（59分）。乗っている時間の欄（99分）は使わない
    const route = { buffer: 0, legs: [{ type: 'walk', minutes: 10 },
      { type: 'ride', minutes: 99, times: { weekday: w.parseTimetable('6:50→7:43 7:01→8:00 7:06→7:59'), holiday: [] } }] };
    const r = w.plan(route, T('7:59')[0], 'weekday');
    eq(w.fmt(r.best.leave), '6:56'); eq(w.fmt(r.best.arrive), '7:59');
    eq(w.fmt(r.earlier.leave), '6:40', '先に出ても8:00着になる7:01発は出さない');
    eq(r.later, null);
  });
  test('歩きだけのルートもOK', async () => {
    const { w } = await loadApp();
    const r = w.plan({ buffer: 2, legs: [{ type: 'walk', minutes: 15 }] }, 540, 'weekday');
    eq(w.fmt(r.best.leave), '8:43');
  });
  test('時刻表が空なら best が空', async () => {
    const { w } = await loadApp();
    const route = sampleRoute(); route.legs[1].times.weekday = [];
    eq(w.plan(route, 540, 'weekday').best, null);
  });
});

// =====================================================================
group('ホーム画面', () => {
  test('ルートがないときは案内が出る', async () => {
    const app = await loadApp();
    ok(app.$('#h-result').textContent.includes('設定→読みこむ'));
  });
  test('家を出る時刻が出る（木曜なので平日）', async () => {
    const app = await loadApp(sampleData());
    eq(app.$('#h-leave').textContent, '8:05');
    ok(app.$('#h-day .on').dataset.day === 'weekday');
    eq(app.$('#h-opts').querySelectorAll('.opt').length, 3);
  });
  test('道のりは、時刻と説明が横に並ぶ（時刻の欄は折り返さない）', async () => {
    const app = await loadApp(sampleData());
    const steps = [...app.$('#h-steps').querySelectorAll('.step')];
    eq(steps.map((st) => st.querySelector('b').textContent), ['8:05', '8:15', '8:35', '8:43']);
    ok(steps.every((st) => st.querySelector(':scope > span')), '説明は span に入る');
    eq(app.w.getComputedStyle(steps[0]).display, 'flex');
  });
  test('1本前・1本後は押すと道のりが開く（おすすめは開かない）', async () => {
    const app = await loadApp(sampleData());
    const opts = [...app.$('#h-opts').children];
    eq(opts.map((o) => o.tagName), ['DETAILS', 'DIV', 'DETAILS']);
    const first = opts[0];
    ok(!first.open, 'はじめは閉じている');
    first.querySelector('summary').click();
    ok(first.open, '押すと開く');
    const times = [...first.querySelectorAll('.step b')].map((b) => b.textContent);
    eq(times[0], first.querySelector('summary span:nth-child(2)').textContent.split(' ')[0], '出る時刻からはじまる');
    eq(times.at(-1), first.querySelector('summary span:nth-child(2)').textContent.match(/→ (\S+) 着/)[1], '着く時刻でおわる');
    ok(first.querySelector('.step span').textContent.length > 0, '乗りものの説明がある');
  });
  test('押せる行も、時刻は右にそろう', async () => {
    const app = await loadApp(sampleData());
    const rules = [...app.w.document.styleSheets].filter((s) => !s.href).flatMap((s) => [...s.cssRules]); // 外の文字（Google Fonts）は読めないので、アプリの中のものだけ
    const rule = rules.find((r) => r.selectorText === 'details.opt summary span:nth-child(2)');
    eq(rule && rule.style.marginLeft, 'auto');
  });
  test('開いた道のりは、おすすめの道のりと id がかぶらない', async () => {
    const app = await loadApp(sampleData());
    eq(app.$('#h-result').querySelectorAll('#h-steps').length, 1);
  });
  test('出発時刻で調べたときも、1本後を押すと道のりが開く', async () => {
    const app = await loadApp(sampleData());
    app.click('#h-mode [data-mode="depart"]');
    app.set('#h-arrive', '07:58');
    const later = [...app.$('#h-opts').children].at(-1);
    eq(later.tagName, 'DETAILS');
    later.querySelector('summary').click();
    ok(later.querySelectorAll('.step').length >= 2);
  });
  test('着きたい時刻を変えると計算しなおして、覚えておく', async () => {
    const app = await loadApp(sampleData());
    app.set('#h-arrive', '08:40');
    eq(app.$('#h-leave').textContent, '7:50');
    eq(app.stored().lastArrive, '08:40');
  });
  test('土日祝に切りかえられる', async () => {
    const app = await loadApp(sampleData());
    app.click('#h-day [data-day="holiday"]');
    eq(app.$('#h-leave').textContent, '8:10');
  });
  test('間に合わないときはそう出る', async () => {
    const app = await loadApp(sampleData());
    app.set('#h-arrive', '07:00');
    ok(app.$('#h-result').textContent.includes('着ける便がありません'));
  });
});

// =====================================================================
group('出発時刻で調べる', () => {
  test('8:00に出る → 8:05まで待てて、8:43に着く', async () => {
    const { w } = await loadApp();
    const r = w.planFrom(sampleRoute(), T('8:00')[0], 'weekday');
    eq(w.fmt(r.best.leave), '8:05'); eq(w.fmt(r.best.arrive), '8:43');
    eq(w.fmt(r.earlier.leave), '7:50'); eq(w.fmt(r.later.leave), '8:20');
  });
  test('ちょうどの時刻に出る便もOK', async () => {
    const { w } = await loadApp();
    eq(w.fmt(w.planFrom(sampleRoute(), T('8:20')[0], 'weekday').best.arrive), '8:58');
  });
  test('もう便がないときは best が空で、さいごの便を出す', async () => {
    const { w } = await loadApp();
    const r = w.planFrom(sampleRoute(), T('8:30')[0], 'weekday');
    eq(r.best, null); eq(w.fmt(r.earlier.leave), '8:20');
  });
  test('歩きだけのルートは、出た時刻に歩く時間を足す', async () => {
    const { w } = await loadApp();
    eq(w.fmt(w.planFrom({ legs: [{ type: 'walk', minutes: 15 }] }, 480, 'weekday').best.arrive), '8:15');
  });
  test('便ごとに着く時刻がちがっても、いちばんはやく着く便にする', async () => {
    const { w } = await loadApp();
    const route = { legs: [{ type: 'ride', minutes: 0, times: { weekday: w.parseTimetable('7:01→8:00 7:06→7:59'), holiday: [] } }] };
    const r = w.planFrom(route, T('7:00')[0], 'weekday');
    eq(w.fmt(r.best.leave), '7:06'); eq(w.fmt(r.best.arrive), '7:59');
  });
  test('画面：出発時刻に切りかえると、着く時刻が大きく出る', async () => {
    const app = await loadApp(sampleData());
    app.click('#h-mode [data-mode="depart"]');
    eq(app.$('#h-time-label').textContent, '出発時刻');
    app.set('#h-arrive', '08:00');
    eq(app.$('#h-leave').textContent, '8:43');
    eq(app.$('#h-result h2').textContent, '大学に着く時刻');
    ok(app.$('#h-result').textContent.includes('8:05 までに出ればOK'));
    eq([app.stored().lastMode, app.stored().lastDepart, app.stored().lastArrive], ['depart', '08:00', '09:00']);
  });
  test('画面：「いま」ボタンで出発時刻がいまの時刻になる', async () => {
    const app = await loadApp(sampleData());
    ok(app.$('#h-now').hidden, '着きたい時刻のときは出さない');
    app.click('#h-mode [data-mode="depart"]');
    ok(!app.$('#h-now').hidden, '出発時刻のときは出す');
    app.w.__today = new Date(2026, 9, 22, 7, 58);
    app.click('#h-now');
    eq(app.$('#h-arrive').value, '07:58');
    eq(app.stored().lastDepart, '07:58');
    eq(app.$('#h-leave').textContent, '8:43', '8:05に出て8:43着');
  });
  test('画面：着きたい時刻にもどすと、前の時刻で逆算する', async () => {
    const app = await loadApp(sampleData());
    app.click('#h-mode [data-mode="depart"]');
    app.set('#h-arrive', '08:00');
    app.click('#h-mode [data-mode="arrive"]');
    eq(app.$('#h-arrive').value, '09:00');
    eq(app.$('#h-leave').textContent, '8:05');
  });
  test('画面：もう便がないときはそう出る', async () => {
    const app = await loadApp(sampleData());
    app.click('#h-mode [data-mode="depart"]');
    app.set('#h-arrive', '09:00');
    ok(app.$('#h-result').textContent.includes('着ける便がありません'));
  });
});

// =====================================================================
group('発と着', () => {
  // 家→大学（電車）、家→大学（バス・おそく出られる）、大学→家、家→バイト
  function multiData() {
    const bus = sampleRoute({ id: 'r2', name: undefined, from: '家', to: '大学', buffer: 5 });
    bus.legs[1] = { type: 'ride', label: 'バス', minutes: 20, times: { weekday: T('8:25'), holiday: [] } };
    const back = sampleRoute({ id: 'r3', name: undefined, from: '大学', to: '家' });
    const job = sampleRoute({ id: 'r4', name: undefined, from: '家', to: 'バイト' });
    return { version: 1, routes: [sampleRoute(), bus, back, job], lastFrom: '家', lastTo: '大学', lastArrive: '09:00' };
  }
  test('前の形（名前だけ）のデータは、名前の「→」で発と着に分ける', async () => {
    const app = await loadApp(sampleData());
    eq([app.$('#h-from').value, app.$('#h-to').value], ['家', '大学']);
  });
  test('「発」の場所の名前で「〇〇を出る時刻」と出る', async () => {
    const app = await loadApp(sampleData());
    ok(app.$('#h-result h2').textContent === '家を出る時刻');
  });
  test('発・着は同じ名前を1つにまとめて出す', async () => {
    const app = await loadApp(multiData());
    eq([...app.$('#h-from').options].map((o) => o.value), ['家', '大学']);
    eq([...app.$('#h-to').options].map((o) => o.value), ['大学', 'バイト']);
  });
  test('発を変えると、行ける着だけになる', async () => {
    const app = await loadApp(multiData());
    app.set('#h-from', '大学', 'change');
    eq([...app.$('#h-to').options].map((o) => o.value), ['家']);
    eq(app.$('#h-result h2').textContent, '大学を出る時刻');
    eq([app.stored().lastFrom, app.stored().lastTo], ['大学', '家']);
  });
  test('⇄ボタンで発と着を入れかえる', async () => {
    const app = await loadApp(multiData());
    app.click('#h-swap');
    eq([app.$('#h-from').value, app.$('#h-to').value], ['大学', '家']);
    eq(app.$('#h-result h2').textContent, '大学を出る時刻');
    eq([app.stored().lastFrom, app.stored().lastTo], ['大学', '家']);
    app.click('#h-swap');
    eq([app.$('#h-from').value, app.$('#h-to').value], ['家', '大学']);
  });
  test('逆向きのルートがないときは、入れかえずに知らせる', async () => {
    const app = await loadApp(multiData());
    app.set('#h-to', 'バイト', 'change');
    app.click('#h-swap');
    eq([app.$('#h-from').value, app.$('#h-to').value], ['家', 'バイト']);
    eq(app.w.__alerts, ['「バイト」発のルートがまだありません。']);
  });
  test('同じ発・着のルートが2つあれば、おそく出られるほうを使う', async () => {
    const app = await loadApp(multiData());
    // 電車：8:05に出る、バス：8:15に出る（8:25発→8:45→8:53着）
    eq(app.$('#h-leave').textContent, '8:15');
    ok(app.$('#h-steps').textContent.includes('バス'));
  });
  test('着を選ぶと覚えておく', async () => {
    const app = await loadApp(multiData());
    app.set('#h-to', 'バイト', 'change');
    eq(app.stored().lastTo, 'バイト');
    const again = await loadApp(app.stored());
    eq(again.$('#h-to').value, 'バイト');
  });
});

// =====================================================================
group('雨の日モード', () => {
  // 雨の日ルート：家→バス停 歩き15分 → バス20分 → 歩き8分
  function rainRoute() {
    const r = sampleRoute({ id: 'r1-rain', name: undefined, from: '家', to: '大学', rain: true });
    r.legs[0] = { type: 'walk', label: '家→バス停', minutes: 15 };
    r.legs[1] = { type: 'ride', label: 'バス', minutes: 20, times: { weekday: T('7:50 8:05'), holiday: [] } };
    return r;
  }
  function rainData(extra = {}) {
    const job = sampleRoute({ id: 'r4', name: undefined, from: '家', to: 'バイト' });
    return Object.assign({ version: 1, routes: [sampleRoute(), rainRoute(), job], lastFrom: '家', lastTo: '大学', lastArrive: '09:00' }, extra);
  }
  test('ふだんは雨の日ルートを使わない（ボタンは見出しの横に小さく）', async () => {
    const app = await loadApp(rainData());
    eq(app.$('#h-rain').textContent, '☔ 雨の日');
    ok(app.$('#h-rain').parentElement.classList.contains('head'), '見出しの横にある');
    ok(app.$('#h-rain').getBoundingClientRect().height < 40, '小さいボタン');
    eq(app.$('#h-leave').textContent, '8:05');
    ok(!app.$('#h-rain').classList.contains('on'));
    ok(!app.$('#h-result .rain-note'), '雨の日のひとことは出ない');
    eq([...app.$('#h-to').options].map((o) => o.value), ['大学', 'バイト'], '着の一覧に同じ場所が2つ出ない');
  });
  test('☔ボタンで雨の日ルートになり、きょうの日付を覚える', async () => {
    const app = await loadApp(rainData());
    app.click('#h-rain');
    ok(app.$('#h-rain').classList.contains('on'));
    eq(app.$('#h-rain').textContent, '☔ 雨の日 オン');
    eq(app.stored().rainDay, '2026-10-22');
    eq(app.$('#h-leave').textContent, '7:50');
    eq(app.$('#h-result .rain-note').textContent, '☔ 雨の日ルート（きょうだけ）');
    ok(app.$('#h-steps').textContent.includes('家→バス停'));
  });
  test('もう一度押すと、ふだんにもどる', async () => {
    const app = await loadApp(rainData());
    app.click('#h-rain');
    app.click('#h-rain');
    ok(!app.$('#h-rain').classList.contains('on'));
    eq(app.stored().rainDay, null);
    eq(app.$('#h-leave').textContent, '8:05');
  });
  test('つぎの日には自動でふだんにもどる', async () => {
    const app = await loadApp(rainData({ rainDay: '2026-10-21' }));
    ok(!app.$('#h-rain').classList.contains('on'));
    eq(app.$('#h-leave').textContent, '8:05');
  });
  test('雨の日ルートがない発・着は、ふだんのルートを使ってそう出す', async () => {
    const app = await loadApp(rainData({ rainDay: '2026-10-22', lastTo: 'バイト' }));
    ok(app.$('#h-rain').classList.contains('on'));
    eq(app.$('#h-leave').textContent, '8:05');
    ok(app.$('#h-result .rain-note').textContent.includes('雨の日のルートがまだない'));
  });
  test('出発時刻で調べるときも、雨の日ルートを使う', async () => {
    const app = await loadApp(rainData({ rainDay: '2026-10-22', lastMode: 'depart', lastDepart: '07:40' }));
    eq(app.$('#h-leave').textContent, '8:33', '7:50に出て 8:05のバス→8:25→歩き8分');
    eq(app.$('#h-result .rain-note').textContent, '☔ 雨の日ルート（きょうだけ）');
  });
  test('雨の日ルートのファイルを読みこむとき「（雨の日）」と出る', async () => {
    const app = await loadApp(sampleData());
    const asked = [];
    app.w.confirm = (m) => { asked.push(m); return true; };
    ok(app.w.importText(JSON.stringify({ addRoutes: [rainRoute()] })));
    ok(asked[0].includes('家→大学（雨の日）'), asked[0]);
    eq(app.stored().routes.find((r) => r.id === 'r1-rain').rain, true);
  });
});

// =====================================================================
group('時刻表', () => {
  // [分, 系統, 行き先, 経由, 方面]
  function sampleTT() {
    return { id: 'roji', name: '老司 → 天神・博多', stop: '老司',
      weekday: [[T('7:50')[0], '47', '博多駅', '普通・清水四', '博多駅'], [T('8:05')[0], '62', '福岡タワー', '普通・天神', '天神'], [T('8:20')[0], '48', '博多駅', '普通', '博多駅']],
      saturday: [[T('9:00')[0], '47', '博多ふ頭', '普通', '博多駅']],
      holiday: [] };
  }
  test('時刻表がないときは案内が出る', async () => {
    const app = await loadApp(sampleData());
    app.click('nav [data-tab="tt"]');
    ok(app.$('#p-tt').classList.contains('on'));
    ok(app.$('#t-list').textContent.includes('設定→読みこむ'));
  });
  test('時刻表だけのファイルを読みこむと足される（ルートは消えない）', async () => {
    const app = await loadApp(sampleData());
    ok(app.w.importText(JSON.stringify({ addTimetables: [sampleTT()] })));
    eq(app.stored().timetables.map((t) => t.id), ['roji']);
    eq(app.stored().routes.length, 1);
    ok(app.w.importText(JSON.stringify({ addTimetables: [sampleTT()] })));
    eq(app.stored().timetables.length, 1, '同じidは上書き');
  });
  test('木曜は平日の時刻表で、いまから出る便が上から出て、つぎの便に印がつく', async () => {
    const app = await loadApp(Object.assign(sampleData(), { timetables: [sampleTT()] }));
    app.click('nav [data-tab="tt"]');
    eq(app.$('#t-day .on').dataset.day, 'weekday');
    const rows = [...app.$('#t-list').querySelectorAll('.bus')];
    eq(rows.map((r) => r.querySelector('b').textContent), ['8:05', '8:20'], '8:00より前の便は出さない');
    eq(rows[0].querySelector('.no').textContent, '62');
    ok(rows[0].querySelector('.what').textContent.startsWith('福岡タワー行'));
    ok(rows[0].classList.contains('next'), '8:05がつぎの便（いちばん上）');
    eq(app.$('#t-past').textContent, '過ぎた便も見る（1本）');
  });
  test('「過ぎた便も見る」で、過ぎた便もうすく出る（もう一度押すとかくれる）', async () => {
    const app = await loadApp(Object.assign(sampleData(), { timetables: [sampleTT()] }));
    app.click('nav [data-tab="tt"]');
    app.click('#t-past');
    const rows = [...app.$('#t-list').querySelectorAll('.bus')];
    eq(rows.map((r) => r.querySelector('b').textContent), ['7:50', '8:05', '8:20']);
    ok(rows[0].classList.contains('past'), '7:50は過ぎた便');
    ok(rows[1].classList.contains('next'), '8:05がつぎの便');
    eq(app.$('#t-past').textContent, '過ぎた便をかくす');
    app.click('#t-past');
    eq(app.$('#t-list').querySelectorAll('.bus').length, 2);
  });
  test('きょうの便がもうないときは、そう出る', async () => {
    const tt = sampleTT(); tt.weekday = [tt.weekday[0]];
    const app = await loadApp(Object.assign(sampleData(), { timetables: [tt] }));
    app.click('nav [data-tab="tt"]');
    ok(app.$('#t-list').textContent.includes('きょうの便はもうありません'));
    app.click('#t-past');
    eq([...app.$('#t-list').querySelectorAll('.bus b')].map((b) => b.textContent), ['7:50']);
  });
  test('ほかの曜日を見るときは、ぜんぶの便を出す', async () => {
    const tt = sampleTT(); tt.saturday.unshift([T('6:00')[0], '47', '博多駅', '普通', '博多駅']);
    const app = await loadApp(Object.assign(sampleData(), { timetables: [tt] }));
    app.click('nav [data-tab="tt"]');
    app.click('#t-day [data-day="saturday"]');
    eq([...app.$('#t-list').querySelectorAll('.bus b')].map((b) => b.textContent), ['6:00', '9:00']);
    ok(!app.$('#t-past'), 'ボタンは出ない');
  });
  test('過ぎた便も出したときは、つぎの便までスクロールする', async () => {
    const app = await loadApp(Object.assign(sampleData(), { timetables: [sampleTT()] }));
    const calls = [];
    app.w.HTMLElement.prototype.scrollIntoView = function () { calls.push(this.querySelector('b').textContent); };
    app.w.scrollTo = () => calls.push('上');
    app.click('nav [data-tab="tt"]');
    ok(!calls.includes('8:05'), 'つぎの便がいちばん上なのでスクロールしない');
    app.click('#t-past');
    eq(calls.at(-1), '8:05', '過ぎた便も出したら、つぎの便へ');
  });
  test('土曜・日祝をえらべる（便がない日は案内）', async () => {
    const app = await loadApp(Object.assign(sampleData(), { timetables: [sampleTT()] }));
    app.click('nav [data-tab="tt"]');
    app.click('#t-day [data-day="saturday"]');
    eq([...app.$('#t-list').querySelectorAll('.bus b')].map((b) => b.textContent), ['9:00']);
    ok(!app.$('#t-list .next'), 'きょうではないので印はつかない');
    app.click('#t-day [data-day="holiday"]');
    ok(app.$('#t-list').textContent.includes('便はありません'));
  });
  test('行き先で天神・博多駅にしぼれる', async () => {
    const app = await loadApp(Object.assign(sampleData(), { timetables: [sampleTT()] }));
    app.click('nav [data-tab="tt"]');
    app.click('#t-day [data-day="weekday"]');
    app.click('#t-past');
    app.click('#t-area [data-area="天神"]');
    eq([...app.$('#t-list').querySelectorAll('.bus .no')].map((b) => b.textContent), ['62']);
    app.click('#t-area [data-area="博多駅"]');
    eq([...app.$('#t-list').querySelectorAll('.bus .no')].map((b) => b.textContent), ['47', '48']);
    app.click('#t-area [data-area=""]');
    eq(app.$('#t-list').querySelectorAll('.bus').length, 3);
  });
  test('天神・博多駅にしぼると、着く時刻のじゅんに並び、着く時刻も出る', async () => {
    const tt = sampleTT();
    // 7:50発は8:40着、8:20発は8:35着（あとから出ても先に着く）
    tt.weekday[0].push(T('8:40')[0]); tt.weekday[1].push(T('8:30')[0]); tt.weekday[2].push(T('8:35')[0]);
    const app = await loadApp(Object.assign(sampleData(), { timetables: [tt] }));
    app.click('nav [data-tab="tt"]');
    app.click('#t-past');
    eq([...app.$('#t-list').querySelectorAll('.bus b')].map((b) => b.textContent), ['7:50', '8:05', '8:20'], 'ぜんぶは出るじゅん');
    app.click('#t-area [data-area="博多駅"]');
    eq([...app.$('#t-list').querySelectorAll('.bus b')].map((b) => b.textContent), ['8:20', '7:50'], '博多駅に早く着くじゅん');
    ok(app.$('#t-list .bus small').textContent.startsWith('博多駅 8:35着'));
    ok(app.$('#t-list .bus').classList.contains('next'), 'つぎの便（8:20）に印');
  });
  test('便を押すと、停まるバス停と時刻がひらく', async () => {
    const tt = sampleTT();
    tt.weekday[1].push(T('8:30')[0], [['老司', T('8:05')[0]], ['大橋一丁目', T('8:15')[0]], ['天神南', T('8:30')[0]]]);
    const app = await loadApp(Object.assign(sampleData(), { timetables: [tt] }));
    app.click('nav [data-tab="tt"]');
    const bus = app.$('#t-list .bus.next');
    ok(!bus.open, 'はじめは閉じている');
    bus.querySelector('summary').click();
    ok(bus.open, '押すとひらく');
    eq([...bus.querySelectorAll('.stops > div')].map((d) => d.textContent), ['8:05老司', '8:15大橋一丁目', '8:30天神南']);
    eq([...app.$('#t-list').querySelectorAll('.bus')].at(-1).querySelectorAll('.stops').length, 0, 'バス停のデータがない便は、ひらいても何も出ない');
  });
  function backTT() {
    // 帰り：[分, 系統, 行き先, 経由, 乗る場所, 老司に着く分, 停車バス停, 乗るバス停]
    return { id: 'roji-back', name: '天神・博多 → 老司', dir: 'back',
      weekday: [[T('8:10')[0], 'W1', '那珂川営業所', '普通・天神-大橋', '天神', T('8:45')[0], [['天神北', T('8:10')[0]], ['老司', T('8:45')[0]]], '天神北'],
        [T('8:15')[0], '47', '那珂川営業所', '普通・清水四', '博多駅', T('8:40')[0], [['博多駅前A', T('8:15')[0]], ['老司', T('8:40')[0]]], '博多駅前A']],
      saturday: [], holiday: [] };
  }
  test('行き／帰りのボタンで、帰りの時刻表に切りかわる（覚えておく）', async () => {
    const app = await loadApp(Object.assign(sampleData(), { timetables: [sampleTT(), backTT()] }));
    app.click('nav [data-tab="tt"]');
    ok(!app.$('#t-dir').hidden, '両方あるのでボタンが出る');
    eq(app.$('#t-dir .on').dataset.dir, 'go');
    eq(app.$('#t-title').textContent, '老司 → 天神・博多');
    app.click('#t-dir [data-dir="back"]');
    eq(app.$('#t-title').textContent, '天神・博多 → 老司');
    eq(app.stored().lastTtDir, 'back');
    ok(app.$('#t-area-label').textContent.startsWith('乗る場所'));
    const small = app.$('#t-list .bus small').textContent;
    ok(small.startsWith('天神北から・老司 8:45着'), small);
  });
  test('帰りで天神・博多駅にしぼると、老司に早く着くじゅん', async () => {
    const app = await loadApp(Object.assign(sampleData(), { timetables: [sampleTT(), backTT()], lastTtDir: 'back' }));
    app.click('nav [data-tab="tt"]');
    eq([...app.$('#t-list').querySelectorAll('.bus b')].map((b) => b.textContent), ['8:10', '8:15'], 'ぜんぶは出るじゅん');
    app.click('#t-area [data-area="博多駅"]');
    eq([...app.$('#t-list').querySelectorAll('.bus .no')].map((b) => b.textContent), ['47']);
    ok(app.$('#t-list .bus small').textContent.startsWith('博多駅前Aから・老司 8:40着'), '乗るのりばの名前が出る');
  });
  test('時刻表が片方だけなら、行き／帰りのボタンは出さない', async () => {
    const app = await loadApp(Object.assign(sampleData(), { timetables: [sampleTT()] }));
    app.click('nav [data-tab="tt"]');
    ok(app.$('#t-dir').hidden);
  });
  test('土曜日はさいしょから土曜の時刻表になる', async () => {
    const app = await loadApp(Object.assign(sampleData(), { timetables: [sampleTT()] }));
    eq(app.w.ttDayOf(new Date(2026, 9, 24)), 'saturday');
    eq(app.w.ttDayOf(new Date(2026, 9, 25)), 'holiday');
    eq(app.w.ttDayOf(new Date(2026, 9, 26)), 'weekday');
  });
});

// =====================================================================
group('バックアップ', () => {
  test('読みこむと入れかわる', async () => {
    const app = await loadApp();
    ok(app.w.importText(JSON.stringify(sampleData())));
  });
  test('ルートだけのファイルは、いまのルートに足す（消さない）', async () => {
    const app = await loadApp(sampleData());
    const add = sampleRoute(); add.id = 'new1'; add.from = '家'; add.to = 'US';
    ok(app.w.importText(JSON.stringify({ addRoutes: [add] })));
    eq(app.stored().routes.map((r) => r.to), ['大学', 'US']);
  });
  test('ルートだけのファイルで、同じidのルートは上書きする', async () => {
    const app = await loadApp(sampleData());
    const id = app.stored().routes[0].id;
    const add = sampleRoute(); add.id = id; add.from = '家'; add.to = '図書館';
    ok(app.w.importText(JSON.stringify({ addRoutes: [add] })));
    eq(app.stored().routes.map((r) => r.to), ['図書館']);
  });
  test('ルートだけのファイルでも、こわれていたら読みこまない', async () => {
    const app = await loadApp(sampleData());
    eq(app.w.importText('{"addRoutes":[{"from":"家"}]}'), false);
    eq(app.stored().routes.length, 1);
  });
  test('変なファイルは読みこまない', async () => {
    const app = await loadApp(sampleData());
    eq(app.w.importText('こわれた'), false);
    eq(app.w.importText('{"routes":"x"}'), false);
    eq(app.stored().routes.length, 1);
  });
  test('こわれた保存データでも起動できる', async () => {
    localStorage.setItem(KEY, '{こわれ');
    const frame = document.getElementById('app');
    await new Promise((r) => { frame.onload = r; frame.src = '../index.html?' + Date.now(); });
    ok(frame.contentWindow.document.querySelector('#h-result').textContent.includes('設定→読みこむ'));
  });
});

group('全体', () => {
  test('どの画面も、エラーなく開ける', async () => {
    const app = await loadApp(sampleData());
    for (const t of ['tt', 'settings', 'home']) app.click(`nav [data-tab="${t}"]`);
    eq(app.w.__errors, []);
  });
  test('ルート欄はない（下のボタンはホームと設定だけ）', async () => {
    const app = await loadApp(sampleData());
    eq([...app.$('nav').querySelectorAll('button')].map((b) => b.textContent), ['ホーム', '時刻表', '設定']);
    eq(app.$('#p-routes'), null);
    eq(app.$('#p-edit'), null);
  });
});

// =====================================================================
group('見出し・到着時刻・道のりの見た目（2026-10-23）', () => {
  test('ホームの一番上の見出し「いつ出ればいい？」はない', async () => {
    const app = await loadApp(sampleData());
    eq(app.$('#h-title'), null);
    eq(app.$('#p-home h1'), null);
    ok(!app.$('#p-home').textContent.includes('いつ出ればいい'));
    app.click('#h-mode [data-mode="depart"]');
    ok(!app.$('#p-home').textContent.includes('何時に着く'), '出発時刻のときも出ない');
    ok(app.$('#h-rain'), '雨の日ボタンは残る');
  });
  test('「着きたい時刻」ではなく「到着時刻」と出る', async () => {
    const app = await loadApp(sampleData());
    eq(app.$('#h-mode [data-mode="arrive"]').textContent, '到着時刻');
    eq(app.$('#h-time-label').textContent, '到着時刻');
    app.click('#h-mode [data-mode="depart"]');
    app.click('#h-mode [data-mode="arrive"]');
    eq(app.$('#h-time-label').textContent, '到着時刻');
    app.set('#h-arrive', '');
    ok(app.$('#h-result').textContent.includes('到着時刻を入れてね'));
    ok(!app.$('body').innerText.includes('着きたい'), '画面に出る文字に「着きたい」がない');
  });
  test('区間を、絵・区間・乗りもの名・かかる分に分ける', async () => {
    const { w } = await loadApp();
    eq(w.legParts({ type: 'walk', label: '🚲 自転車 家→竹下駅' }), { icon: '🚲', name: '自転車', place: '家→竹下駅' });
    eq(w.legParts({ type: 'ride', label: '西鉄バス 老司→西鉄大橋駅' }), { icon: '🚌', name: '西鉄バス', place: '老司→西鉄大橋駅' });
    eq(w.legParts({ type: 'ride', label: '西鉄天神大牟田線 大橋→西鉄福岡(天神)' }), { icon: '🚃', name: '西鉄天神大牟田線', place: '大橋→西鉄福岡(天神)' });
    eq(w.legParts({ type: 'walk', label: '家→老司バス停' }), { icon: '🚶', name: '歩き', place: '家→老司バス停' });
    eq(w.legParts({ type: 'ride', label: '電車' }), { icon: '🚃', name: '', place: '電車' });
  });
  test('道のりは、区間ごとに絵・かかる分の丸い印・待ち時間が出て、最後は到着', async () => {
    const app = await loadApp(sampleData());
    const box = app.$('#h-steps');
    ok(box.classList.contains('new'), 'ふだんは新しい見た目');
    const steps = [...box.querySelectorAll('.step')];
    eq(steps.map((st) => st.className), ['step walk', 'step ride', 'step walk', 'step goal']);
    eq(steps.map((st) => st.querySelector('.line i').textContent), ['🚶', '🚃', '🚶', '🏁']);
    eq([...box.querySelectorAll('.dur')].map((d) => d.textContent), ['10分', '20分', '8分']);
    eq(steps[3].textContent.includes('到着'), true);
    const pill = app.w.getComputedStyle(box.querySelector('.ride .dur'));
    eq(pill.color, 'rgb(255, 255, 255)', '乗りものの分は白い字の丸い印');
  });
  test('電車・バスは「◯時◯分発 → ◯時◯分着」が出る（歩き・自転車には出ない）', async () => {
    const app = await loadApp(sampleData());
    const box = app.$('#h-steps');
    eq([...box.querySelectorAll('.when')].map((x) => x.textContent), ['8:15発 → 8:35着']);
    eq(box.querySelector('.ride .when').textContent, '8:15発 → 8:35着');
    eq(box.querySelectorAll('.walk .when').length, 0);
    app.click('#h-opts details summary');
    eq(app.$('#h-opts details .ride .when').textContent, '8:00発 → 8:20着', '1本前の道のりにも出る');
  });
  test('待ち時間があるときは「待ち◯分」と出る', async () => {
    const d = sampleData();
    // 電車（8:15→8:35）→ 歩き3分 → 8:40のバス：のりかえで2分待つ
    d.routes[0].legs[2] = { type: 'walk', label: '駅→バス停', minutes: 3 };
    d.routes[0].legs.push({ type: 'ride', label: 'バス 駅→大学', minutes: 5, times: { weekday: T('8:40 9:00'), holiday: [] } });
    const app = await loadApp(d);
    eq(app.$('#h-leave').textContent, '8:05');
    eq([...app.$('#h-steps').querySelectorAll('.wait')].map((x) => x.textContent), ['⏱ 待ち2分']);
    ok(app.$('#h-steps .step:nth-child(4) .wait'), 'バスの区間に出る');
  });
  test('道のりは横にはみ出さない（スマホの幅）', async () => {
    const d = sampleData();
    d.routes[0].legs[1].label = '西鉄バス［K］博多駅前A→九大ビッグオレンジ';
    document.getElementById('app').closest('details').open = true; // 小窓を見える状態にしてはかる
    const app = await loadApp(d);
    const box = app.$('#h-steps');
    ok(box.clientWidth > 200, '幅がある');
    ok(box.scrollWidth <= box.clientWidth + 1, 'はみ出していない');
  });
  test('設定で「前の」見た目にもどせて、覚えておく', async () => {
    const app = await loadApp(sampleData());
    app.click('nav [data-tab="settings"]');
    eq(app.$('#s-steps .on').dataset.style, 'new');
    app.click('#s-steps [data-style="old"]');
    eq(app.stored().stepStyle, 'old');
    eq(app.$('#s-steps .on').dataset.style, 'old');
    app.click('nav [data-tab="home"]');
    ok(app.$('#h-steps').classList.contains('old'));
    eq(app.$('#h-steps .line'), null, '前の見た目には丸い絵がない');
    app.click('nav [data-tab="settings"]');
    app.click('#s-steps [data-style="new"]');
    app.click('nav [data-tab="home"]');
    ok(app.$('#h-steps').classList.contains('new'));
  });
});

group('アイコン（2026-10-27）', () => {
  test('ホーム画面用のアイコン（180×180）がある', async () => {
    const app = await loadApp();
    const link = app.$('link[rel="apple-touch-icon"]');
    ok(link, 'apple-touch-icon の指定がある');
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('画像が読めない')); img.src = link.href + '?' + Date.now(); });
    eq([img.naturalWidth, img.naturalHeight], [180, 180]);
  });
});

group('見た目：どうぶつの森風（2026-10-27）', () => {
  test('ふだんは「どうぶつの森風」、設定で「前の」見た目にできる', async () => {
    const app = await loadApp(sampleData());
    ok(app.w.document.body.classList.contains('mori'));
    app.click('nav [data-tab="settings"]');
    eq(app.$('#s-theme .on').dataset.theme, 'mori');
    app.click('#s-theme [data-theme="plain"]');
    ok(!app.w.document.body.classList.contains('mori'));
    eq(app.$('#s-theme .on').dataset.theme, 'plain');
  });
  test('乗りものの「◯分」は、どうぶつの森風でも白い字が読める（緑の地）', async () => {
    const app = await loadApp(sampleData());
    const cs = app.w.getComputedStyle(app.$('#h-steps .ride .dur'));
    eq([cs.color, cs.backgroundColor], ['rgb(255, 255, 255)', 'rgb(79, 165, 83)']);
  });
  test('前の見た目から「どうぶつの森風」にもどすと、色・まるい文字・葉っぱの飾りになり、覚えておく', async () => {
    const d = sampleData(); d.theme = 'plain';
    const app = await loadApp(d);
    ok(!app.w.document.body.classList.contains('mori'));
    app.click('nav [data-tab="settings"]');
    app.click('#s-theme [data-theme="mori"]');
    const body = app.w.document.body;
    ok(body.classList.contains('mori'));
    eq(app.stored().theme, 'mori');
    eq(app.$('#s-theme .on').dataset.theme, 'mori');
    const cs = app.w.getComputedStyle(body);
    eq(cs.backgroundColor, 'rgb(248, 240, 212)', 'クリーム色の背景');
    ok(cs.fontFamily.includes('Zen Maru Gothic'), 'まるい文字');
    const card = app.$('.card');
    ok(app.w.getComputedStyle(card, '::before').backgroundImage.includes('svg'), 'カードに葉っぱ');
    eq(app.w.getComputedStyle(card).borderTopLeftRadius, '26px');
  });
  test('どうぶつの森風は、開きなおしても続く。「いまの」にもどせる', async () => {
    const d = sampleData(); d.theme = 'mori';
    const app = await loadApp(d);
    ok(app.w.document.body.classList.contains('mori'));
    app.click('nav [data-tab="settings"]');
    app.click('#s-theme [data-theme="plain"]');
    ok(!app.w.document.body.classList.contains('mori'));
    eq(app.stored().theme, 'plain');
  });
  test('設定の切りかえボタンは小さめ（横いっぱいにしない）', async () => {
    document.getElementById('app').closest('details').open = true;
    const app = await loadApp(sampleData());
    app.click('nav [data-tab="settings"]');
    for (const id of ['#s-theme', '#s-steps']) {
      const seg = app.$(id), card = seg.closest('.card');
      ok(seg.getBoundingClientRect().width < card.clientWidth * 0.8, id + ' は小さめ');
    }
  });
});

// =====================================================================
// 実行
(async () => {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  const results = { pass: 0, fail: 0, failures: [] };
  const box = document.getElementById('results');
  for (const g of groups) {
    const el = document.createElement('div');
    el.className = 'group';
    el.innerHTML = `<h2>${g.name}</h2>`;
    box.appendChild(el);
    for (const t of g.tests) {
      const row = document.createElement('div');
      row.className = 't';
      try {
        await t.fn();
        results.pass++;
        row.textContent = '✅ ' + t.name;
      } catch (e) {
        results.fail++;
        results.failures.push({ group: g.name, name: t.name, error: e.message });
        row.innerHTML = `❌ ${t.name}<div class="err"></div>`;
        row.querySelector('.err').textContent = e instanceof Fail ? e.message : `エラー: ${e.message}`;
      }
      el.appendChild(row);
    }
  }
  try { if (saved === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, saved); } catch (e) {}
  const s = document.getElementById('summary');
  s.textContent = results.fail ? `❌ ${results.fail}件 失敗／✅ ${results.pass}件 成功` : `✅ ぜんぶ成功（${results.pass}件）`;
  s.className = results.fail ? 'ng' : 'ok';
  window.__results = results;
})();
