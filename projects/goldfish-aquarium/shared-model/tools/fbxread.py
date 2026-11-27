import struct, zlib, numpy as np
def parse(path):
    d=open(path,'rb').read(); ver=struct.unpack_from('<I',d,23)[0]
    big = ver>=7500
    def node(o):
        if big: end,np_,pl=struct.unpack_from('<QQQ',d,o); o+=24
        else: end,np_,pl=struct.unpack_from('<III',d,o); o+=12
        nl=d[o]; o+=1
        if end==0: return None,o
        name=d[o:o+nl].decode(); o+=nl
        props=[]
        for _ in range(np_):
            t=chr(d[o]); o+=1
            if t in 'YCIFDL':
                fmt={'Y':'<h','C':'<?','I':'<i','F':'<f','D':'<d','L':'<q'}[t]
                v=struct.unpack_from(fmt,d,o)[0]; o+=struct.calcsize(fmt); props.append(v)
            elif t in 'fdlib':
                n,enc,cl=struct.unpack_from('<III',d,o); o+=12
                raw=d[o:o+cl]; o+=cl
                if enc: raw=zlib.decompress(raw)
                dt={'f':'<f4','d':'<f8','l':'<i8','i':'<i4','b':'?'}[t]
                props.append(np.frombuffer(raw,dtype=dt).copy())
            elif t in 'SR':
                n=struct.unpack_from('<I',d,o)[0]; o+=4; s=d[o:o+n]; o+=n
                props.append(s.decode('utf-8','replace') if t=='S' else s)
        kids=[]
        while o<end:
            k,o2=node(o)
            if k is None: o=o2; break
            kids.append(k); o=o2
        return {'name':name,'props':props,'kids':kids},end
    o=27; top=[]
    while o<len(d)-200:
        n,o2=node(o)
        if n is None: break
        top.append(n); o=o2
    return top
def find(n,name): return [k for k in n['kids'] if k['name']==name]
def dump(n,ind=0,maxd=4):
    pr=[ (f'arr{p.shape}' if isinstance(p,np.ndarray) else (p if not isinstance(p,(bytes,)) else 'raw')) for p in n['props']][:4]
    print(' '*ind+n['name'],pr)
    if ind//2<maxd:
        for k in n['kids']: dump(k,ind+2,maxd)
