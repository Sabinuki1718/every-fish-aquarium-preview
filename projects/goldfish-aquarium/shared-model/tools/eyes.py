import sys,json,numpy as np
sys.path.insert(0,'.')
from PIL import Image
B='/home/user/every-fish-aquarium-preview/projects/goldfish-aquarium/species/'
P={'BWA':B+'carassius-auratus-azumanishiki/photos/set-BWA/','tensei':B+'carassius-auratus-oranda-yellowhood-blue/photos/set-tensei/'}
guess={'BWA':{'left':[(368,240)],'right':[(398,215)],'bottom':[(512,235)],'top':[]},
       'tensei':{'left':[(372,232)],'right':[(415,215)],'top':[(270,245),(495,255)],'bottom':[(260,270)]}}
def refine(img,g,win=40):
    a=np.asarray(img.convert('L')).astype(float); x0,y0=g
    sub=a[y0-win:y0+win,x0-win:x0+win]; thr=min(70,np.percentile(sub,8))
    ys,xs=np.nonzero(sub<=thr)
    # keep connected-ish: distance to guess
    d=np.hypot(xs-win,ys-win); k=d<win*0.8; xs,ys=xs[k],ys[k]
    cx,cy=xs.mean()+x0-win,ys.mean()+y0-win; r=np.sqrt(len(xs)/np.pi)
    return cx,cy,r
def inpaint(arr,cx,cy,R,iters=600):
    H,W,_=arr.shape; yy,xx=np.mgrid[0:H,0:W]; m=np.hypot(xx-cx,yy-cy)<R
    x0,x1=int(cx-R-2),int(cx+R+3); y0,y1=int(cy-R-2),int(cy+R+3)
    a=arr[y0:y1,x0:x1].copy(); mm=m[y0:y1,x0:x1]
    a[mm]=a[~mm].mean(0)
    for _ in range(iters):
        b=(np.roll(a,1,0)+np.roll(a,-1,0)+np.roll(a,1,1)+np.roll(a,-1,1))/4
        a[mm]=b[mm]
    arr[y0:y1,x0:x1]=a
res={}
for k,p in P.items():
    for v,gs in guess[k].items():
        img=Image.open(p+v+'.jpg').convert('RGB'); arr=np.asarray(img).astype(float).copy()
        res[f'{k}_{v}']=[]
        for g in gs:
            cx,cy,r=refine(img,g); res[f'{k}_{v}'].append([cx,cy,r]); print(k,v,round(cx),round(cy),round(r,1))
            # eye incl. bright ring: inpaint radius ~ r*2.0 (BWA has silver ring)
            inpaint(arr,cx,cy,r*(2.1 if k=='BWA' else 1.6))
        Image.fromarray(np.clip(arr,0,255).astype('uint8')).save(f'noeye_{k}_{v}.png')
json.dump(res,open('eyes.json','w'))
