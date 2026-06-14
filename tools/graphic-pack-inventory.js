'use strict';

const productionTypes = [
  'mine', 'lumber', 'farm', 'pump', 'fisher', 'mill', 'bakery', 'fishery', 'smelter', 'factory',
];

const productionShapes = [
  [1,1], [2,1], [1,2], [3,1], [1,3], [4,1], [1,4],
  [2,2], [3,2], [2,3], [4,4],
];

const residentialShapes = {
  house: [[1,1]],
  duplex: [[2,1], [1,2]],
  row: [[3,1], [1,3]],
  residence: [[4,1], [1,4]],
  tower: [[2,2]],
  bigtower: [[3,2], [2,3]],
  sky: [[4,4]],
};

const logisticsShapes = {
  depot: [[1,1], [2,1], [1,2], [3,1], [1,3], [4,1], [1,4], [2,2], [3,2], [2,3], [3,3], [4,4]],
  tank: [[1,1]],
  garage: [[1,1]],
  plant: [[1,1]],
};

function rows(){
  const out = [];
  for(const type of productionTypes)
    for(const [w,h] of productionShapes)
      for(let view=0; view<4; view++)
        out.push({ type, shape:`${w}x${h}`, view, file:`${type}-${w}x${h}-${view}.png` });

  for(const [type, shapes] of Object.entries(residentialShapes))
    for(const [w,h] of shapes)
      for(let view=0; view<4; view++)
        out.push({ type, shape:`${w}x${h}`, view, file:`${type}-${w}x${h}-${view}.png` });

  for(const [type, shapes] of Object.entries(logisticsShapes))
    for(const [w,h] of shapes)
      for(let view=0; view<4; view++)
        out.push({ type, shape:`${w}x${h}`, view, file:`${type}-${w}x${h}-${view}.png` });

  return out;
}

const all = rows();
console.log('type,shape,view,file');
for(const r of all) console.log(`${r.type},${r.shape},${r.view},${r.file}`);
console.error(`\nTotal images: ${all.length}`);
