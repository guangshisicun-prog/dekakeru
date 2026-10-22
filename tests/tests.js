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
    ok(app.$('#h-result').textContent.includes('ルートを登録'));
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
group('ルートの編集', () => {
  test('ルートを足して、道のりと時刻表を入れるとホームで使える', async () => {
    const app = await loadApp();
    app.click('nav [data-tab="routes"]');
    app.click('#r-add');
    app.set('#e-from', '家');
    app.set('#e-to', 'バイト');
    app.set('#e-buffer', '0');
    app.click('#e-add-walk');
    app.set(app.$('#e-legs [data-f="minutes"]'), '7', 'change');
    app.click('#e-add-ride');
    const legs = app.$('#e-legs').querySelectorAll('.leg');
    app.set(legs[1].querySelector('[data-f="minutes"]'), '12', 'change');
    app.set(legs[1].querySelector('[data-f="weekday"]'), '17: 00 30\n18: 00', 'change');
    eq(legs[1].querySelector('[data-f="weekday"]').value, '17:00 17:30 18:00', '読みとった時刻にそろえて見せる');
    app.click('#e-done');
    app.set('#h-arrive', '18:00');
    eq(app.$('#h-leave').textContent, '17:23');
    const r = app.stored().routes[0];
    eq([r.from, r.to, r.name], ['家', 'バイト', '家→バイト']); eq(r.legs.length, 2);
    eq([app.$('#h-from').value, app.$('#h-to').value], ['家', 'バイト']);
  });
  test('道のりの順番を入れかえ・消せる', async () => {
    const app = await loadApp(sampleData());
    app.click('nav [data-tab="routes"]');
    app.click(app.$('.route'));
    app.click(app.$('.leg[data-i="1"] [data-act="up"]'));
    eq(app.stored().routes[0].legs.map((l) => l.type), ['ride', 'walk', 'walk']);
    app.click(app.$('.leg[data-i="0"] [data-act="del"]'));
    eq(app.stored().routes[0].legs.length, 2);
  });
  test('ルートを消せる', async () => {
    const app = await loadApp(sampleData());
    app.click('nav [data-tab="routes"]');
    app.click(app.$('.route'));
    app.click('#e-delete');
    eq(app.stored().routes, []);
    ok(app.$('#p-routes').classList.contains('on'));
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
    app.click('nav [data-tab="routes"]'); app.click(app.$('.route'));
    eq([app.$('#e-from').value, app.$('#e-to').value], ['家', '大学']);
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
group('バックアップ', () => {
  test('読みこむと入れかわる', async () => {
    const app = await loadApp();
    ok(app.w.importText(JSON.stringify(sampleData())));
    eq([app.stored().routes[0].from, app.stored().routes[0].to], ['家', '大学']);
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
    ok(frame.contentWindow.document.querySelector('#h-result').textContent.includes('ルートを登録'));
  });
});

group('全体', () => {
  test('どの画面も、エラーなく開ける', async () => {
    const app = await loadApp(sampleData());
    for (const t of ['routes', 'settings', 'home']) app.click(`nav [data-tab="${t}"]`);
    app.click('nav [data-tab="routes"]'); app.click(app.$('.route')); app.click('#e-done');
    eq(app.w.__errors, []);
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
