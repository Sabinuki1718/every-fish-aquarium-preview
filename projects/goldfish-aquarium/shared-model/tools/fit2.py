import sys,json,numpy as np
sys.path.insert(0,'.')
from proj import *
from PIL import Image
d=np.load('cut.npz'); V,F=d['V'],d['F']
base='/home/user/every-fish-aquarium-preview/projects/goldfish-aquarium/species/'
res=json.load(open('fit.json'))
for k,sp,v in [('tensei','carassius-auratus-oranda-yellowhood-blue','top'),('tensei','carassius-auratus-oranda-yellowhood-blue','bottom'),('tensei','carassius-auratus-oranda-yellowhood-blue','right')]:
    pm=photo_mask(Image.open(f'{base}{sp}/photos/set-{k}/{v}.jpg'))
    yaws={'top':range(-20,21,5),'bottom':range(160,201,5),'right':range(60,101,5)}[v]
    b=search(V,F,pm,yaws,range(-30,1,5),mirrors=(0,))
    b=refine(V,F,pm,b); res[f'{k}_{v}']=[float(x) for x in b]; print(k,v,np.round(b,3))
json.dump(res,open('fit.json','w'),indent=1)
