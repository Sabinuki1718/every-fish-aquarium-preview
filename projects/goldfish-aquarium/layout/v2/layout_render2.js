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
  r.outputColorSpace=T.SRGBColorSpace;r.toneMapping=T.ACESFilmicToneMapping;r.shadowMap.enabled=true;r.shadowMap.type=T.PCFSoftShadowMap;
  const s=new T.Scene();s.background=new T.Color(0x1d2126);
  let seed=11;const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
  const tk=L.tank;
  s.add(new T.HemisphereLight(0xdfeeff,0x2a2a22,1.0));
  const sun=new T.DirectionalLight(0xffffff,2.3);sun.position.set(6,60,14);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.radius=4;
  Object.assign(sun.shadow.camera,{left:-40,right:40,top:40,bottom:-40});s.add(sun);
  const cv=document.createElement('canvas');cv.width=8;cv.height=256;const g=cv.getContext('2d');const gr=g.createLinearGradient(0,0,0,256);
  gr.addColorStop(0,'#3c5d73');gr.addColorStop(0.6,'#1f3a4c');gr.addColorStop(1,'#0e1b24');g.fillStyle=gr;g.fillRect(0,0,8,256);
  const bgt=new T.CanvasTexture(cv);bgt.colorSpace=T.SRGBColorSpace;
  const bg=new T.Mesh(new T.PlaneGeometry(tk.w,tk.h),new T.MeshBasicMaterial({map:bgt}));bg.position.set(0,tk.h/2,-tk.d/2-0.3);s.add(bg);
  // substrate with 砂紋
  const PX=2048/tk.w;const gc=document.createElement('canvas');gc.width=2048;gc.height=1024;const gg=gc.getContext('2d');
  gg.fillStyle='#b9b6ae';gg.fillRect(0,0,2048,1024);
  const pal=['#d8d5cd','#a8a49b','#c9c5bc','#8f8b83','#e6e3dc','#9d9890'];
  for(let i=0;i<60000;i++){const x=rnd()*2048,y=rnd()*1024,rr=1.5+rnd()*3.5;gg.fillStyle=pal[(rnd()*pal.length)|0];gg.beginPath();gg.ellipse(x,y,rr,rr*(0.6+rnd()*0.4),rnd()*3,0,7);gg.fill();}
  const toC=(x,z)=>[(x+tk.w/2)*PX,(z+tk.d/2)*PX];
  const groups=[{c:[-12,-4.5],r:13},{c:[18,-6.5],r:9},{c:[4,3],r:4.5},{c:[-24,7],r:3.5}];
  const rake=(draw)=>{gg.lineWidth=PX*0.35;gg.strokeStyle='rgba(70,66,60,0.32)';draw(0);gg.strokeStyle='rgba(255,255,255,0.28)';gg.lineWidth=PX*0.25;draw(PX*0.4);};
  gg.save();gg.beginPath();gg.rect(0,0,2048,1024);for(const q of groups){const [cx,cy]=toC(...q.c);gg.moveTo(cx+(q.r+4*1.3)*PX,cy);gg.arc(cx,cy,(q.r+4*1.3)*PX,0,7,true);}gg.clip('evenodd');
  rake(o=>{for(let z=-tk.d/2;z<tk.d/2;z+=1.3){gg.beginPath();for(let x=-tk.w/2;x<=tk.w/2;x+=1){const [px,py]=toC(x,z);const w=Math.sin(x*0.15)*0.15*PX;x===-tk.w/2?gg.moveTo(px,py+w+o):gg.lineTo(px,py+w+o);}gg.stroke();}});
  gg.restore();
  for(const q of groups){const [cx,cy]=toC(...q.c);rake(o=>{for(let k=0;k<4;k++){gg.beginPath();gg.ellipse(cx,cy+o,(q.r+k*1.3)*PX,(q.r+k*1.3)*PX*0.8,0,0,7);gg.stroke();}});}
  const gt=new T.CanvasTexture(gc);gt.colorSpace=T.SRGBColorSpace;gt.anisotropy=8;
  const groundY=(x,z)=>{const t=(tk.d/2-z)/tk.d;return 3+3*t*t;};
  const sg=new T.PlaneGeometry(tk.w,tk.d,120,60);sg.rotateX(-Math.PI/2);const sp=sg.attributes.position;
  for(let i=0;i<sp.count;i++){sp.setY(i,groundY(sp.getX(i),sp.getZ(i)));}sg.computeVertexNormals();
  const sub=new T.Mesh(sg,new T.MeshStandardMaterial({map:gt,roughness:0.95}));sub.receiveShadow=true;s.add(sub);
  // stones: weathered angular mountain stones
  const stoneTex=()=>{const c=document.createElement('canvas');c.width=c.height=512;const x=c.getContext('2d');x.fillStyle='#8b959c';x.fillRect(0,0,512,512);
    for(let i=0;i<6000;i++){const v=(rnd()*80+80)|0;x.fillStyle=`rgba(${v},${v+8},${v+14},0.3)`;x.fillRect(rnd()*512,rnd()*512,2+rnd()*5,2+rnd()*5);}
    x.strokeStyle='rgba(210,215,220,0.22)';for(let i=0;i<9;i++){x.lineWidth=1+rnd()*2.5;x.beginPath();const y0=rnd()*512;x.moveTo(0,y0);x.bezierCurveTo(170,y0+(rnd()-0.5)*120,340,y0+(rnd()-0.5)*120,512,y0+(rnd()-0.5)*80);x.stroke();}
    const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;return t;};
  const st=stoneTex();
  for(const o of L.objects.filter(o=>o.kind==='stone')){
    const geo=new T.IcosahedronGeometry(1,6);const pp=geo.attributes.position;
    const planes=[];for(let i=0;i<9;i++){const n=new T.Vector3(rnd()-0.5,(rnd()-0.5)*0.6,rnd()-0.5).normalize();planes.push([n,0.72+rnd()*0.2]);}
    for(let i=0;i<pp.count;i++){const v=new T.Vector3().fromBufferAttribute(pp,i);
      for(const [n,d] of planes){const t=v.dot(n);if(t>d){v.addScaledVector(n,-(t-d)*0.85);}}
      v.multiplyScalar(1+0.03*Math.sin(v.x*7)*Math.sin(v.y*6+1)*Math.sin(v.z*8));
      if(v.y<-0.55)v.y=-0.55+(v.y+0.55)*0.2;pp.setXYZ(i,v.x,v.y,v.z);}
    geo.computeVertexNormals();
    const m=new T.Mesh(geo,new T.MeshStandardMaterial({map:st,roughness:0.85,color:0xc4ccd2}));
    m.scale.set(o.size[0]/2,o.size[1]/2,o.size[2]/2);
    m.rotation.set((o.tilt[0]||0)*Math.PI/180,o.tilt[1]*Math.PI/180,o.tilt[2]*Math.PI/180);
    m.position.set(o.pos[0],groundY(o.pos[0],o.pos[2])+o.size[1]*0.5*0.5,o.pos[2]);m.castShadow=m.receiveShadow=true;s.add(m);}
  const leafMat=(c)=>new T.MeshStandardMaterial({color:c,roughness:0.6,side:T.DoubleSide});
  for(const o of L.objects.filter(o=>o.kind==='plant')){
    const by=groundY(o.pos[0],o.pos[2]);
    if(o.species.startsWith('バリス')){for(let i=0;i<o.count;i++){const h=o.height*(0.65+rnd()*0.4);const geo=new T.PlaneGeometry(0.9,h,1,16);geo.translate(0,h/2,0);const pp=geo.attributes.position;const bend=(rnd()-0.3)*6,tw=rnd()*2;
      for(let j=0;j<pp.count;j++){const y=pp.getY(j)/h;pp.setX(j,pp.getX(j)*(1-0.3*y)+bend*y*y);pp.setZ(j,Math.sin(y*3+tw)*1.2);}geo.computeVertexNormals();
      const m=new T.Mesh(geo,leafMat(new T.Color().setHSL(0.27+rnd()*0.04,0.55,0.28+rnd()*0.1)));m.position.set(o.pos[0]+(rnd()-0.5)*7,by,o.pos[2]+(rnd()-0.5)*5);m.rotation.y=rnd()*6.3;m.castShadow=true;s.add(m);}}
    else { // cabomba: stems with whorls of fan leaves
      const segMat=new T.LineBasicMaterial({color:0x5c9a3a});
      for(let i=0;i<o.count;i++){const h=o.height*(0.7+rnd()*0.35);const x0=o.pos[0]+(rnd()-0.5)*5,z0=o.pos[2]+(rnd()-0.5)*3;const lean=(rnd()-0.5)*0.15;
        const pts=[];const stem=[];for(let y=0;y<h;y+=1.1){const sx=x0+lean*y,sz=z0;stem.push(new T.Vector3(sx,by+y,sz));
          const sz2=(y/h<0.15)?0.4:(1.6+0.4*Math.sin(y)) ;const rot=rnd()*3;
          for(let k=0;k<3;k++){const a=rot+k*2.094;const dir=new T.Vector3(Math.cos(a),0.25,Math.sin(a));const base=new T.Vector3(sx,by+y,sz);
            for(let f=-2;f<=2;f++){const a2=a+f*0.28;const d2=new T.Vector3(Math.cos(a2),0.3+0.05*f*f,Math.sin(a2)).multiplyScalar(sz2*(1-0.08*Math.abs(f)));
              pts.push(base,base.clone().add(d2));}}}
        const lg=new T.BufferGeometry().setFromPoints(pts);s.add(new T.LineSegments(lg,new T.LineBasicMaterial({color:new T.Color().setHSL(0.28,0.6,0.3+rnd()*0.06)})));
        s.add(new T.Line(new T.BufferGeometry().setFromPoints(stem),new T.LineBasicMaterial({color:0x4f7d33})));}
    }
  }
  const loader=new T.GLTFLoader();
  for(const f of fish){const bin=Uint8Array.from(atob(f.b64),c=>c.charCodeAt(0)).buffer;const g2=await new Promise((res,rej)=>loader.parse(bin,'',res,rej));
    const o=g2.scene;o.scale.setScalar(f.length_cm/0.12);o.position.set(...f.pos);o.rotation.y=Math.PI+f.heading_deg*Math.PI/180;
    o.traverse(m=>{if(m.isMesh){m.castShadow=true;m.material.side=T.DoubleSide;}});s.add(o);}
  const surf=new T.Mesh(new T.PlaneGeometry(tk.w,tk.d),new T.MeshPhysicalMaterial({color:0xbfe0ff,transparent:true,opacity:0.25,roughness:0.05,side:T.DoubleSide}));surf.rotation.x=-Math.PI/2;surf.position.y=tk.water;s.add(surf);
  const edges=new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(tk.w,tk.h,tk.d)),new T.LineBasicMaterial({color:0xa8c8d0}));edges.position.y=tk.h/2;s.add(edges);
  const gb=new T.Mesh(new T.BoxGeometry(tk.w+2,1.2,tk.d+2),new T.MeshStandardMaterial({color:0x111111}));gb.position.y=-0.6;s.add(gb);
  window.__shot=(pos,tgt,fov)=>{const cam=new T.PerspectiveCamera(fov,1.6,1,500);cam.position.set(...pos);cam.lookAt(new T.Vector3(...tgt));r.render(s,cam);return r.domElement.toDataURL('image/png');};
 },{L,fish});
 const shots={front:[[0,17,78],[0,15,0],32],oblique:[[-45,38,58],[0,12,-2],32],top:[[0,95,0.01],[0,0,0],34]};
 for(const [k,[pos,tgt,fov]] of Object.entries(shots)){const u=await p.evaluate(([a,b,c])=>window.__shot(a,b,c),[pos,tgt,fov]);fs.writeFileSync(`${outPrefix}-${k}.png`,Buffer.from(u.split(',')[1],'base64'));}
 await b.close();
})();
