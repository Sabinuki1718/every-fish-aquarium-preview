import sys,json,numpy as np
sys.path.insert(0,'.')
from proj import *
from PIL import Image
d=np.load('cut.npz'); V,F=d['V'],d['F']
base='/home/user/every-fish-aquarium-preview/projects/goldfish-aquarium/species/'
sets={'BWA':'carassius-auratus-azumanishiki','tensei':'carassius-auratus-oranda-yellowhood-blue','seibun':'carassius-auratus-seibun'}
res={}
for k,sp in sets.items():
    for v in ['top','bottom','left','right']:
        pm=photo_mask(Image.open(f'{base}{sp}/photos/set-{k}/{v}.jpg'))
        if v=='top': yaws=range(-20,21,10)
        elif v=='bottom': yaws=range(160,201,10)
        elif v=='left': yaws=range(-90,1,10)
        else: yaws=range(0,91,10)
        b=search(V,F,pm,yaws,range(-30,31,10))
        b=refine(V,F,pm,b)
        res[f'{k}_{v}']=[float(x) for x in b]; print(k,v,np.round(b,3),flush=True)
json.dump(res,open('fit.json','w'),indent=1)
