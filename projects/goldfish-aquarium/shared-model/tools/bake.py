import sys,json,numpy as np
sys.path.insert(0,'.')
from proj import rot, photo_mask
from PIL import Image, ImageFilter
T=2048
def raster_tris(P2, F, W, H, attrs):
    """P2: (n,2) pixel coords; returns per-pixel triangle id and barycentrics via loop."""
    tid=np.full((H,W),-1,np.int32); bc=np.zeros((H,W,3),np.float32); depth=np.full((H,W),-1e9,np.float32)
    z=attrs
    for t,(a,b,c) in enumerate(F):
        pa,pb,pc=P2[a],P2[b],P2[c]
        x0=int(max(0,np.floor(min(pa[0],pb[0],pc[0])))); x1=int(min(W-1,np.ceil(max(pa[0],pb[0],pc[0]))))
        y0=int(max(0,np.floor(min(pa[1],pb[1],pc[1])))); y1=int(min(H-1,np.ceil(max(pa[1],pb[1],pc[1]))))
        if x1<x0 or y1<y0: continue
        xs,ys=np.meshgrid(np.arange(x0,x1+1)+0.5,np.arange(y0,y1+1)+0.5)
        d=(pb[1]-pc[1])*(pa[0]-pc[0])+(pc[0]-pb[0])*(pa[1]-pc[1])
        if abs(d)<1e-12: continue
        l0=((pb[1]-pc[1])*(xs-pc[0])+(pc[0]-pb[0])*(ys-pc[1]))/d
        l1=((pc[1]-pa[1])*(xs-pc[0])+(pa[0]-pc[0])*(ys-pc[1]))/d
        l2=1-l0-l1
        e=-1e-3 if z is None else -1e-2
        ins=(l0>=e)&(l1>=e)&(l2>=e)
        if not ins.any(): continue
        sy,sx=np.nonzero(ins); sy=sy+y0; sx=sx+x0
        L=np.stack([l0[ins],l1[ins],l2[ins]],1)
        if z is None:
            tid[sy,sx]=t; bc[sy,sx]=L
        else:
            zz=L@z[[a,b,c]]
            upd=zz>depth[sy,sx]
            depth[sy[upd],sx[upd]]=zz[upd]
    return tid,bc,depth
def uv_setup(V,F,UVc,Nc):
    # per-corner uv (fbx, origin bottom-left) -> unique per corner points
    P2=np.zeros((len(F)*3,2)); P2[:,0]=UVc.reshape(-1,2)[:,0]*T; P2[:,1]=(1-UVc.reshape(-1,2)[:,1])*T
    Fc=np.arange(len(F)*3).reshape(-1,3)
    tid,bc,_=raster_tris(P2,Fc,T,T,None)
    m=tid>=0; t=tid[m]; L=bc[m]
    pos=np.einsum('nk,nkd->nd',L,V[F[t]])
    nor=np.einsum('nk,nkd->nd',L,Nc[t]); nor/=np.linalg.norm(nor,axis=1,keepdims=True)+1e-9
    return m,pos,nor
def bake(V,F,m,pos,nor,views,photos,power=6):
    acc=np.zeros((len(pos),3)); wsum=np.zeros(len(pos)); best=np.zeros(len(pos))
    for key,(sc,yw,pt,mir,s,tx,ty) in views.items():
        img=np.asarray(photos[key].convert('RGB')).astype(np.float32); H,W=img.shape[:2]
        pm=photo_mask(photos[key]); pm=np.asarray(Image.fromarray((pm*255).astype('uint8')).filter(ImageFilter.MinFilter(7)))>0
        R=rot(yw,pt)
        def prj(X):
            P=X@R
            if mir: P[:,0]*=-1
            return np.stack([s*P[:,0]+tx,-s*P[:,1]+ty],1),P[:,2]
        P2,z=prj(V); _,_,zb=raster_tris(P2,F,W,H,z)
        q,zq=prj(pos); xi=np.clip(q[:,0].astype(int),0,W-1); yi=np.clip(q[:,1].astype(int),0,H-1)
        inb=(q[:,0]>=0)&(q[:,0]<W)&(q[:,1]>=0)&(q[:,1]<H)
        vis=inb&(zq>=zb[yi,xi]-0.02)&pm[yi,xi]
        cosv=nor@R[:,2]
        w=np.where(vis,np.clip(cosv,0,1)**power,0)
        # bilinear sample
        fx=np.clip(q[:,0]-0.5,0,W-1.001); fy=np.clip(q[:,1]-0.5,0,H-1.001); x0=fx.astype(int); y0=fy.astype(int); ax=(fx-x0)[:,None]; ay=(fy-y0)[:,None]
        col=(img[y0,x0]*(1-ax)*(1-ay)+img[y0,x0+1]*ax*(1-ay)+img[y0+1,x0]*(1-ax)*ay+img[y0+1,x0+1]*ax*ay)
        acc+=col*w[:,None]; wsum+=w; print(key,'covered',(w>0.05).mean().round(3),flush=True)
    return acc,wsum
