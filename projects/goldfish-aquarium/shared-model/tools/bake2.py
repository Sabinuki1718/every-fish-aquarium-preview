import sys,json,os,numpy as np
sys.path.insert(0,'.')
from bake import bake, fill_uncovered, assemble, T
from proj import rot
from PIL import Image
k,sp=sys.argv[1],sys.argv[2]
d=np.load('cut.npz'); V,F=d['V'],d['F']
t=np.load('texels.npz'); m,pos,nor=t['m'],t['pos'],t['nor']
fit=json.load(open('fit.json')); E=json.load(open('eyes.json'))
base=f'/home/user/every-fish-aquarium-preview/projects/goldfish-aquarium/species/{sp}/photos/set-{k}/'
views={v:fit[f'{k}_{v}'] for v in ['top','bottom','left','right']}
photos={v:Image.open(f'noeye_{k}_{v}.png') if os.path.exists(f'noeye_{k}_{v}.png') else Image.open(base+v+'.jpg') for v in views}
acc,ws=bake(V,F,m,pos,nor,views,photos)
col=fill_uncovered(pos,acc,ws)
# eye paste
EYE={'left':np.array([-0.094,0.928,-0.008]),'right':np.array([0.093,0.926,-0.003])}
for v,Ec in EYE.items():
    sc,yw,pt,mir,s,tx,ty=views[v]; R=rot(yw,pt)
    def prj(X):
        P=X@R
        if mir: P[:,0]*=-1
        return np.stack([s*P[:,0]+tx,-s*P[:,1]+ty],1)
    ex,ey,er=E[f'{k}_{v}'][0]
    shift=np.array([ex,ey])-prj(Ec[None])[0]
    sel=(np.linalg.norm(pos-Ec,axis=1)<0.06)&((nor@R[:,2])>0.15)
    q=prj(pos[sel])+shift
    img=np.asarray(Image.open(base+v+'.jpg').convert('RGB')).astype(float)
    xi=np.clip(q[:,0].round().astype(int),0,img.shape[1]-1); yi=np.clip(q[:,1].round().astype(int),0,img.shape[0]-1)
    dist=np.hypot(q[:,0]-ex,q[:,1]-ey); w=np.clip((1.15*er-dist)/(0.3*er),0,1)[:,None]
    col[sel]=col[sel]*(1-w)+img[yi,xi]*w
    print(v,'eye shift px',shift.round(1),'texels',(w>0).sum())
assemble(m,col).save(f'tex_{k}_v2.jpg',quality=92)
