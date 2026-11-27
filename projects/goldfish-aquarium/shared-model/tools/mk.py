import sys;sys.path.insert(0,'.')
from fbx2mesh import to_glb
import numpy as np
d=np.load('cut.npz'); print(to_glb(d['V'],d['F'],d['UVc'],d['Nc'],open(sys.argv[1],'rb').read(),sys.argv[2]))
