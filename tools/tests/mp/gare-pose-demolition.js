// L'hôte et l'invité gardent les mêmes pièces après pose et démolition d'un quai.
module.exports = async ({ host, guest, waitFor }) => {
  const gid = await guest.evaluate(() => MP.myId);
  await host.evaluate(gid => {
    T_.flatWorld(); paused = true;
    walletOf(gid).money = 1e6;
    applyRailPathWithNetwork(T_.line(99, 100, 101, 100));
    mpForceFullSnapshot();
  }, gid);
  if(!await waitFor(guest, () => !!rail[100*N+100], null, 5000)) return { ok:false, stage:'snapshot' };
  const build = async (x, y) => guest.evaluate(({x,y}) => {
    setTool('train_station'); clickFn(x,y); setTool('select');
  }, {x,y});
  await build(100, 99);
  await build(100, 100);
  const placed = await waitFor(host, () => bgrid[99*N+100]?.type === 'train_station'
    && bgrid[100*N+100]?.type === 'train_platform', null, 5000);
  await guest.evaluate(() => { setTool('terraform'); clickFn(100, 100); setTool('select'); });
  const removed = await waitFor(host, () => !bgrid[100*N+100] && !!rail[100*N+100]
    && bgrid[99*N+100]?.type === 'train_station', null, 5000);
  return { ok:placed && removed, placed, removed };
};
