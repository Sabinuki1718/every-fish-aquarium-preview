import * as THREE from './vendor/three.module.js';

export function createLayoutEditor({scene,camera,renderer,controls,rocks,plants,view,setStoneColors}){
  const objects=[...rocks,...plants];
  const defaults=objects.map(o=>({position:o.position.toArray(),angle:o.rotation.y}));
  const defaultColors=rocks.map(rock=>rock.userData.color);
  let stoneColors=[...defaultColors];
  const names=objects.map((o,i)=>i<rocks.length?`石 ${i+1}`:`海藻 ${i-rocks.length+1}`);
  const storageKey='isoginpo-layout-v1';
  const $=id=>document.getElementById(id);
  const select=$('object'),xInput=$('position-x'),zInput=$('position-z'),rotationInput=$('rotation');
  const ring=new THREE.BoxHelper(objects[0],0xc6e7a9);ring.visible=false;
  ring.material.depthTest=false;ring.material.transparent=true;ring.material.opacity=.7;ring.renderOrder=10;scene.add(ring);
  let editing=false,selected=0,drag=null;
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),floor=new THREE.Plane(new THREE.Vector3(0,1,0),-.27);
  const rayPoint=new THREE.Vector3(),box=new THREE.Box3();
  const canvas=renderer.domElement;
  names.forEach((name,i)=>select.add(new Option(name,String(i))));

  function limits(object){
    object.updateWorldMatrix(true,true);box.setFromObject(object);
    const minX=-5.94-(box.min.x-object.position.x),maxX=5.94-(box.max.x-object.position.x);
    const minZ=-2.92-(box.min.z-object.position.z),maxZ=2.92-(box.max.z-object.position.z);
    return minX<=maxX&&minZ<=maxZ?{minX,maxX,minZ,maxZ}:null;
  }
  function move(object,x,z){
    const b=limits(object);if(!b)return false;
    object.position.x=THREE.MathUtils.clamp(x,b.minX,b.maxX);
    object.position.z=THREE.MathUtils.clamp(z,b.minZ,b.maxZ);return true;
  }
  function sync(){
    const object=objects[selected],b=limits(object);select.value=String(selected);
    if(b){xInput.min=String(Math.ceil(b.minX*100)/100);xInput.max=String(Math.floor(b.maxX*100)/100);zInput.min=String(Math.ceil(b.minZ*100)/100);zInput.max=String(Math.floor(b.maxZ*100)/100);}
    xInput.value=String(object.position.x);zInput.value=String(object.position.z);
    $('x-value').textContent=object.position.x.toFixed(2);$('z-value').textContent=object.position.z.toFixed(2);
    const degrees=THREE.MathUtils.radToDeg(object.rotation.y);
    rotationInput.value=String(Math.round(degrees));$('rotation-value').textContent=Math.round(degrees)+'°';
    $('stone-color-field').hidden=selected>=rocks.length;
    if(selected<rocks.length)$('stone-color').value=String(stoneColors[selected]);
    document.querySelectorAll('[data-all-color]').forEach(button=>{
      const on=stoneColors.every(value=>value===(button.dataset.allColor==='red'?1:0));
      button.classList.toggle('active',on);button.setAttribute('aria-pressed',String(on));
    });
    ring.setFromObject(object);ring.visible=editing;
  }
  function save(){
    try{localStorage.setItem(storageKey,JSON.stringify({version:2,colors:stoneColors,objects:objects.map(o=>({x:o.position.x,z:o.position.z,angle:o.rotation.y}))}));}
    catch{$('edit-status').textContent='配置を変更しました（このブラウザでは保存できません）';}
  }
  function choose(index){selected=index;sync();$('edit-status').textContent=names[index]+' · ドラッグして移動';}
  function setMode(on){
    finish();editing=on;plants.forEach(p=>p.rotation.z=0);
    $('observe').classList.toggle('active',!on);$('observe').setAttribute('aria-pressed',String(!on));
    $('edit').classList.toggle('active',on);$('edit').setAttribute('aria-pressed',String(on));
    $('editor').hidden=!on;$('editor-actions').hidden=!on;
    $('hint').textContent=on?'石・海藻をドラッグして移動':'ドラッグで回転 · ホイール / ピンチで拡大';
    if(on)view('top');canvas.style.cursor=on?'grab':'';sync();
  }
  function applyColors(colors,persist=true){stoneColors=[...colors];setStoneColors(stoneColors);sync();if(persist)save();}
  $('observe').onclick=()=>setMode(false);$('edit').onclick=()=>setMode(true);
  select.onchange=()=>choose(Number(select.value));
  xInput.oninput=()=>{move(objects[selected],Number(xInput.value),objects[selected].position.z);sync();save();};
  zInput.oninput=()=>{move(objects[selected],objects[selected].position.x,Number(zInput.value));sync();save();};
  rotationInput.oninput=()=>{
    const object=objects[selected],previous=object.rotation.y;object.rotation.y=THREE.MathUtils.degToRad(Number(rotationInput.value));
    if(!move(object,object.position.x,object.position.z)){object.rotation.y=previous;$('edit-status').textContent='この向きでは水槽に収まりません';}
    sync();save();
  };
  document.querySelectorAll('[data-all-color]').forEach(button=>button.onclick=()=>applyColors(rocks.map(()=>button.dataset.allColor==='red'?1:0)));
  $('stone-color').onchange=()=>{
    if(selected>=rocks.length)return;
    const colors=[...stoneColors];colors[selected]=Number($('stone-color').value);applyColors(colors);
  };
  $('restore').onclick=()=>{
    finish();objects.forEach((object,i)=>{object.position.fromArray(defaults[i].position);object.rotation.y=defaults[i].angle;});
    applyColors(defaultColors,false);sync();save();$('edit-status').textContent='デフォルトに戻しました';
  };
  function ray(event){
    const rect=canvas.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(pointer,camera);
  }
  canvas.addEventListener('pointerdown',event=>{
    if(!editing||event.button!==0||drag)return;
    ray(event);
    const hit=raycaster.intersectObjects(objects,true).find(h=>h.object.isMesh);if(!hit)return;
    let root=hit.object;while(root&&!objects.includes(root))root=root.parent;
    if(!root||!raycaster.ray.intersectPlane(floor,rayPoint))return;
    choose(objects.indexOf(root));
    drag={pointer:event.pointerId,offsetX:root.position.x-rayPoint.x,offsetZ:root.position.z-rayPoint.z};
    controls.enabled=false;canvas.setPointerCapture(event.pointerId);canvas.style.cursor='grabbing';
    event.preventDefault();event.stopImmediatePropagation();
  },true);
  canvas.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.pointer)return;
    ray(event);if(raycaster.ray.intersectPlane(floor,rayPoint)){move(objects[selected],rayPoint.x+drag.offsetX,rayPoint.z+drag.offsetZ);sync();}
    event.preventDefault();event.stopImmediatePropagation();
  },true);
  function finish(event){
    if(!drag||(event&&event.pointerId!==drag.pointer))return;
    const id=drag.pointer;drag=null;controls.enabled=true;
    if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);
    canvas.style.cursor=editing?'grab':'';save();
    if(event){event.preventDefault();event.stopImmediatePropagation();}
  }
  canvas.addEventListener('pointerup',finish,true);canvas.addEventListener('pointercancel',finish,true);canvas.addEventListener('lostpointercapture',finish,true);
  try{
    const data=JSON.parse(localStorage.getItem(storageKey));
    if([1,2].includes(data?.version)&&Array.isArray(data.objects)&&data.objects.length===objects.length){
      data.objects.forEach((saved,i)=>{
        if(!saved||![saved.x,saved.z,saved.angle].every(Number.isFinite)||Math.abs(saved.angle)>Math.PI)return;
        const object=objects[i];object.rotation.y=saved.angle;
        if(!move(object,saved.x,saved.z)){object.position.fromArray(defaults[i].position);object.rotation.y=defaults[i].angle;}
      });
      if(data.version===2&&Array.isArray(data.colors)&&data.colors.length===rocks.length&&data.colors.every(value=>value===0||value===1)){
        applyColors(data.colors,false);
      }else if(data.version===1&&['mixed','green','red'].includes(data.color)){
        applyColors(data.color==='mixed'?defaultColors:rocks.map(()=>data.color==='red'?1:0),false);
      }
    }
  }catch{/* A missing or invalid browser save leaves the initial layout intact. */}
  setStoneColors(stoneColors);sync();
  return {get editing(){return editing;},get colors(){return [...stoneColors];},update(){if(editing)ring.setFromObject(objects[selected]);}};
}


