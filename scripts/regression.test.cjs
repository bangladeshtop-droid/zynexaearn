const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const html = readFileSync('index.html', 'utf8');
const admin = html.slice(html.indexOf('    const AdminPanel = {'), html.indexOf('    const GuideModal = {'));
function snapshot(values) {
  return { forEach(callback) { for (const [key, value] of Object.entries(values)) { if (callback({ key, val: () => value })) return true; } return false; } };
}
function setup() {
  const listeners = {};
  const elements = {};
  for (const id of ['view-admin-withdraws', 'view-admin-deposits']) elements[id] = { classList: { contains: () => true } };
  const context = { document: { getElementById: id => elements[id] }, db: { ref: path => ({ on: (event, callback) => { listeners[path] = callback; } }) } };
  vm.createContext(context);
  vm.runInContext(admin + '\nglobalThis.panel = AdminPanel;', context);
  context.panel.guard = () => true;
  context.panel.filterDeposits = () => {};
  context.panel.filterWithdraws = () => {};
  return { panel: context.panel, listeners };
}
test('all inline JavaScript parses', () => {
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
});
test('deposit and withdrawal feeds retain multiple records and refresh with later arrivals', () => {
  const { panel, listeners } = setup(); panel.bindRequestFeeds();
  for (const [path, cache] of [['depositRequests', 'depCache'], ['withdrawRequests', 'wdCache']]) {
    listeners[path](snapshot({ first: { createdAt: 1 }, second: { createdAt: 2, id: 'incorrect-stored-id' } }));
    assert.equal(panel[cache].length, 2);
    assert.equal(panel[cache][0].id, 'second');
    listeners[path](snapshot({ first: { createdAt: 1 }, second: { createdAt: 2 }, third: { createdAt: 3 } }));
    assert.equal(panel[cache].length, 3);
    assert.equal(panel[cache][0].id, 'third');
  }
});
test('history categories preserve separate activity types and unknown legacy records', () => {
  const { panel } = setup();
  for (const [type, category] of Object.entries({ VISIT: 'Visiting', AD_REWARD: 'Watch Ads', MINING: 'Mining', CHECKIN: 'Daily Check-in', QUIZ: 'Quiz', SICBO_WIN: 'Casino', BACCARAT: 'Casino', SWAP: 'Convert', DEPOSIT: 'Deposit', WITHDRAW_REFUND: 'Withdraw', TRANSFER: 'Transfer', ADMIN_CREDIT: 'Other' })) assert.equal(panel.historyGroup({ type }), category);
});
test('Firebase snapshot callbacks never return push counts', () => {
  assert.doesNotMatch(html, /(?:snap|txSnap)\.forEach\(\(ch\) => (?:rows|txs|jobs)\.push\(/);
});
test('page reload fetches preserve every saved request', async () => {
  const values = { old: { createdAt: 1 }, recent: { createdAt: 2 }, newest: { createdAt: 3 } };
  const context = { document: { getElementById: () => null }, db: { ref: () => ({ on() {}, once: async () => snapshot(values) }) } };
  vm.createContext(context); vm.runInContext(admin + '\nglobalThis.panel = AdminPanel;', context);
  const panel = context.panel;
  panel.guard = () => true; panel.loading = () => {}; panel.filterDeposits = () => {}; panel.filterWithdraws = () => {};
  await panel.renderDeposits(); await panel.renderWithdraws();
  assert.equal(panel.depCache.length, 3); assert.equal(panel.wdCache.length, 3);
  assert.equal(panel.depCache[0].id, 'newest'); assert.equal(panel.wdCache[2].id, 'old');
});