def fill_uncovered(pos,acc,wsum,thr=0.02,G=96):
    ok=wsum>thr; col=np.zeros_like(acc); col[ok]=acc[ok]/wsum[ok,None]
    lo=pos.min(0); hi=pos.max(0); idx=((pos-lo)/(hi-lo+1e-9)*(G-1)).astype(int)
    gs=np.zeros((G,G,G,3)); gc=np.zeros((G,G,G))
    np.add.at(gs,tuple(idx[ok].T),col[ok]); np.add.at(gc,tuple(idx[ok].T),1)
    # dilate grid until filled where needed
    for it in range(40):
        empty=gc==0
        if not empty[tuple(idx[~ok].T)].any(): break
        s2=np.zeros_like(gs); c2=np.zeros_like(gc)
        for ax in range(3):
            for sh in (-1,1):
                s2+=np.roll(gs,sh,ax); c2+=np.roll(gc,sh,ax)
        gs=np.where(empty[...,None],s2,gs); gc=np.where(empty,c2,gc)
    fillc=gs[tuple(idx.T)]/np.maximum(gc[tuple(idx.T)],1e-9)[:,None]
    # smooth blend for weakly covered texels
    a=np.clip(wsum/0.15,0,1)[:,None]
    safe=np.where(wsum[:,None]>0,acc/np.maximum(wsum,1e-9)[:,None],0)
    return safe*a+fillc*(1-a)
def assemble(m,col):
    img=np.zeros((T,T,3),np.float32); img[m]=col; mask=m.copy()
    # pad islands
    for it in range(24):
        im=Image.fromarray(np.clip(img,0,255).astype('uint8')); mk=Image.fromarray((mask*255).astype('uint8'))
        di=np.asarray(im.filter(ImageFilter.MaxFilter(3))).astype(np.float32)
        # weighted average of neighbours instead of max: use box blur normalised
        num=np.asarray(Image.fromarray(np.clip(img*mask[...,None],0,255).astype('uint8')).filter(ImageFilter.BoxBlur(1))).astype(np.float32)
        den=np.asarray(mk.filter(ImageFilter.BoxBlur(1))).astype(np.float32)/255
        newm=(den>0)&~mask
        img[newm]=num[newm]/den[newm,None]; mask|=newm
    return Image.fromarray(np.clip(img,0,255).astype('uint8'))
if __name__=='__main__':
    k,sp=sys.argv[1],sys.argv[2]
    d=np.load('cut.npz'); V,F,UVc,Nc=d['V'],d['F'],d['UVc'],d['Nc']
    fit=json.load(open('fit.json'))
    base='/home/user/every-fish-aquarium-preview/projects/goldfish-aquarium/species/'
    views={v:fit[f'{k}_{v}'] for v in ['top','bottom','left','right']}
    photos={v:Image.open(f'{base}{sp}/photos/set-{k}/{v}.jpg') for v in views}
    m,pos,nor=uv_setup(V,F,UVc,Nc); print('texels',m.sum(),flush=True)
    acc,ws=bake(V,F,m,pos,nor,views,photos)
    col=fill_uncovered(pos,acc,ws)
    assemble(m,col).save(f'tex_{k}.jpg',quality=92)
    np.save(f'w_{k}.npy',ws)
