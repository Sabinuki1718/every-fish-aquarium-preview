import numpy as np
from PIL import Image, ImageDraw, ImageFilter
def rot(yaw,pitch):
    # camera basis: start looking from +z (camera at +z), right=+x, up=+y; yaw rotates camera around y, pitch tilts around camera right axis
    a,b=np.radians(yaw),np.radians(pitch)
    Ry=np.array([[np.cos(a),0,np.sin(a)],[0,1,0],[-np.sin(a),0,np.cos(a)]])
    Rx=np.array([[1,0,0],[0,np.cos(b),-np.sin(b)],[0,np.sin(b),np.cos(b)]])
    R=Ry@Rx  # columns: right, up, toward-camera
    return R
def project(V,yaw,pitch,mirror):
    R=rot(yaw,pitch); P=V@R  # coords in camera basis (x right, y up, z toward cam)
    if mirror: P[:,0]*=-1
    return P
def sil(P2,F,W,H):
    im=Image.new('L',(W,H),0); d=ImageDraw.Draw(im)
    for t in F:
        d.polygon([tuple(P2[i]) for i in t],fill=255)
    return np.asarray(im)>0
def photo_mask(img):
    a=np.asarray(img.convert('RGB')).astype(int); m=(255-a.min(2))>14
    mi=Image.fromarray((m*255).astype('uint8')).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))
    return np.asarray(mi)>0
def bbox(m):
    ys,xs=np.nonzero(m); return xs.min(),xs.max(),ys.min(),ys.max()
def fit_xform(P,pm):
    # map projected (x,y) to image pixels: u = s*x+tx, v = -s*y+ty; match bbox height and center
    x0,x1,y0,y1=bbox(pm)
    s=(y1-y0)/(P[:,1].max()-P[:,1].min())
    cx=(x0+x1)/2; cy=(y0+y1)/2
    px=(P[:,0].max()+P[:,0].min())/2; py=(P[:,1].max()+P[:,1].min())/2
    return s, cx-s*px, cy+s*py
def to_img(P,s,tx,ty): return np.stack([s*P[:,0]+tx, -s*P[:,1]+ty],1)
def iou(a,b): return (a&b).sum()/max(1,(a|b).sum())
def search(V,F,pm,yaws,pitches,mirrors=(0,1),ds=4):
    H,W=pm.shape; pms=pm[::ds,::ds]; best=None
    for m in mirrors:
        for yw in yaws:
            for pt in pitches:
                P=project(V,yw,pt,m); s,tx,ty=fit_xform(P,pm)
                q=to_img(P,s,tx,ty)/ds; sm=sil(q,F,pms.shape[1],pms.shape[0])
                sc=iou(sm,pms)
                if best is None or sc>best[0]: best=(sc,yw,pt,m,s,tx,ty)
    return best
def refine(V,F,pm,b,ds=2):
    sc,yw,pt,m,s,tx,ty=b; pms=pm[::ds,::ds]
    def ev(yw,pt,s,tx,ty):
        P=project(V,yw,pt,m); q=to_img(P,s,tx,ty)/ds; return iou(sil(q,F,pms.shape[1],pms.shape[0]),pms)
    cur=ev(yw,pt,s,tx,ty)
    steps=[2,2,0.02*s,6,6]
    for it in range(4):
        improved=False
        for k in range(5):
            for sg in (-1,1):
                x=[yw,pt,s,tx,ty]; x[k]+=sg*steps[k]; v=ev(*x)
                if v>cur: cur=v; yw,pt,s,tx,ty=x; improved=True
        if not improved: steps=[t/2 for t in steps]
    return (cur,yw,pt,m,s,tx,ty)
