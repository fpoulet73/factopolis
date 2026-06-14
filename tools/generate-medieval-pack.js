'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'assets', 'graphic-packs', 'medieval');

const productionTypes = ['mine','lumber','farm','cotton_farm','weaver','pump','fisher','mill','bakery','fishery','smelter','factory'];
const productionShapes = [[1,1],[2,1],[1,2],[3,1],[1,3],[4,1],[1,4],[2,2],[3,2],[2,3],[4,4]];
const residentialShapes = {
  house:[[1,1]], duplex:[[2,1],[1,2]], row:[[3,1],[1,3]], residence:[[4,1],[1,4]],
  tower:[[2,2]], bigtower:[[3,2],[2,3]], tower3:[[3,3]], sky:[[4,4]],
};
const logisticsShapes = {
  depot:[[1,1],[2,1],[1,2],[3,1],[1,3],[4,1],[1,4],[2,2],[3,2],[2,3],[3,3],[4,4]],
  tank:[[1,1]], garage:[[1,1]], plant:[[1,1]],
};

const PALETTE = {
  wall:'#b89b72', wall2:'#967a57', dark:'#5c4632', roof:'#7e2f27', roof2:'#9f4a31',
  thatch:'#c6a85b', wood:'#6b452a', stone:'#7f8078', stoneDark:'#565954',
  field:'#c9a146', water:'#62a6c8', metal:'#697078', smoke:'#d6d0c2',
  accent:'#e2c06a', glass:'#9ec7d8', grass:'#5f7f3f',
};

function hex(hex){
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255, 255];
}
function rgba(hexColor, a=255){
  const c = hex(hexColor); c[3] = a; return c;
}
function shade(hexColor, f){
  const [r,g,b] = hex(hexColor);
  const adj = v => f >= 0 ? v + (255-v)*f : v*(1+f);
  return [adj(r)|0, adj(g)|0, adj(b)|0, 255];
}

const CRC_TABLE = new Uint32Array(256);
for(let n=0; n<256; n++){
  let c = n;
  for(let k=0; k<8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf){
  let c = 0xffffffff;
  for(const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data){
  const t = Buffer.from(type);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  t.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([t, data])), 8 + data.length);
  return out;
}

