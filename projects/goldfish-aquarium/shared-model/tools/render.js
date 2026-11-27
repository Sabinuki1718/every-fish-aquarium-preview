// usage: node render.js model.glb outprefix [views json]
const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
(async()=>{
 const [glb,prefix,viewsArg]=process.argv.slice(2);
 const views=viewsArg?JSON.parse(viewsArg):{front:[0,0,3],back:[0,0,-3],left:[-3,0,0],right:[3,0,0],top:[0,3,0.001],bottom:[0,-3,0.001],obl:[2,1.2,2],obl2:[-2,1.2,-2]};
 const b=await chromium.launch();const p=await b.newPage({viewport:{width:700,height:700}});
 const three=fs.readFileSync(path.join(__dirname,'three-offline.js'),'utf8');
 await p.setContent('<html><body style="margin:0;background:#fff"></body></html>');
 await p.addScriptTag({content:three});
 const data=fs.readFileSync(glb).toString('base64');
 await p.evaluate(async(data)=>{
  const T=window.THREE;const r=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});r.setSize(700,700);r.setClearColor(0xffffff);document.body.appendChild(r.domElement);
  r.outputColorSpace=T.SRGBColorSpace;
  const s=new T.Scene();s.add(new T.HemisphereLight(0xffffff,0x888888,2.2));const dl=new T.DirectionalLight(0xffffff,1.2);dl.position.set(1,2,3);s.add(dl);
  const bin=Uint8Array.from(atob(data),c=>c.charCodeAt(0)).buffer;
  const g=await new Promise((res,rej)=>new T.GLTFLoader().parse(bin,'',res,rej));
  s.add(g.scene);const box=new T.Box3().setFromObject(g.scene);const c=box.getCenter(new T.Vector3());const sz=box.getSize(new T.Vector3()).length();
  window.__r=(pos,zoom)=>{const cam=new T.OrthographicCamera(-sz/2/zoom,sz/2/zoom,sz/2/zoom,-sz/2/zoom,0.01,100);
    cam.position.set(c.x+pos[0],c.y+pos[1],c.z+pos[2]);cam.up.set(0,Math.abs(pos[1])>2.5?0:1,Math.abs(pos[1])>2.5?-1:0);cam.lookAt(c);dl.position.copy(cam.position);r.render(s,cam);return r.domElement.toDataURL('image/png');};
 },data);
 for(const [k,v] of Object.entries(views)){
  const z=v[3]||1;const url=await p.evaluate(([v,z])=>window.__r(v,z),[v.slice(0,3),z]);
  fs.writeFileSync(`${prefix}_${k}.png`,Buffer.from(url.split(',')[1],'base64'));
 }
 await b.close();
})();
