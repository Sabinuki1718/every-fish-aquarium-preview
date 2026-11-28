const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
(async()=>{
 const [layoutPath,root,outPrefix]=process.argv.slice(2);
 const L=JSON.parse(fs.readFileSync(layoutPath,'utf8'));
 const fish=L.fish.map(f=>({...f,b64:fs.readFileSync(path.join(root,f.model)).toString('base64')}));
 const b=await chromium.launch();const p=await b.newPage({viewport:{width:1600,height:1000}});
 p.on('pageerror',e=>console.log('ERR',e));
 await p.setContent('<html><body style="margin:0"></body></html>');
 await p.addScriptTag({content:fs.readFileSync(path.join(__dirname,'three-offline.js'),'utf8')});
 await p.evaluate(async({L,fish})=>{
  const T=window.THREE;const r=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});r.setSize(1600,1000);document.body.appendChild(r.domElement);
  r.outputColorSpace=T.SRGBColorSpace;r.toneMapping=T.ACESFilmicToneMapping;r.shadowMap.enabled=true;
  const s=new T.Scene();s.background=new T.Color(0x1d2126);
  let seed=7;const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
  const tk=L.tank;
  // lights
  s.add(new T.HemisphereLight(0xdfeeff,0x2a2a22,1.1));
  const sun=new T.DirectionalLight(0xffffff,2.4);sun.position.set(5,60,12);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
  Object.assign(sun.shadow.camera,{left:-40,right:40,top:40,bottom:-40});s.add(sun);
  // background screen
  const cv=document.createElement('canvas');cv.width=8;cv.height=256;const g=cv.getContext('2d');const gr=g.createLinearGradient(0,0,0,256);
  gr.addColorStop(0,'#3c5d73');gr.addColorStop(0.6,'#1f3a4c');gr.addColorStop(1,'#0e1b24');g.fillStyle=gr;g.fillRect(0,0,8,256);
  const bgt=new T.CanvasTexture(cv);bgt.colorSpace=T.SRGBColorSpace;
  const bg=new T.Mesh(new T.PlaneGeometry(tk.w,tk.h),new T.MeshBasicMaterial({map:bgt}));bg.position.set(0,tk.h/2,-tk.d/2-0.3);s.add(bg);
  // gravel texture
  const gc=document.createElement('canvas');gc.width=gc.height=1024;const gg=gc.getContext('2d');gg.fillStyle='#4a463f';gg.fillRect(0,0,1024,1024);
  const pal=['#2b2a28','#5d5850','#7a7268','#3d3a35','#8b8070','#6b5e4c','#a39a8c','#1f1e1c'];
  for(let i=0;i<26000;i++){const x=rnd()*1024,y=rnd()*1024,rr=3+rnd()*6;gg.fillStyle=pal[(rnd()*pal.length)|0];gg.beginPath();gg.ellipse(x,y,rr,rr*(0.6+rnd()*0.4),rnd()*3,0,7);gg.fill();
    gg.fillStyle='rgba(255,255,255,0.18)';gg.beginPath();gg.arc(x-rr*0.3,y-rr*0.3,rr*0.3,0,7);gg.fill();}
  const gt=new T.CanvasTexture(gc);gt.colorSpace=T.SRGBColorSpace;gt.wrapS=gt.wrapT=T.RepeatWrapping;gt.repeat.set(3,1.5);
  const sg=new T.PlaneGeometry(tk.w,tk.d,60,30);sg.rotateX(-Math.PI/2);const sp=sg.attributes.position;
  for(let i=0;i<sp.count;i++){const z=sp.getZ(i);const t=(tk.d/2-z)/tk.d;sp.setY(i,3+3*t*t+(rnd()-0.5)*0.4);}sg.computeVertexNormals();
  const sub=new T.Mesh(sg,new T.MeshStandardMaterial({map:gt,roughness:0.9}));sub.receiveShadow=true;s.add(sub);
  const groundY=(x,z)=>{const t=(tk.d/2-z)/tk.d;return 3+3*t*t;};
  // stones
  const stoneTex=()=>{const c=document.createElement('canvas');c.width=c.height=512;const x=c.getContext('2d');x.fillStyle='#6f7b84';x.fillRect(0,0,512,512);
    for(let i=0;i<4000;i++){x.fillStyle=`rgba(${(rnd()*60+60)|0},${(rnd()*60+70)|0},${(rnd()*60+80)|0},0.25)`;x.fillRect(rnd()*512,rnd()*512,2+rnd()*6,2+rnd()*6);}
    x.strokeStyle='rgba(220,225,230,0.25)';for(let i=0;i<6;i++){x.lineWidth=1+rnd()*2;x.beginPath();x.moveTo(rnd()*512,0);x.bezierCurveTo(rnd()*512,170,rnd()*512,340,rnd()*512,512);x.stroke();}
    const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;return t;};
  const st=stoneTex();
  for(const o of L.objects.filter(o=>o.kind==='stone')){
    const geo=new T.IcosahedronGeometry(1,7);const pp=geo.attributes.position;const k1=rnd()*10,k2=rnd()*10;
    for(let i=0;i<pp.count;i++){const v=new T.Vector3().fromBufferAttribute(pp,i);const n=1+0.08*Math.sin(v.x*3+k1)*Math.cos(v.z*2.5+k2)+0.04*Math.sin(v.y*5+k2);v.multiplyScalar(n);pp.setXYZ(i,v.x,v.y,v.z);}
    geo.computeVertexNormals();const m=new T.Mesh(geo,new T.MeshStandardMaterial({map:st,roughness:0.75,color:0xb8c4cc}));
    m.scale.set(o.size[0]/2,o.size[1]/2,o.size[2]/2);m.rotation.y=o.rot*Math.PI/180;
    m.position.set(o.pos[0],groundY(o.pos[0],o.pos[2])+o.size[1]*0.32,o.pos[2]);m.castShadow=m.receiveShadow=true;s.add(m);}
  // driftwood
  for(const o of L.objects.filter(o=>o.kind==='driftwood')){
    const grp=new T.Group();const mat=new T.MeshStandardMaterial({color:0x5a3f2a,roughness:0.95});
    const branch=(len,r0,r1,ax,az,base)=>{const c=new T.Mesh(new T.CylinderGeometry(r1,r0,len,10,6),mat);c.geometry.translate(0,len/2,0);c.position.copy(base);c.rotation.set(ax,0,az);c.castShadow=true;grp.add(c);return c;};
    branch(o.len,1.4,0.6,0,1.25,new T.Vector3(0,0,0));branch(12,0.8,0.25,0.2,1.0,new T.Vector3(-3,0.5,0));branch(9,0.7,0.2,-0.3,0.85,new T.Vector3(-9,0.8,0.5));
    grp.position.set(o.pos[0],groundY(o.pos[0],o.pos[2])+0.6,o.pos[2]);grp.rotation.y=o.rot*Math.PI/180;s.add(grp);}
  // plants
  const leafMat=(c)=>new T.MeshStandardMaterial({color:c,roughness:0.6,side:T.DoubleSide});
  for(const o of L.objects.filter(o=>o.kind==='plant')){
    const by=groundY(o.pos[0],o.pos[2]);
    if(o.species.startsWith('バリス')){for(let i=0;i<o.count;i++){const h=o.height*(0.65+rnd()*0.4);const geo=new T.PlaneGeometry(0.9,h,1,16);geo.translate(0,h/2,0);const pp=geo.attributes.position;const bend=(rnd()-0.3)*6,tw=rnd()*2;
      for(let j=0;j<pp.count;j++){const y=pp.getY(j)/h;pp.setX(j,pp.getX(j)*(1-0.3*y)+bend*y*y);pp.setZ(j,Math.sin(y*3+tw)*1.2);}geo.computeVertexNormals();
      const m=new T.Mesh(geo,leafMat(new T.Color().setHSL(0.27+rnd()*0.04,0.55,0.28+rnd()*0.1)));m.position.set(o.pos[0]+(rnd()-0.5)*7,by,o.pos[2]+(rnd()-0.5)*5);m.rotation.y=rnd()*6.3;m.castShadow=true;s.add(m);}}
    else {const isA=o.species.startsWith('アヌ');for(let i=0;i<o.count;i++){const len=o.height*(0.6+rnd()*0.5);const w=isA?len*0.55:len*0.22;
      const shp=new T.Shape();shp.moveTo(0,0);shp.quadraticCurveTo(w,len*0.45,0,len);shp.quadraticCurveTo(-w,len*0.45,0,0);const geo=new T.ShapeGeometry(shp,12);
      const m=new T.Mesh(geo,leafMat(new T.Color().setHSL(isA?0.3:0.28,isA?0.5:0.55,isA?0.18:0.25)));m.position.set(o.pos[0]+(rnd()-0.5)*4,o.pos[1]+(rnd()-0.5)*2,o.pos[2]+(rnd()-0.5)*3);
      m.rotation.set(-0.3-rnd()*0.8,rnd()*6.3,(rnd()-0.5)*1.2);m.castShadow=true;s.add(m);}}
  }
  // fish
  const loader=new T.GLTFLoader();
  for(const f of fish){const bin=Uint8Array.from(atob(f.b64),c=>c.charCodeAt(0)).buffer;const g2=await new Promise((res,rej)=>loader.parse(bin,'',res,rej));
    const o=g2.scene;o.scale.setScalar(f.length_cm/0.12);o.position.set(...f.pos);o.rotation.y=Math.PI+f.heading_deg*Math.PI/180;
    o.traverse(m=>{if(m.isMesh){m.castShadow=true;m.material.side=T.DoubleSide;}});s.add(o);}
  // water + glass
  const water=new T.Mesh(new T.BoxGeometry(tk.w-0.2,tk.water,tk.d-0.2),new T.MeshPhysicalMaterial({color:0xcfe6ee,transparent:true,opacity:0.08,roughness:0.1,depthWrite:false}));water.position.y=tk.water/2;s.add(water);
  const surf=new T.Mesh(new T.PlaneGeometry(tk.w,tk.d),new T.MeshPhysicalMaterial({color:0xbfe0ff,transparent:true,opacity:0.25,roughness:0.05,metalness:0.1,side:T.DoubleSide}));surf.rotation.x=-Math.PI/2;surf.position.y=tk.water;s.add(surf);
  const edges=new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(tk.w,tk.h,tk.d)),new T.LineBasicMaterial({color:0xa8c8d0}));edges.position.y=tk.h/2;s.add(edges);
  const glassBottom=new T.Mesh(new T.BoxGeometry(tk.w+2,1.2,tk.d+2),new T.MeshStandardMaterial({color:0x111111}));glassBottom.position.y=-0.6;s.add(glassBottom);
  window.__shot=(pos,tgt,fov)=>{const cam=new T.PerspectiveCamera(fov,1.6,1,500);cam.position.set(...pos);cam.lookAt(new T.Vector3(...tgt));r.render(s,cam);return r.domElement.toDataURL('image/png');};
 },{L,fish});
 const shots={front:[[0,17,78],[0,15,0],32],oblique:[[-45,38,58],[0,12,-2],32],top:[[0,95,0.01],[0,0,0],34]};
 for(const [k,[pos,tgt,fov]] of Object.entries(shots)){const u=await p.evaluate(([a,b,c])=>window.__shot(a,b,c),[pos,tgt,fov]);fs.writeFileSync(`${outPrefix}-${k}.png`,Buffer.from(u.split(',')[1],'base64'));}
 await b.close();
})();