class Img {
  constructor(w,h){
    this.w = w; this.h = h;
    this.p = new Uint8ClampedArray(w*h*4);
  }
  blend(x,y,c){
    x = x|0; y = y|0;
    if(x<0||y<0||x>=this.w||y>=this.h) return;
    const i = (y*this.w+x)*4;
    const a = c[3] / 255, ia = 1-a;
    this.p[i] = c[0]*a + this.p[i]*ia;
    this.p[i+1] = c[1]*a + this.p[i+1]*ia;
    this.p[i+2] = c[2]*a + this.p[i+2]*ia;
    this.p[i+3] = Math.min(255, c[3] + this.p[i+3]*ia);
  }
  rect(x,y,w,h,c){
    for(let yy=Math.floor(y); yy<y+h; yy++) for(let xx=Math.floor(x); xx<x+w; xx++) this.blend(xx,yy,c);
  }
  ellipse(cx,cy,rx,ry,c){
    const x0=Math.floor(cx-rx), x1=Math.ceil(cx+rx), y0=Math.floor(cy-ry), y1=Math.ceil(cy+ry);
    for(let y=y0; y<=y1; y++) for(let x=x0; x<=x1; x++){
      const dx=(x+0.5-cx)/rx, dy=(y+0.5-cy)/ry;
      if(dx*dx+dy*dy<=1) this.blend(x,y,c);
    }
  }
  poly(points,c){
    let minY=Infinity,maxY=-Infinity;
    for(const p of points){ minY=Math.min(minY,p[1]); maxY=Math.max(maxY,p[1]); }
    minY=Math.floor(minY); maxY=Math.ceil(maxY);
    for(let y=minY; y<=maxY; y++){
      const xs=[];
      for(let i=0,j=points.length-1; i<points.length; j=i++){
        const a=points[i], b=points[j];
        if((a[1] > y) !== (b[1] > y)){
          xs.push(a[0] + (y-a[1])*(b[0]-a[0])/(b[1]-a[1]));
        }
      }
      xs.sort((a,b)=>a-b);
      for(let k=0; k<xs.length; k+=2)
        for(let x=Math.floor(xs[k]); x<=Math.ceil(xs[k+1]); x++) this.blend(x,y,c);
    }
  }
  line(x0,y0,x1,y1,width,c){
    const dx=x1-x0, dy=y1-y0, len=Math.max(1, Math.hypot(dx,dy));
    for(let i=0; i<=len; i++){
      const t=i/len, x=x0+dx*t, y=y0+dy*t;
      this.ellipse(x,y,width/2,width/2,c);
    }
  }
  png(file){
    const raw = Buffer.alloc((this.w*4+1)*this.h);
    for(let y=0; y<this.h; y++){
      const row = y*(this.w*4+1);
      raw[row] = 0;
      for(let x=0; x<this.w*4; x++) raw[row+1+x] = this.p[y*this.w*4+x];
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w,0); ihdr.writeUInt32BE(this.h,4);
    ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;
    const png = Buffer.concat([
      Buffer.from([137,80,78,71,13,10,26,10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw, { level:9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    fs.writeFileSync(file, png);
  }
}

function iso(cx, cy, w, h, tw=46, th=24){
  const sx = tw / 2, sy = th / 2;
  return {
    top:[cx + (h-w)*sx/2, cy - (w+h)*sy/2],
    right:[cx + (w+h)*sx/2, cy + (w-h)*sy/2],
    bottom:[cx + (w-h)*sx/2, cy + (w+h)*sy/2],
    left:[cx - (w+h)*sx/2, cy + (h-w)*sy/2],
  };
}
function diamondPoints(d){ return [d.top,d.right,d.bottom,d.left]; }

function drawBase(img, cx, cy, w, h, type, view){
  const d = iso(cx, cy, w, h);
  img.ellipse(cx, cy + 22, 34 + 24*(w+h), 12 + 5*(w+h), rgba('#000000', 45));
  const ground = type === 'farm' ? PALETTE.field : type === 'cotton_farm' ? '#d8d2b6' : type === 'pump' ? '#5c8ca5' : '#6c7f45';
  img.poly(diamondPoints(d), rgba(ground, 230));
  const stripe = shade(ground, .18);
  for(let i=1; i<Math.min(6, w+h+2); i++){
    const t = i / Math.min(6, w+h+2);
    img.line(d.left[0]*(1-t)+d.top[0]*t, d.left[1]*(1-t)+d.top[1]*t,
             d.bottom[0]*(1-t)+d.right[0]*t, d.bottom[1]*(1-t)+d.right[1]*t, 1, [...stripe.slice(0,3),90]);
  }
}

function drawHouse(img,cx,cy,w,h,type,view){
  drawBase(img,cx,cy,w,h,type,view);
  const bw = 34 + 11*w, bd = 24 + 9*h, bh = type === 'sky' ? 90 : type === 'tower3' ? 82 : type === 'bigtower' ? 70 : type === 'tower' ? 56 : type === 'residence' ? 34 : 24;
  const x=cx, y=cy+12;
  const top=[[x-bw/2,y-bd/2-bh],[x+bw/2,y-bd/2-bh],[x+bw/2,y+bd/2-bh],[x-bw/2,y+bd/2-bh]];
  img.poly([[x+bw/2,y-bd/2],[x+bw/2,y+bd/2],top[2],top[1]], shade(PALETTE.wall2,-.18));
  img.poly([[x-bw/2,y+bd/2],[x+bw/2,y+bd/2],top[2],top[3]], shade(PALETTE.wall,-.1));
  img.poly(top, shade(type.includes('tower')||type==='sky' ? PALETTE.stone : PALETTE.roof, .15));
  if(type === 'house' || type === 'duplex' || type === 'row'){
    img.poly([[x-bw/2-5,y-bd/2-bh+8],[x,y-bd/2-bh-14],[x+bw/2+5,y-bd/2-bh+8],[x,y-bd/2-bh+21]], rgba(PALETTE.roof,255));
  }
  const cols = Math.max(1, Math.min(6, Math.round(w*1.5)));
  const rows = Math.max(1, Math.min(6, Math.round(bh/18)));
  for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
    img.rect(x-bw/2+8+c*(bw-16)/cols, y+bd/2-bh+8+r*13, 5, 6, rgba(PALETTE.glass, 210));
    img.rect(x+bw/2-13, y-bd/2-bh+9+r*13, 5, 6, rgba(PALETTE.glass, 190));
  }
  const doorX = view === 2 ? x + bw*.22 : view === 3 ? x - bw*.22 : x;
  img.rect(doorX-5, y+bd/2-18, 10, 18, rgba(PALETTE.dark,255));
  if(type === 'house' || type === 'duplex' || type === 'row'){
    const chimneyX = view === 1 ? x-bw*.28 : x+bw*.25;
    img.rect(chimneyX, y-bd/2-bh-10, 7, 18, rgba('#5e5042',255));
  }
}

function drawIndustry(img,cx,cy,w,h,type,view){
  drawBase(img,cx,cy,w,h,type,view);
  const x=cx, y=cy+10, bw=38+14*w, bd=26+10*h, bh=22+5*Math.sqrt(w*h);
  const wall = type === 'smelter' ? '#755044' : type === 'bakery' ? '#bd7b49' : type === 'fishery' ? '#4d7f8a' : type === 'fisher' ? '#4f7f86' : type === 'weaver' ? '#8f6b9f' : type === 'mill' ? '#c3ae75' : type === 'pump' ? '#4d86a6' : type === 'cotton_farm' ? '#d7d1b8' : type === 'farm' ? '#9c7a36' : type === 'lumber' ? '#6f7f45' : type === 'mine' ? '#76604e' : '#626a66';
  if(type === 'farm'){
    const barnX = x - 8;
    img.poly([[barnX-bw*.25,y-bd*.15],[barnX,y-bd*.45],[barnX+bw*.25,y-bd*.15],[barnX,y+bd*.05]], rgba('#9f4a31',255));
    img.poly([[barnX-bw*.25,y-bd*.15],[barnX,y+bd*.05],[barnX,y+bd*.32],[barnX-bw*.25,y+bd*.12]], rgba('#8a5333',255));
    img.poly([[barnX+bw*.25,y-bd*.15],[barnX,y+bd*.05],[barnX,y+bd*.32],[barnX+bw*.25,y+bd*.12]], rgba('#6e402a',255));
    img.line(x-bw*.45,y+bd*.1,x+bw*.45,y-bd*.2,2,rgba('#f2d06e',170));
    img.line(x-bw*.3,y+bd*.25,x+bw*.55,y-bd*.05,2,rgba('#f2d06e',170));
    return;
  }
  if(type === 'cotton_farm'){
    const barnX = x - 8;
    img.poly([[barnX-bw*.25,y-bd*.15],[barnX,y-bd*.45],[barnX+bw*.25,y-bd*.15],[barnX,y+bd*.05]], rgba('#efe9d3',255));
    img.poly([[barnX-bw*.25,y-bd*.15],[barnX,y+bd*.05],[barnX,y+bd*.32],[barnX-bw*.25,y+bd*.12]], rgba('#c8b899',255));
    img.poly([[barnX+bw*.25,y-bd*.15],[barnX,y+bd*.05],[barnX,y+bd*.32],[barnX+bw*.25,y+bd*.12]], rgba('#a9987c',255));
    img.poly([[barnX-bw*.28,y-bd*.18],[barnX,y-bd*.48],[barnX+bw*.28,y-bd*.18],[barnX,y-bd*.06]], rgba('#8a4f3d',255));
    for(let i=0;i<Math.min(8,w*h+3);i++){
      const px = x - bw*.45 + (i%4)*bw*.28;
      const py = y + bd*.18 - Math.floor(i/4)*bd*.18;
      img.ellipse(px, py, 7, 4, rgba('#f4f0df',235));
      img.line(px, py+5, px, py+12, 1, rgba('#75805a',190));
    }
    return;
  }
  img.poly([[x-bw/2,y-bd/2],[x+bw/2,y-bd/2],[x+bw/2,y+bd/2],[x-bw/2,y+bd/2]], rgba(wall,255));
  img.poly([[x-bw/2,y-bd/2],[x,y-bd/2-bh],[x+bw/2,y-bd/2],[x,y-bd/2+bh*.2]], rgba(type==='mill'?PALETTE.thatch:PALETTE.roof2,255));
  img.poly([[x-bw/2,y+bd/2],[x+bw/2,y+bd/2],[x+bw/2,y+bd/2+8],[x-bw/2,y+bd/2+8]], shade(wall,-.25));
  if(type === 'mill'){
    img.ellipse(x,y-bh*.35,6,6,rgba(PALETTE.dark,255));
    img.line(x,y-bh*.35,x,y-bh*.35-34,5,rgba('#eadbb8',255));
    img.line(x,y-bh*.35,x+34,y-bh*.35,5,rgba('#eadbb8',255));
    img.line(x,y-bh*.35,x,y-bh*.35+34,5,rgba('#eadbb8',255));
    img.line(x,y-bh*.35,x-34,y-bh*.35,5,rgba('#eadbb8',255));
  } else if(type === 'pump'){
    img.rect(x-8,y-bh-8,16,36,rgba(PALETTE.water,255));
    img.line(x+4,y-bh,x+28,y-bh+12,6,rgba('#ccefff',230));
  } else if(type === 'fisher'){
    img.rect(x-bw*.22,y+bd*.08,bw*.42,6,rgba('#d7c08a',255));
    img.line(x+bw*.28,y-bd*.18,x+bw*.45,y+bd*.20,3,rgba('#d7c08a',255));
    img.line(x+bw*.45,y+bd*.20,x+bw*.55,y+bd*.02,1,rgba('#c7e7e9',210));
    img.ellipse(x-bw*.28,y+bd*.23,9,4,rgba('#4fa6b8',230));
  } else if(type === 'fishery'){
    img.ellipse(x-bw*.22,y+bd*.12,10,5,rgba('#c7e7e9',245));
    img.ellipse(x+bw*.22,y+bd*.10,9,4,rgba('#d6b45c',230));
    img.line(x-bw*.38,y-bd*.18,x+bw*.38,y-bd*.02,2,rgba('#d7c08a',180));
  } else if(type === 'weaver'){
    img.rect(x-bw*.32,y+bd*.05,bw*.62,8,rgba('#d8c6e6',240));
    img.rect(x-bw*.30,y+bd*.17,bw*.60,7,rgba('#b98fcb',230));
    img.ellipse(x-bw*.24,y-bd*.02,7,7,rgba('#f4f0df',245));
    img.ellipse(x+bw*.20,y-bd*.02,7,7,rgba('#f4f0df',245));
    for(let i=0;i<4;i++) img.line(x-bw*.34,y+bd*.03+i*4,x+bw*.34,y-bd*.10+i*4,1,rgba('#eadff2',210));
  } else if(type === 'smelter' || type === 'factory' || type === 'plant'){
    const stackX = x + (view === 1 || view === 2 ? -bw*.34 : bw*.28);
    img.rect(stackX,y-bd/2-bh-20,13,45,rgba(type==='plant'?'#454b52':'#5a5b58',255));
    img.ellipse(stackX+7,y-bd/2-bh-23,9,4,rgba(PALETTE.smoke,120));
    if(type === 'smelter') img.ellipse(x-bw*.18,y+bd*.12,12,7,rgba('#ff9d34',220));
    if(type === 'plant') img.line(x-bw*.4,y,x+bw*.35,y-bd*.25,4,rgba('#a8a8a8',120));
  } else if(type === 'bakery'){
    img.ellipse(x+bw*.25,y+bd*.15,11,6,rgba('#f0bf68',255));
    img.ellipse(x-bw*.2,y+bd*.14,12,9,rgba('#3c2b25',255));
  } else if(type === 'mine'){
    img.poly([[x-bw*.3,y+bd*.2],[x,y-bd*.18],[x+bw*.3,y+bd*.2]], rgba('#2e2925',255));
    img.line(x+bw*.24,y-bd*.2,x+bw*.42,y+bd*.25,5,rgba('#c8874b',255));
  } else if(type === 'lumber'){
    img.rect(x-bw*.25,y+bd*.08,bw*.55,7,rgba('#bf8b4f',255));
    img.rect(x-bw*.35,y+bd*.22,bw*.55,7,rgba('#a7773f',255));
    img.line(x+bw*.35,y-bd*.3,x+bw*.48,y+bd*.22,5,rgba('#d5d8dc',255));
  }
  img.rect(x-bw*.36,y+bd*.05,9,8,rgba(PALETTE.glass,200));
  img.rect(x+bw*.12,y+bd*.02,9,8,rgba(PALETTE.glass,180));
}

function drawLogistics(img,cx,cy,w,h,type,view){
  drawBase(img,cx,cy,w,h,type,view);
  const x=cx, y=cy+12, bw=38+13*w, bd=26+10*h;
  if(type === 'tank'){
    img.ellipse(x,y-20,24,10,rgba('#8fc6de',255));
    img.rect(x-24,y-20,48,28,rgba('#4d86a5',255));
    img.ellipse(x,y+8,24,10,rgba('#3d6f8d',255));
    return;
  }
  const wall = type === 'garage' ? '#536075' : type === 'depot' ? '#8b784e' : '#565c64';
  img.poly([[x-bw/2,y-bd/2],[x,y-bd/2-24],[x+bw/2,y-bd/2],[x,y-bd/2+14]], rgba(type==='plant'? '#676d73' : PALETTE.roof,255));
  img.poly([[x-bw/2,y-bd/2],[x+bw/2,y-bd/2],[x+bw/2,y+bd/2],[x-bw/2,y+bd/2]], rgba(wall,255));
  img.rect(x-11,y+bd/2-19,22,19,rgba(PALETTE.dark,255));
  if(type === 'depot'){
    img.rect(x+bw*.18,y,18,13,rgba('#c89d54',255));
    img.line(x+bw*.18,y+6,x+bw*.18+18,y+6,2,rgba('#5e4526',160));
  }
}

function drawSprite(type,w,h,view,file){
  const ww = 150 + 30*(w+h);
  const hh = 132 + 18*(w+h) + (type === 'sky' ? 90 : type === 'tower3' ? 82 : type === 'bigtower' ? 70 : 0);
  const img = new Img(ww, hh);
  const cx = ww/2, cy = hh - 46 - 7*(w+h);
  const dw = view & 1 ? h : w;
  const dh = view & 1 ? w : h;
  if(type in residentialShapes) drawHouse(img,cx,cy,dw,dh,type,view);
  else if(type in logisticsShapes) drawLogistics(img,cx,cy,dw,dh,type,view);
  else drawIndustry(img,cx,cy,dw,dh,type,view);
  img.png(file);
}

function addSpriteEntry(buildings, type, shapes){
  const [bw,bh] = shapes[0];
  const base = `${type}-${bw}x${bh}`;
  buildings[type] = {
    src: `${base}-0.png`,
    anchorX: 0.5,
    anchorY: 1,
    views: Object.fromEntries([0,1,2,3].map(v => [String(v), { src:`${base}-${v}.png` }])),
    variants: {},
  };
  for(const [w,h] of shapes){
    const key = `${w}x${h}`;
    const stem = `${type}-${key}`;
    buildings[type].variants[key] = {
      views: Object.fromEntries([0,1,2,3].map(v => [String(v), { src:`${stem}-${v}.png` }])),
    };
    for(let view=0; view<4; view++) drawSprite(type, w, h, view, path.join(OUT_DIR, `${stem}-${view}.png`));
  }
}

function main(){
  fs.mkdirSync(OUT_DIR, { recursive:true });
  const buildings = {};
  for(const type of productionTypes) addSpriteEntry(buildings, type, productionShapes);
  for(const [type, shapes] of Object.entries(residentialShapes)) addSpriteEntry(buildings, type, shapes);
  for(const [type, shapes] of Object.entries(logisticsShapes)) addSpriteEntry(buildings, type, shapes);

  const pack = {
    id:'medieval',
    name:'Médiéval réaliste',
    description:'Pack PNG médiéval généré procéduralement avec 4 vues et variantes de fusion.',
    fallback:'classic',
    defaultScale:1,
    buildings,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'pack.json'), JSON.stringify(pack, null, 2) + '\n');
  console.log(`Generated ${Object.values(buildings).reduce((n,b)=> n + Object.keys(b.variants).length*4, 0)} PNG files in ${OUT_DIR}`);
}

main();
