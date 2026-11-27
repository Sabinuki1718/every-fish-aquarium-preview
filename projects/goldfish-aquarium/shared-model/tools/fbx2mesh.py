import sys,json,struct,numpy as np
sys.path.insert(0,'.')
from fbxread import parse,find
def load(path):
    top=parse(path); g={t['name']:t for t in top}
    geo=find(g['Objects'],'Geometry')[0]
    V=find(geo,'Vertices')[0]['props'][0].reshape(-1,3)
    pvi=find(geo,'PolygonVertexIndex')[0]['props'][0].copy()
    pvi[pvi<0]=-pvi[pvi<0]-1
    luv=find(geo,'LayerElementUV')[0]
    UV=find(luv,'UV')[0]['props'][0].reshape(-1,2); UVI=find(luv,'UVIndex')[0]['props'][0]
    N=find(find(geo,'LayerElementNormal')[0],'Normals')[0]['props'][0].reshape(-1,3)
    # corners: position index pvi, uv index UVI, normal per corner
    return V,pvi.reshape(-1,3),UVI.reshape(-1,3),UV,N.reshape(-1,3,3)
def to_glb(P,F,UVc,Nc,tex_bytes,out,unweld=True):
    # P: (V,3) positions; F: (T,3) indices into P; UVc,Nc per-corner (T,3,2),(T,3,3)
    # build unique (pos,uv) vertices
    key={};pos=[];uv=[];nor=[];idx=[]
    for t in range(len(F)):
        for c in range(3):
            k=(int(F[t,c]),round(float(UVc[t,c,0]),6),round(float(UVc[t,c,1]),6))
            i=key.get(k)
            if i is None:
                i=len(pos);key[k]=i;pos.append(P[F[t,c]]);uv.append(UVc[t,c]);nor.append(Nc[t,c])
            idx.append(i)
    pos=np.array(pos,'<f4');uv=np.array(uv,'<f4');uv[:,1]=1-uv[:,1];nor=np.array(nor,'<f4')
    nor/=np.linalg.norm(nor,axis=1,keepdims=True)+1e-9
    idx=np.array(idx,'<u4')
    bufs=[pos.tobytes(),nor.tobytes(),uv.tobytes(),idx.tobytes(),tex_bytes]
    views=[];off=0;blob=b''
    for b in bufs:
        views.append({'buffer':0,'byteOffset':off,'byteLength':len(b)}); pad=(-len(b))%4; blob+=b+b'\0'*pad; off+=len(b)+pad
    views[0]['target']=views[1]['target']=views[2]['target']=34962; views[3]['target']=34963
    doc={'asset':{'version':'2.0','generator':'fbx2mesh'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0,'name':'fish'}],
     'meshes':[{'name':'fish','primitives':[{'attributes':{'POSITION':0,'NORMAL':1,'TEXCOORD_0':2},'indices':3,'material':0}]}],
     'accessors':[{'bufferView':0,'componentType':5126,'count':len(pos),'type':'VEC3','min':pos.min(0).tolist(),'max':pos.max(0).tolist()},
       {'bufferView':1,'componentType':5126,'count':len(pos),'type':'VEC3'},{'bufferView':2,'componentType':5126,'count':len(pos),'type':'VEC2'},
       {'bufferView':3,'componentType':5125,'count':len(idx),'type':'SCALAR'}],
     'bufferViews':views,'buffers':[{'byteLength':len(blob)}],
     'images':[{'bufferView':4,'mimeType':'image/jpeg'}],'textures':[{'source':0,'sampler':0}],'samplers':[{'magFilter':9729,'minFilter':9987}],
     'materials':[{'name':'fish','pbrMetallicRoughness':{'baseColorTexture':{'index':0},'metallicFactor':0,'roughnessFactor':0.6},'doubleSided':True}]}
    j=json.dumps(doc).encode(); j+=b' '*((-len(j))%4)
    glb=struct.pack('<III',0x46546C67,2,12+8+len(j)+8+len(blob))+struct.pack('<II',len(j),0x4E4F534A)+j+struct.pack('<II',len(blob),0x004E4942)+blob
    open(out,'wb').write(glb); return len(pos),len(idx)//3
if __name__=='__main__':
    V,F,UI,UV,N=load(sys.argv[1])
    print(to_glb(V,F,UV[UI],N,open(sys.argv[2],'rb').read(),sys.argv[3]))
