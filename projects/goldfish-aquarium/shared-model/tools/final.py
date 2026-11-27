import sys;sys.path.insert(0,'.')
from fbx2mesh import to_glb
import numpy as np
d=np.load('cut.npz'); V,F,UVc,Nc=d['V'],d['F'],d['UVc'],d['Nc']
M=np.array([[0,-1,0],[0,0,1],[-1,0,0]],float)
V2=V@M.T; V2-= (V2.max(0)+V2.min(0))/2; L=V2[:,0].max()-V2[:,0].min(); V2*=0.12/L
N2=Nc@M.T
out='/home/user/every-fish-aquarium-preview/projects/goldfish-aquarium/species/'
for tex,sp in [('tex_BWA.jpg','carassius-auratus-azumanishiki'),('tex2k.jpg','carassius-auratus-seibun'),('tex_tensei.jpg','carassius-auratus-oranda-yellowhood-blue')]:
    import os; os.makedirs(out+sp+'/model/v1',exist_ok=True)
    print(sp,to_glb(V2,F,UVc,N2,open(tex,'rb').read(),out+sp+'/model/v1/fish.glb'), V2.max(0)-V2.min(0))
