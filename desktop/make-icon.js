const fs = require('fs'); const zlib = require('zlib');
function crc32(buf){ let c = ~0; for (let i=0;i<buf.length;i++){ c ^= buf[i]; for (let k=0;k<8;k++) c = (c>>>1) ^ (0xEDB88320 & -(c & 1)); } return (~c) >>> 0; }
function chunk(type, data){ const t = Buffer.from(type,'ascii'); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t,data]))); return Buffer.concat([len,t,data,crc]); }
const W=16,H=16;
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(H,4); ihdr[8]=8; ihdr[9]=6;
const raw = Buffer.alloc(H*(1+W*4));
for (let y=0;y<H;y++){ raw[y*(1+W*4)] = 0; for (let x=0;x<W;x++){ const o=y*(1+W*4)+1+x*4; raw[o]=0x25; raw[o+1]=0x63; raw[o+2]=0xeb; raw[o+3]=0xff; } }
const idat = zlib.deflateSync(raw);
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR',ihdr), chunk('IDAT',idat), chunk('IEND',Buffer.alloc(0))]);
fs.writeFileSync(require('path').join(__dirname,'tray.png'), png);
console.log('wrote tray.png', png.length, 'bytes');
