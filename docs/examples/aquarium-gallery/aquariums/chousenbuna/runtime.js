export function chooseLightMode(search,coarse,touch,memory){
  const quality=new URLSearchParams(search).get('quality');
  if(quality==='lite')return true;
  if(quality==='full')return false;
  return coarse||touch>0||(Number.isFinite(memory)&&memory<=4);
}
export const LIGHT_MODE=chooseLightMode(location.search,
  matchMedia('(pointer: coarse)').matches,navigator.maxTouchPoints||0,navigator.deviceMemory);

const resized=new WeakSet();
export function prepareTextures(root){
  if(!LIGHT_MODE)return;
  root.traverse(object=>{
    const materials=Array.isArray(object.material)?object.material:[object.material];
    for(const material of materials){
      if(!material)continue;
      for(const texture of Object.values(material)){
        if(!texture?.isTexture||resized.has(texture)||!texture.image)continue;
        resized.add(texture);const image=texture.image,w=image.width,h=image.height;
        if(Math.max(w,h)<=1024)continue;
        const scale=1024/Math.max(w,h),canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
        canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
        texture.image=canvas;texture.needsUpdate=true;
      }
    }
  });
}

export function createAquariumRenderer(THREE,alpha=false){
  const renderer=new THREE.WebGLRenderer({alpha,antialias:!LIGHT_MODE,
    powerPreference:LIGHT_MODE?'low-power':'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,LIGHT_MODE?1:1.7));
  renderer.shadowMap.enabled=!LIGHT_MODE;renderer.aquariumLightMode=LIGHT_MODE;
  document.getElementById('viewer').dataset.quality=LIGHT_MODE?'lite':'full';
  renderer.domElement.addEventListener('webglcontextlost',event=>{
    event.preventDefault();window.aquariumShowError?.(new Error('3D描画が停止しました。軽量表示でもう一度お試しください。'));
  });
  return renderer;
}

