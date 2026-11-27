import numpy as np
def components(V,F):
    p=np.arange(len(V))
    def f(x):
        while p[x]!=x: p[x]=p[p[x]];x=p[x]
        return x
    for a,b,c in F:
        for u,v in ((a,b),(b,c)): p[f(u)]=f(v)
    r=np.array([f(i) for i in range(len(V))]); return r
