// Liste des mondes : filtre, tri, recherche ; panneau centré à l'ouverture.
module.exports = async ({ host, guest, waitFor }) => {
  const R = {};
  // panneau ouvert au centre après « Commencer » (clic simulé sur la page invité)
  await guest.evaluate(() => { $('mpPanel').style.display = 'none'; $('splash').style.display = 'flex'; $('sSplashGo').click(); });
  R.centre = await guest.evaluate(() => {
    const p = $('mpPanel'), r = p.getBoundingClientRect();
    return p.style.display === 'block'
      && Math.abs((r.left + r.right) / 2 - innerWidth / 2) < 2
      && Math.abs((r.top + r.bottom) / 2 - innerHeight / 2) < 2;
  });
  // 12 mondes factices → liste scrollable ; filtre / tri / recherche
  await guest.evaluate(() => { mpLeaveRoom(); });
  await waitFor(guest, () => MP.roomId == null);
  const res = await guest.evaluate(() => {
    MP.rooms = Array.from({ length: 12 }, (_, i) => ({
      id: 100 + i, name: (i % 2 ? 'Beta' : 'Alpha') + i, creator: i === 3 ? 'zoe' : 'bob', isPublic: i % 3 !== 0,
      isMember: i < 2, isCreator: i === 0, canJoin: i % 3 !== 0 || i < 2, playerCount: i % 4, players: [],
      memberCount: i, worldConfig: { size: i % 2 ? 128 : 256 },
    }));
    const el = $('mpRoomList');
    const rows = () => el.children.length;
    const names = () => Array.from(el.querySelectorAll('div[style*="font-weight:bold"]')).map(d => d.textContent.trim());
    $('mpRoomFilter').value = 'all'; $('mpRoomSort').value = 'mine'; $('mpRoomSearch').value = ''; mpRenderRooms();
    const out = { total: rows(), scroll: getComputedStyle(el).overflowY === 'auto' };
    out.mesMondesDabord = names().slice(0, 2).join().includes('Alpha0') && names().slice(0, 2).join().includes('Beta1');
    $('mpRoomFilter').value = 'private'; mpRenderRooms(); out.prives = rows();
    $('mpRoomFilter').value = 'mine'; mpRenderRooms(); out.miens = rows();
    $('mpRoomFilter').value = 'all'; $('mpRoomSort').value = 'name'; mpRenderRooms();
    out.triNom = names()[0].includes('Alpha0');
    $('mpRoomSort').value = 'members'; mpRenderRooms(); out.triMembres = names()[0].includes('Alpha11') || names()[0].includes('Beta11');
    $('mpRoomSort').value = 'size'; mpRenderRooms(); out.triTaille = /256/.test(el.children[0].textContent);
    $('mpRoomSearch').value = 'zoe'; mpRenderRooms(); out.recherche = rows();
    MP.rooms = [];
    return out;
  });
  R.total12 = res.total === 12 && res.scroll;
  R.mesMondesDabord = res.mesMondesDabord;
  R.filtrePrives = res.prives === 4;
  R.filtreMiens = res.miens === 2;
  R.triNom = res.triNom;
  R.triMembres = res.triMembres;
  R.triTaille = res.triTaille;
  R.recherche = res.recherche === 1;
  R.detail = res;
  R.ok = Object.entries(R).every(([k, v]) => k === 'detail' || v);
  return R;
};
