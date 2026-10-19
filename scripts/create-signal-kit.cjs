'use strict';
// Original, code-drawn artwork. Rebuild only this example; no AE or user settings.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../examples/signal-kit');
const C = { blue:'#2454F4', ink:'#152A52', ice:'#EEF3FF', orange:'#FF6A3D', steel:'#A4B5D6', white:'#FFFFFF' };
function write(name, content) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(file, content, 'utf8');
}
function json(name, value) { write(name, JSON.stringify(value, null, 2) + '\n'); }
const rect = (x,y,w,h,fill,rx=0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"/>`;
const circle = (x,y,r,fill) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;
const line = (x1,y1,x2,y2,color,width=3) => `<path d="M${x1} ${y1}L${x2} ${y2}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
const stroke = (d,color,width=4) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
const shape = (d,color) => `<path d="${d}" fill="${color}"/>`;
const ring = (x,y,r,color,width=4) => `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
function svg(w,h,body) { return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>\n`; }
const items = [];
function asset(id,name,category,w,h,body,use) {
  const file=`svg/${category}/${name}.svg`;
  write(file, svg(w,h,body));
  items.push({id,name,file,width:w,height:h,use,body});
}
// Geometry only: no fonts, scripts, external resources, gradients, masks or filters.
asset('orbit','双轨讯号','装饰',400,400,
  ring(200,200,148,C.blue,3)+ring(200,200,112,C.blue,3)+
  `<ellipse cx="200" cy="200" rx="178" ry="62" transform="rotate(-32 200 200)" fill="none" stroke="${C.blue}" stroke-width="5"/>`+
  circle(200,200,48,C.blue)+circle(326,113,15,C.orange)+circle(94,302,7,C.blue)+
  line(188,22,212,22,C.blue,2)+line(200,10,200,34,C.blue,2), '片头主视觉；可拆分轨道和卫星分别旋转');
let petals='';
for(let i=0;i<12;i++) petals+=`<g transform="rotate(${i*30} 160 160)">${rect(149,20,22,92,i%3===0?C.orange:C.blue,11)}</g>`;
asset('burst','放射星芒','装饰',320,320,petals+circle(160,160,35,C.blue),'节奏点、重点强调或缩放转场');
asset('arrow','折线推进','装饰',480,160,
  shape('M20 54H264V20L352 80L264 140V106H20Z',C.blue)+
  stroke('M354 30L420 80L354 130',C.orange,14)+stroke('M410 30L466 80L410 130',C.blue,8),'段落切换或内容推进方向');
asset('brackets','取景角标','装饰',480,320,
  stroke('M24 88V24H108 M372 24H456V88 M456 232V296H372 M108 296H24V232',C.blue,8)+
  line(224,160,256,160,C.orange,3)+line(240,144,240,176,C.orange,3)+circle(432,48,6,C.orange),'视频取景框；中心可放画面');
let bars='';
[36,64,100,142,184,138,96,60,34].forEach((h,i)=>bars+=rect(16+i*35,110-h/2,19,h,i===4?C.orange:C.blue,9.5));
asset('bars','音频节拍','装饰',332,220,bars,'声音、访谈、播客的节奏标识');
let dots='';
for(let y=0;y<5;y++)for(let x=0;x<9;x++)dots+=circle(16+x*32,16+y*32,4,x===8&&y===0?C.orange:C.blue);
asset('dots','点阵肌理','装饰',288,160,dots,'用于版面空白区域；不建议铺满整个画面');
asset('wave','连续波形','装饰',560,180,
  stroke('M12 90C42 14 72 14 102 90S162 166 192 90S252 14 282 90S342 166 372 90S432 14 462 90S522 166 548 90',C.blue,9)+
  circle(282,90,13,C.orange),'数据、信号或连接关系的辅助线');
asset('title','开场标题底板','版式',960,400,
  rect(16,16,928,368,C.blue,28)+rect(48,48,132,12,C.orange,6)+
  stroke('M780 48H912V180 M48 280V352H180',C.white,3)+
  ring(820,298,46,C.white,2)+circle(858,272,9,C.orange),'标题放在 x=64…744、y=100…264 内；文字在 AE 另建');
asset('lower-third','双层字幕条','版式',960,224,
  rect(16,16,180,64,C.orange,12)+rect(16,92,928,116,C.blue,16)+
  rect(16,92,12,116,C.orange,0)+line(794,150,894,150,C.white,3)+
  stroke('M878 134L894 150L878 166',C.white,3),'上方短标签，下方姓名或标题；保留右侧箭头');
asset('data-card','数据卡片','版式',560,400,
  rect(16,16,528,368,C.ice,24)+rect(16,16,12,368,C.blue,6)+
  rect(48,48,92,10,C.blue,5)+circle(504,53,8,C.orange)+
  [58,84,108,144,180,158].map((h,i)=>rect(280+i*36,328-h,20,h,i===4?C.orange:C.blue,4)).join('')+
  line(48,328,238,328,C.steel,2),'左侧填写数值，右侧为装饰性趋势柱；无真实数据含义');
asset('capsule','栏目胶囊','版式',560,144,
  rect(8,8,544,128,C.blue,64)+circle(72,72,43,C.ice)+
  shape('M60 48L92 72L60 96Z',C.blue)+circle(508,72,8,C.orange),'文字放在 x=142…454；适合栏目名或行动提示');
asset('dial','进度环标','装饰',320,320,
  ring(160,160,125,C.ice,20)+stroke('M160 35A125 125 0 1 1 35 160',C.blue,20)+
  circle(35,160,10,C.orange)+ring(160,160,88,C.blue,2)+
  line(160,58,160,73,C.blue,3)+line(247,160,262,160,C.blue,3)+line(160,247,160,262,C.blue,3),
  '静态 75% 视觉示例；真实进度需在 AE 编辑路径或添加修剪路径');

// Keep the native pack within the six already-supported geometry adapters.
const base=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../examples/basic-shapes/pack.json'),'utf8'));
const presets=[
  ['title-bar','标题底板','rounded-card',{width:928,height:368,radius:28,color:C.blue,motion:'slide',duration:0.55}],
  ['label','栏目标签','rounded-card',{width:180,height:64,radius:12,color:C.orange,motion:'slide',duration:0.4}],
  ['satellite','卫星圆点','circle',{diameter:30,color:C.orange,motion:'pop',duration:0.45}],
  ['lens','椭圆底片','ellipse',{width:356,height:124,color:C.ice,motion:'fade',duration:0.65}],
  ['pointer','方向三角','triangle',{outerRadius:46,rotation:90,color:C.blue,motion:'slide',duration:0.4}],
  ['hex','六边标记','hexagon',{outerRadius:72,rotation:30,color:C.blue,motion:'pop',duration:0.5}],
  ['spark','八角星芒','star',{outerRadius:100,innerRadius:34,points:8,color:C.orange,motion:'pop',duration:0.5}]
];
function rgba(hex) { return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).concat(1); }
const pack={schemaVersion:1,pack:{id:'local.aebrowse.signal',version:'0.1.0',name:'讯号 SIGNAL 图形包',author:'AE Browse',description:'科技资讯与栏目包装案例：蓝、白、橙；7 个参数图形预设，另附 12 个复合 SVG。',license:'本案例原创图形允许复制、修改及商用；不包含第三方素材。'},assets:[]};
for(const [id,name,source,defaults] of presets) {
  const entry=structuredClone(base.assets.find(a=>a.id===source));
  entry.id=id;entry.name=name;entry.source=`assets/${id}.json`;entry.tags=['讯号','SIGNAL','科技资讯',name];
  entry.effects=[];entry.requirements.capabilities=['shape.create','animation.keyframes'];
  entry.help={summary:'讯号案例的单图形预设。可调整外观和入场动画；组合图形请使用附带的 svg 文件夹。'};
  entry.extensions['local.aebrowse'].category='讯号包装';
  for(const p of entry.parameters) if(Object.hasOwn(defaults,p.id)) p.default=p.type==='color'?rgba(defaults[p.id]):defaults[p.id];
  // Allow the taller title preset to retain useful rounding controls.
  if(source==='rounded-card') entry.parameters.find(p=>p.id==='radius').max=Math.floor(defaults.height/2);
  const payload=JSON.parse(fs.readFileSync(path.resolve(__dirname,`../examples/basic-shapes/assets/${source}.json`),'utf8'));
  delete payload.description;payload.states=[];
  json(entry.source,payload);pack.assets.push(entry);
}
json('pack.json',pack);
json('catalog.json',{name:'讯号 SIGNAL',version:'0.1.0',palette:C,assets:items.map(({body,...item})=>item)});

// A standalone design board: typography is for the preview, not baked into assets.
const text=(x,y,size,label,color=C.ink,weight=400,extra='')=>`<text x="${x}" y="${y}" font-family="Arial, Microsoft YaHei, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}" ${extra}>${label}</text>`;
function placed(id,x,y,w,h,fit='xMidYMid meet') { const a=items.find(a=>a.id===id);return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 ${a.width} ${a.height}" preserveAspectRatio="${fit}">${a.body}</svg>`; }
let board=rect(0,0,1600,1400,'#FFFFFF')+rect(0,0,1600,820,C.ice)+
  text(64,68,20,'讯号 / 栏目动态图形包',C.ink,600)+text(1536,68,16,'AE Browse 案例',C.ink,400,'text-anchor="end"')+
  line(64,92,1536,92,C.steel,1)+
  text(58,225,140,'SIGNAL',C.blue,800,'letter-spacing="-8"')+
  text(68,282,34,'把信息，变成可见的节奏。',C.ink,500)+
  placed('orbit',1028,115,440,440)+placed('dots',1400,125,130,75)+
  rect(68,340,104,12,C.orange,6)+text(68,395,20,'科技资讯 / 人物访谈 / 数据栏目',C.ink)+
  text(68,440,17,'12 个可编辑 SVG + 7 个参数图形预设',C.ink)+
  placed('title',62,480,910,300,'none')+text(132,584,19,'本周观察',C.white,500)+
  text(128,661,62,'下一站，灵感发生。',C.white,600)+
  text(132,706,17,'让复杂的内容，有清晰的入口。',C.white)+
  placed('capsule',1054,570,450,116)+text(1170,639,25,'正在接收灵感',C.white,500)+
  placed('wave',1052,706,450,92)+
  text(64,891,30,'一套语言，十二种组合。',C.ink,600)+
  text(1536,889,16,'纯矢量 · 无插件 · 文字另建',C.ink,400,'text-anchor="end"');
items.forEach((a,i)=>{
  const x=64+(i%6)*250,y=930+Math.floor(i/6)*218;
  board+=rect(x,y,222,158,i===7?C.ice:'#F6F8FC',12)+
    placed(a.id,x+20,y+12,182,130)+text(x,y+190,17,a.name,C.ink,500);
});
board+=line(64,1367,1536,1367,C.steel,1)+text(64,1390,13,'颜色  #2454F4 / #FF6A3D / #EEF3FF / #152A52',C.ink)+text(1536,1390,13,'示意图中的文字在 AE 中单独添加',C.ink,400,'text-anchor="end"');
write('overview.svg',svg(1600,1400,board));
write('preview.html',`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>讯号 SIGNAL 图形包案例</title><style>*{box-sizing:border-box}body{margin:0;background:#dce5f4;color:#152a52;font:16px/1.6 "Microsoft YaHei",sans-serif}main{max-width:1600px;margin:auto}img{display:block;width:100%;height:auto}footer{padding:24px 4%;background:white}a{color:#2454f4}a:focus-visible{outline:3px solid #ff6a3d;outline-offset:4px}p{margin:8px 0}</style><main><img src="overview.svg" alt="讯号图形包：蓝白橙栏目片头示意和十二个矢量组件"><footer><p>在 AE Browse 中添加本目录，使用 7 个参数预设；添加 <a href="svg/">svg 子目录</a>，使用 12 个复合图形。</p><p><a href="README.md">查看使用说明和入场节奏建议</a>。素材不含文字，示意标题在 AE 中另建。</p></footer></main></html>`);
write('README.md',`# 讯号 SIGNAL 图形包案例

用于科技资讯、播客访谈、数据栏目。蓝色负责主信息，橙色标记节奏点，浅蓝承担底板。原创矢量几何，无外部图片、字体或插件依赖。

![组合示意](overview.png)

## 在 AE Browse 使用

1. **参数图形包**：来源管理 → 添加图形库 → 选择本目录（包含 pack.json）。7 个预设支持尺寸、颜色、入场时长和 pop / slide / fade / none。添加后可读取、更新所选实例。
2. **完整复合图形**：把本目录下的 **svg** 文件夹拖入面板，或作为普通本地素材文件夹添加。12 个素材分为“装饰”和“版式”，默认选择“可编辑形状”。导入后各图形元素位于同一个原生形状层的分组内，可在 AE 中改色、编辑路径、添加动画。
3. 双击 preview.html 查看组合示意。overview.svg / overview.png 是展示板，不应作为单个组件导入。复制本目录即可携带全部案例文件。

**两种来源分别添加**：pack.json 中的 7 项是单图形参数预设；SVG 中的 12 项是完整组合，不使用参数包的读取/更新按钮。当前图形包协议不直接承载多组复合版式。

## 组件

| 素材 | 推荐用法 |
| --- | --- |
${items.map(a=>`| ${a.name} | ${a.use} |`).join('\n')}

素材透明背景，不含文字。组合示意中的标题、姓名、数字需在 AE 另建文字层；这样可以替换内容与字体。数据卡片的柱状图仅为装饰，进度环是静态 75% 示意。

## 建议的 4 秒片头

- 1920×1080、30 fps；底色 #EEF3FF。先用标题底板作为信息承载区，再把双轨讯号放在右侧。
- 0.00–0.55 s：标题底板从左侧进入，透明度 0→100，位置使用缓出。
- 0.12–0.62 s：标题文字向上移动约 24 px 并淡入。
- 0.24–0.80 s：双轨讯号从 85% 缩放至 100%，轨道做慢速旋转。
- 0.45–0.85 s：栏目胶囊入场；橙色圆点延迟约 3 帧弹出。
- 0.85–3.20 s：保持阅读；3.20–4.00 s：折线推进从左向右扫过切入正文。

以上是搭建建议；本案例未自动创建 AE 合成，也未把该片头动画封装为模板。参数预设只包含现有适配器支持的入场动画。

## 配色与文件

- 主蓝 #2454F4，强调橙 #FF6A3D，浅蓝 #EEF3FF，深蓝 #152A52，辅助灰蓝 #A4B5D6。
- pack.json + assets/：7 个参数预设；svg/：12 个复合图形；catalog.json：尺寸、用途和相对路径索引。
- scripts/create-signal-kit.cjs 从仓库根目录通过 node 运行，可重建本案例的文本和矢量文件；overview.png 由离线浏览器渲染生成。

## 使用许可

本案例中原创图形允许复制、修改及商用。不包含第三方素材；不对仓库其他代码与 Adobe 依赖的许可作任何变更。
`);
console.log(`Created SIGNAL: ${items.length} SVG components, ${pack.assets.length} native presets at ${root}`);
