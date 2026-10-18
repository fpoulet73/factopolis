// La gare longe le rail ; le quai se pose sur le rail et se retire sans le détruire.
T_.flatWorld();
T_.rail(T_.line(99, 100, 101, 100));
const diagonal = trainStationPlacementInfo(98, 99);
const station = T_.build('train_station', 100, 99);
const platform = T_.build('train_station', 100, 100);
const initial = !!station && !!platform && platform.type === 'train_platform'
  && station.stationGroupId === platform.stationGroupId;
setTool('terraform'); clickAt(100, 100); setTool('select');
const platformRemoved = !bgrid[100*N+100] && !!rail[100*N+100]
  && buildings.includes(station);
const restored = T_.build('train_station', 100, 100);
setTool('terraform'); clickAt(100, 99); setTool('select');
const stationRemoved = !bgrid[99*N+100] && !!bgrid[100*N+100]
  && !trainStationPlacementInfo(99, 100).ok;
setTool('terraform'); clickAt(100, 100); setTool('select');
const empty = !bgrid[100*N+100] && !buildings.includes(restored)
  && !!rail[100*N+100];
T_.rail(T_.line(119, 100, 123, 100));
for(const x of [120,121,122]) T_.build('train_station', x, 99);
for(const x of [120,121,122]) T_.build('train_station', x, 100);
const group = bgrid[99*N+120]?.stationGroupId;
const joined = group != null && [120,121,122].every(x =>
  bgrid[99*N+x]?.stationGroupId === group && bgrid[100*N+x]?.stationGroupId === group);
return { ok:!diagonal.ok && initial && platformRemoved && stationRemoved && empty && joined,
  diagonal, initial, platformRemoved, stationRemoved, empty, joined };
