(function (root) {
  'use strict';
  // SVG geometry is converted in CEP, never evaluated as script in AE.
  function fail(message) { var error = new Error(message + '。可选择“透明图片”导入。'); error.code = 'E_SVG_SHAPE'; throw error; }
  function numbers(text) {
    var rest = String(text).replace(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi, '').replace(/[\s,]/g, '');
    if (rest) fail('路径或数值格式不支持');
    return (String(text).match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi) || []).map(function (value) { var n = Number(value); if (!isFinite(n) || Math.abs(n) > 1e8) fail('路径数值超出范围'); return n; });
  }
  function mul(a,b) { return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]]; }
  function point(m,p) { return [m[0]*p[0]+m[2]*p[1]+m[4],m[1]*p[0]+m[3]*p[1]+m[5]]; }
  function vector(m,p) { return [m[0]*p[0]+m[2]*p[1],m[1]*p[0]+m[3]*p[1]]; }
  function parseTransform(text) {
    var result=[1,0,0,1,0,0], match, pattern=/([a-z]+)\s*\(([^)]*)\)/gi, end=0;
    while ((match=pattern.exec(text || ''))) {
      if (text.slice(end,match.index).replace(/[\s,]/g,'')) fail('变换格式不支持');
      end=pattern.lastIndex; var n=numbers(match[2]), name=match[1], m, a;
      if (name==='matrix' && n.length===6) m=n;
      else if (name==='translate' && (n.length===1 || n.length===2)) m=[1,0,0,1,n[0],n[1] || 0];
      else if (name==='scale' && (n.length===1 || n.length===2)) m=[n[0],0,0,n.length===2?n[1]:n[0],0,0];
      else if (name==='rotate' && (n.length===1 || n.length===3)) { a=n[0]*Math.PI/180; m=[Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0]; if(n.length===3)m=mul(mul([1,0,0,1,n[1],n[2]],m),[1,0,0,1,-n[1],-n[2]]); }
      else if ((name==='skewX' || name==='skewY') && n.length===1) { a=Math.tan(n[0]*Math.PI/180); m=name==='skewX'?[1,0,a,1,0,0]:[1,a,0,1,0,0]; }
      else fail('变换类型或参数不支持');
      result=mul(result,m);
    }
    if (String(text || '').slice(end).trim()) fail('变换格式不支持');
    return result;
  }
  function parsePath(data) {
    if (typeof data!=='string' || data.length>2000000) fail('路径数据无效或过大');
    var tokens=data.match(/[a-df-zA-DF-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/g) || [];
    if (data.replace(/[a-df-zA-DF-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/g,'').replace(/[\s,]/g,'')) fail('路径语法不支持');
    var paths=[], p=null, x=0,y=0,start=[0,0], last='',control=null,cmd='',i=0,count=0;
    function add(px,py,c1,c2) {
      if (!isFinite(px) || !isFinite(py) || Math.abs(px)>1e8 || Math.abs(py)>1e8 || ++count>20000) fail('路径数值或复杂度超限');
      if (!p) fail('路径必须从 M 开始');
      var len=p.vertices.length;
      if(c1 && len)p.outTangents[len-1]=[c1[0]-x,c1[1]-y];
      p.vertices.push([px,py]);p.inTangents.push(c2?[c2[0]-px,c2[1]-py]:[0,0]);p.outTangents.push([0,0]);x=px;y=py;
    }
    function finish(closed) {
      if (!p)return;
      p.closed=!!closed;
      if(closed && p.vertices.length>1 && Math.abs(x-start[0])<1e-8 && Math.abs(y-start[1])<1e-8) { p.inTangents[0]=p.inTangents.pop();p.vertices.pop();p.outTangents.pop(); }
      if(p.vertices.length>1)paths.push(p);p=null;
    }
    function arc(rx,ry,angle,large,sweep,px,py) {
      if((large!==0 && large!==1)||(sweep!==0 && sweep!==1))fail('路径圆弧标记无效');
      rx=Math.abs(rx);ry=Math.abs(ry);
      if(px===x && py===y)return;
      if(!rx || !ry){add(px,py);return;}
      var phi=angle*Math.PI/180, c=Math.cos(phi),s=Math.sin(phi), dx=(x-px)/2,dy=(y-py)/2;
      var xp=c*dx+s*dy,yp=-s*dx+c*dy, ratio=xp*xp/(rx*rx)+yp*yp/(ry*ry);
      if(ratio>1){rx*=Math.sqrt(ratio);ry*=Math.sqrt(ratio);}
      var factor=Math.sqrt(Math.max(0,(rx*rx*ry*ry-rx*rx*yp*yp-ry*ry*xp*xp)/(rx*rx*yp*yp+ry*ry*xp*xp)))*(large===sweep?-1:1);
      var cxp=factor*rx*yp/ry,cyp=-factor*ry*xp/rx,cx=c*cxp-s*cyp+(x+px)/2,cy=s*cxp+c*cyp+(y+py)/2;
      var ux=(xp-cxp)/rx,uy=(yp-cyp)/ry,vx=(-xp-cxp)/rx,vy=(-yp-cyp)/ry;
      var from=Math.atan2(uy,ux), delta=Math.atan2(ux*vy-uy*vx,ux*vx+uy*vy);
      if(!sweep && delta>0)delta-=2*Math.PI;if(sweep && delta<0)delta+=2*Math.PI;
      var steps=Math.ceil(Math.abs(delta)/(Math.PI/2)),step=delta/steps;
      function at(t){return [cx+c*rx*Math.cos(t)-s*ry*Math.sin(t),cy+s*rx*Math.cos(t)+c*ry*Math.sin(t)];}
      function derivative(t){return [-c*rx*Math.sin(t)-s*ry*Math.cos(t),-s*rx*Math.sin(t)+c*ry*Math.cos(t)];}
      for(var j=0;j<steps;j++){var t=from+j*step,a=at(t),b=at(t+step),da=derivative(t),db=derivative(t+step),k=4/3*Math.tan(step/4);add(j===steps-1?px:b[0],j===steps-1?py:b[1],[a[0]+k*da[0],a[1]+k*da[1]],[b[0]-k*db[0],b[1]-k*db[1]]);}
    }
    while(i<tokens.length) {
      if(/^[a-z]$/i.test(tokens[i]))cmd=tokens[i++];
      if(!cmd)fail('路径命令缺失');
      var upper=cmd.toUpperCase(), relative=cmd!==upper, sizes={M:2,L:2,H:1,V:1,C:6,S:4,Q:4,T:2,A:7,Z:0},n=sizes[upper];
      if(n===undefined)fail('路径命令不支持');
      if(upper==='Z'){if(!p)fail('路径闭合命令无效');finish(true);x=start[0];y=start[1];last='Z';control=null;cmd='';continue;}
      if(i+n>tokens.length)fail('路径参数不完整');
      var args=[];for(var j=0;j<n;j++){if(/^[a-z]$/i.test(tokens[i]))fail('路径参数不完整');var num=Number(tokens[i++]);if(!isFinite(num)||Math.abs(num)>1e8)fail('路径数值超限');args.push(num);}
      var ox=relative?x:0,oy=relative?y:0,px,py,c1,c2;
      if(upper==='M'){finish(false);p={vertices:[],inTangents:[],outTangents:[],closed:false};start=[args[0]+ox,args[1]+oy];add(start[0],start[1]);cmd=relative?'l':'L';}
      else if(upper==='L')add(args[0]+ox,args[1]+oy);
      else if(upper==='H')add(args[0]+ox,y);
      else if(upper==='V')add(x,args[0]+oy);
      else if(upper==='C'){c1=[args[0]+ox,args[1]+oy];c2=[args[2]+ox,args[3]+oy];add(args[4]+ox,args[5]+oy,c1,c2);control=c2;}
      else if(upper==='S'){c1=(last==='C'||last==='S')?[2*x-control[0],2*y-control[1]]:[x,y];c2=[args[0]+ox,args[1]+oy];add(args[2]+ox,args[3]+oy,c1,c2);control=c2;}
      else if(upper==='Q'||upper==='T') { c1=upper==='Q'?[args[0]+ox,args[1]+oy]:(last==='Q'||last==='T')?[2*x-control[0],2*y-control[1]]:[x,y];px=args[upper==='Q'?2:0]+ox;py=args[upper==='Q'?3:1]+oy;add(px,py,[x+(c1[0]-x)*2/3,y+(c1[1]-y)*2/3],[px+(c1[0]-px)*2/3,py+(c1[1]-py)*2/3]);control=c1; }
      else if(upper==='A')arc(args[0],args[1],args[2],args[3],args[4],args[5]+ox,args[6]+oy);
      if(['C','S','Q','T'].indexOf(upper)<0)control=null;last=upper;
    }
    finish(false);return paths;
  }
  function compile(source) {
    if(typeof source!=='string' || source.length>8*1024*1024)fail('SVG 内容无效或过大');
    var doc=new DOMParser().parseFromString(source,'image/svg+xml'), svg=doc.documentElement;
    if(doc.querySelector('parsererror') || !svg || svg.localName!=='svg')fail('SVG 结构无效');
    if(doc.querySelector('script, foreignObject, image, text, use, style, animate, animateTransform, set'))fail('文字、引用、样式表或动态 SVG 尚不支持形状转换，请先转曲或展开');
    function length(value, fallback) { if(value===null || value==='')return fallback; if(!/^[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?(?:px)?$/i.test(value))fail('尺寸单位暂只支持像素');return numbers(value.replace(/px$/i,''))[0]; }
    var vb=svg.hasAttribute('viewBox')?numbers(svg.getAttribute('viewBox')):null;
    if(vb && (vb.length!==4 || vb[2]<=0 || vb[3]<=0))fail('viewBox 无效');
    function dimension(attr,index,def) { var v=svg.getAttribute(attr); if(v && /%$/.test(v)){if(vb)return vb[index];fail('百分比尺寸需要 viewBox');}return length(v,vb?vb[index]:def); }
    var width=dimension('width',2,300),height=dimension('height',3,150),matrix=[1,0,0,1,0,0];
    if(width<=0 || height<=0 || width>30000 || height>30000)fail('SVG 尺寸超出范围');
    if(vb) {
      var sx=width/vb[2],sy=height/vb[3],aspect=(svg.getAttribute('preserveAspectRatio') || 'xMidYMid meet').trim(),dx=0,dy=0;
      if(aspect!=='none'){var parts=aspect.split(/\s+/);if(!/^x(Min|Mid|Max)Y(Min|Mid|Max)$/.test(parts[0]) || parts[1] && parts[1]!=='meet')fail('视口裁切暂不支持');var scale=Math.min(sx,sy);dx=(width-vb[2]*scale)*(parts[0].indexOf('xMid')===0?.5:parts[0].indexOf('xMax')===0?1:0);dy=(height-vb[3]*scale)*(parts[0].indexOf('YMid')>0?.5:parts[0].indexOf('YMax')>0?1:0);sx=scale;sy=scale;}
      matrix=[sx,0,0,sy,dx-vb[0]*sx,dy-vb[1]*sy];
    }
    var elements=[],vertexCount=0,styleKeys=['fill','fill-opacity','fill-rule','stroke','stroke-opacity','stroke-width','stroke-linecap','stroke-linejoin','stroke-miterlimit','stroke-dasharray','stroke-dashoffset','opacity','display','visibility','color'];
    var context=document.createElement('canvas').getContext('2d');
    function color(value,alpha,currentColor) {
      if(value==='none')return null;if(value==='currentColor')value=currentColor;
      if(/url\(/i.test(value))fail('渐变暂不支持，仅可转换纯色填充和描边');
      context.fillStyle='#010203';context.fillStyle=value;var normalized=context.fillStyle;
      if(normalized==='#010203'){context.fillStyle='#040506';context.fillStyle=value;if(context.fillStyle==='#040506')fail('颜色格式不支持');normalized=context.fillStyle;}
      var rgba;if(normalized[0]==='#'){var n=normalized.slice(1);rgba=[parseInt(n.slice(0,2),16)/255,parseInt(n.slice(2,4),16)/255,parseInt(n.slice(4,6),16)/255,1];}
      else {var channels=normalized.match(/[\d.]+/g).map(Number);if(channels.length<3)fail('颜色格式不支持');rgba=[channels[0]/255,channels[1]/255,channels[2]/255,channels.length>3?channels[3]:1];}
      rgba[3]*=alpha;return rgba;
    }
    function opacity(value){var n=length(value,1);if(n<0 || n>1)fail('透明度范围无效');return n;}
    function visit(node,parentStyle,parentMatrix,depth) {
      if(depth>64 || elements.length>=512)fail('SVG 分组或图形数量超限');
      var tag=node.localName;
      if(['defs','title','desc','metadata'].indexOf(tag)>=0)return;
      var style=Object.assign({},parentStyle);style.opacity='1';
      styleKeys.forEach(function(key){if(node.hasAttribute(key))style[key]=node.getAttribute(key).trim();});
      (node.getAttribute('style') || '').split(';').forEach(function(declaration){if(!declaration.trim())return;var colon=declaration.indexOf(':'),key=declaration.slice(0,colon).trim(),value=declaration.slice(colon+1).trim();if(colon<0 || styleKeys.indexOf(key)<0 || /!important/.test(value))fail('内联样式暂不支持：'+key);style[key]=value;});
      if(style.display==='none' || style.visibility==='hidden' || style.visibility==='collapse')return;
      ['clip-path','mask','filter','vector-effect','paint-order'].forEach(function(key){if(node.hasAttribute(key) && node.getAttribute(key)!=='none' && node.getAttribute(key)!=='normal')fail('暂不支持 '+key);});
      if(style['stroke-dasharray'] && style['stroke-dasharray']!=='none' || style['stroke-dashoffset'] && Number(style['stroke-dashoffset'])!==0)fail('虚线描边暂不支持');
      var m=mul(parentMatrix,parseTransform(node.getAttribute('transform') || ''));
      if(tag==='g' || node===svg) {
        if(opacity(style.opacity)!==1)fail('分组透明度暂不支持，请先展开外观');
        Array.from(node.children).forEach(function(child){visit(child,style,m,depth+1);});return;
      }
      function attr(key,fallback){return length(node.getAttribute(key),fallback===undefined?0:fallback);}
      var d='',x,y,w,h,rx,ry;
      if(tag==='path')d=node.getAttribute('d') || '';
      else if(tag==='rect') {
        x=attr('x');y=attr('y');w=attr('width');h=attr('height');if(w<0 || h<0)fail('矩形尺寸无效');if(!w || !h)return;
        rx=attr('rx',node.hasAttribute('ry')?attr('ry'):0);ry=attr('ry',rx);if(rx<0 || ry<0)fail('圆角无效');rx=Math.min(rx,w/2);ry=Math.min(ry,h/2);
        if(rx && ry)d='M'+(x+rx)+' '+y+'H'+(x+w-rx)+'A'+rx+' '+ry+' 0 0 1 '+(x+w)+' '+(y+ry)+'V'+(y+h-ry)+'A'+rx+' '+ry+' 0 0 1 '+(x+w-rx)+' '+(y+h)+'H'+(x+rx)+'A'+rx+' '+ry+' 0 0 1 '+x+' '+(y+h-ry)+'V'+(y+ry)+'A'+rx+' '+ry+' 0 0 1 '+(x+rx)+' '+y+'Z';
        else d='M'+x+' '+y+'h'+w+'v'+h+'h'+(-w)+'Z';
      } else if(tag==='circle' || tag==='ellipse') {
        x=attr('cx');y=attr('cy');rx=tag==='circle'?attr('r'):attr('rx');ry=tag==='circle'?rx:attr('ry');if(rx<0 || ry<0)fail('圆形半径无效');if(!rx || !ry)return;
        d='M'+(x+rx)+' '+y+'A'+rx+' '+ry+' 0 0 1 '+x+' '+(y+ry)+'A'+rx+' '+ry+' 0 0 1 '+(x-rx)+' '+y+'A'+rx+' '+ry+' 0 0 1 '+x+' '+(y-ry)+'A'+rx+' '+ry+' 0 0 1 '+(x+rx)+' '+y+'Z';
      } else if(tag==='line')d='M'+attr('x1')+' '+attr('y1')+'L'+attr('x2')+' '+attr('y2');
      else if(tag==='polygon' || tag==='polyline') {var coords=numbers(node.getAttribute('points') || '');if(coords.length%2)fail('多边形坐标无效');if(coords.length<4)return;d='M'+coords[0]+' '+coords[1];for(var j=2;j<coords.length;j+=2)d+='L'+coords[j]+' '+coords[j+1];if(tag==='polygon')d+='Z';}
      else fail('暂不支持 SVG 元素 '+tag);
      var paths=parsePath(d);if(!paths.length)return;
      paths.forEach(function(p){vertexCount+=p.vertices.length;p.vertices=p.vertices.map(function(v){return point(m,v);});p.inTangents=p.inTangents.map(function(v){return vector(m,v);});p.outTangents=p.outTangents.map(function(v){return vector(m,v);});});
      if(vertexCount>20000)fail('路径顶点数量超限');
      var fill=tag==='line'?null:color(style.fill,opacity(style['fill-opacity']),style.color),stroke=color(style.stroke,opacity(style['stroke-opacity']),style.color),strokeWidth=length(style['stroke-width'],1);
      if(strokeWidth<0)fail('描边宽度无效');if(strokeWidth===0)stroke=null;
      var scaleX=Math.hypot(m[0],m[1]),scaleY=Math.hypot(m[2],m[3]);
      if(stroke && (Math.abs(scaleX-scaleY)>1e-6 || Math.abs(m[0]*m[2]+m[1]*m[3])>1e-6))fail('非等比或倾斜描边暂不支持，请先轮廓化描边');
      if(!fill && !stroke)return;
      if(['nonzero','evenodd'].indexOf(style['fill-rule'])<0 || ['butt','round','square'].indexOf(style['stroke-linecap'])<0 || ['miter','round','bevel'].indexOf(style['stroke-linejoin'])<0)fail('填充或描边规则不支持');
      elements.push({name:node.getAttribute('id') || tag+' '+(elements.length+1),paths:paths,fill:fill,stroke:stroke,strokeWidth:strokeWidth*scaleX,lineCap:style['stroke-linecap'],lineJoin:style['stroke-linejoin'],miterLimit:length(style['stroke-miterlimit'],4),fillRule:style['fill-rule'],opacity:opacity(style.opacity)});
    }
    visit(svg,{fill:'black',stroke:'none','fill-opacity':'1','stroke-opacity':'1','fill-rule':'nonzero','stroke-width':'1','stroke-linecap':'butt','stroke-linejoin':'miter','stroke-miterlimit':'4',color:'black'},matrix,0);
    if(!elements.length)fail('SVG 没有可转换的可见路径');
    // AE shape groups are not SVG viewports. Refuse clipped artwork rather than silently extending it.
    elements.forEach(function(element){element.paths.forEach(function(p){p.vertices.forEach(function(v){if(v[0]<-0.01 || v[1]<-0.01 || v[0]>width+0.01 || v[1]>height+0.01)fail('路径超出 SVG 视口，暂不支持视口裁切');});});});
    return {version:1,width:width,height:height,elements:elements};
  }
  var api={parsePath:parsePath,parseTransform:parseTransform,transformPoint:point,compile:compile,compileURL:function(url){if(!/^data:image\/svg\+xml;base64,/.test(url))fail('SVG 快照格式无效');var binary=atob(url.split(',')[1]),bytes=new Uint8Array(binary.length);for(var i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return compile(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}};
  if(typeof module!=='undefined' && module.exports)module.exports=api;
  if(typeof window!=='undefined')window.AEBrowseSVG=api;
})(typeof window!=='undefined'?window:this);
