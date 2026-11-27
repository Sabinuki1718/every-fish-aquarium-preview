// Policy helpers only: the caller connects these values to its renderer and assets.
export function chooseAquariumQuality({userAgent='',userAgentMobile=false,maxTouchPoints=0,coarsePointer=false,requestedQuality='auto'}={}) {
  const mobile=Boolean(userAgentMobile)||/Android|iPhone|iPad|iPod/i.test(userAgent)||(maxTouchPoints>1&&coarsePointer);
  const light=requestedQuality==='light'||(requestedQuality!=='standard'&&mobile);
  return Object.freeze({
    name:light?'light':'standard', fps:light?30:60,
    antialias:!light, shadows:!light, waterPasses:light?1:3,
    pixelRatioCap:light?1:1.7, maxCanvasSide:light?960:Infinity,
    modelTextureSize:light?1024:2048,
  });
}

export function aquariumDrawingSize(profile,width,height,devicePixelRatio=1) {
  const positive=(v,fallback=1)=>Number.isFinite(v)&&v>0?v:fallback;
  const cssWidth=positive(width),cssHeight=positive(height);
  const maxSide=positive(profile.maxCanvasSide,Infinity);
  const pixelRatio=Math.min(positive(devicePixelRatio),positive(profile.pixelRatioCap),maxSide/Math.max(cssWidth,cssHeight));
  return {cssWidth,cssHeight,pixelRatio,
    drawingWidth:Math.max(1,Math.floor(cssWidth*pixelRatio)),
    drawingHeight:Math.max(1,Math.floor(cssHeight*pixelRatio))};
}
