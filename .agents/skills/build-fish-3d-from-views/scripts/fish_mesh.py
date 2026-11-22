"""Local fish-mesh building blocks. No image recognition or species defaults.

Dependencies: numpy, Pillow; scipy is optional for harmonic inpainting.
Coordinates and texture placement are supplied by a fish-specific adapter.
"""
from __future__ import annotations
import argparse
import base64
from dataclasses import dataclass
import io
import json
import math
from pathlib import Path
import struct
import numpy as np
from PIL import Image


def unit(v):
    v=np.asarray(v,dtype=float); n=np.linalg.norm(v)
    if n<1e-12: raise ValueError('Zero direction vector')
    return v/n


def check_atlas_islands(width,height,islands):
    """Validate named, padded pixel rectangles (x0,y0,x1,y1), upper-exclusive.

    Register deliberately shared UVs once. Include reserved source images,
    body islands and swatches, not just the fins. Does not pack or mutate.
    """
    if width<=0 or height<=0:raise ValueError('Invalid atlas dimensions')
    registered=[];names=set()
    for name,rect in islands:
        if name in names:raise ValueError(f'Duplicate atlas island name: {name}')
        r=np.asarray(rect,dtype=float)
        if r.shape!=(4,) or not np.isfinite(r).all():raise ValueError(f'{name}: invalid rectangle')
        x0,y0,x1,y1=r
        if not(0<=x0<x1<=width and 0<=y0<y1<=height):raise ValueError(f'{name}: empty or out-of-bounds island')
        for other,b in registered:
            if x0<b[2] and b[0]<x1 and y0<b[3] and b[1]<y1:
                raise ValueError(f'Overlapping atlas islands: {other} / {name}')
        registered.append((name,r));names.add(name)
    return True


@dataclass
class Mesh:
    name: str
    positions: np.ndarray
    uv: np.ndarray
    faces: np.ndarray
    normals: np.ndarray|None=None

    def __post_init__(self):
        self.positions=np.asarray(self.positions,dtype='<f4').reshape(-1,3)
        self.uv=np.asarray(self.uv,dtype='<f4').reshape(-1,2)
        f=np.asarray(self.faces)
        if f.size==0 or np.min(f)<0: raise ValueError('Empty or negative indices')
        self.faces=f.astype('<u4').reshape(-1,3)
        if self.normals is None:
            self.normals=self.compute_normals()
        else: self.normals=np.asarray(self.normals,dtype='<f4').reshape(-1,3)
        self.check()

    def compute_normals(self):
        p=self.positions; f=self.faces
        if f.max()>=len(p): raise ValueError('Index out of range')
        normals=np.zeros_like(p)
        face=np.cross(p[f[:,1]]-p[f[:,0]],p[f[:,2]]-p[f[:,0]])
        for k in range(3): np.add.at(normals,f[:,k],face)
        # Weld only normals, keeping UV seam vertices separate.
        extent=max(float(np.ptp(p,axis=0).max()),1e-12)
        _,ids=np.unique(np.round((p-p.min(axis=0))/extent,8),axis=0,return_inverse=True)
        grouped=np.zeros((ids.max()+1,3),dtype=float)
        np.add.at(grouped,ids,normals)
        normals=grouped[ids]; lengths=np.linalg.norm(normals,axis=1)
        if np.any(lengths<1e-25): raise ValueError(f'{self.name}: zero normal / unused vertex')
        return (normals/lengths[:,None]).astype('<f4')

    def check(self):
        p=self.positions;f=self.faces
        if len(p)!=len(self.uv) or len(p)!=len(self.normals): raise ValueError('Attribute counts differ')
        if not all(np.isfinite(a).all() for a in [p,self.uv,self.normals]): raise ValueError('Nonfinite attribute')
        if f.max()>=len(p): raise ValueError('Index out of range')
        if not np.allclose(np.linalg.norm(self.normals,axis=1),1,atol=2e-4): raise ValueError('Nonunit normals')
        area=np.linalg.norm(np.cross(p[f[:,1]]-p[f[:,0]],p[f[:,2]]-p[f[:,0]]),axis=1)
        threshold=max(float(np.ptp(p,axis=0).max())**2*1e-13,1e-24)
        if np.any(area<threshold): raise ValueError(f'{self.name}: degenerate triangle')
        if np.min(self.uv)<0 or np.max(self.uv)>1: raise ValueError('Atlas UV must be in [0,1]')
        return self

    def check_closed(self):
        p=self.positions;extent=max(float(np.ptp(p,axis=0).max()),1e-12)
        _,ids=np.unique(np.round((p-p.min(axis=0))/extent,8),axis=0,return_inverse=True)
        f=ids[self.faces]
        edges=np.sort(np.concatenate([f[:,[0,1]],f[:,[1,2]],f[:,[2,0]]]),axis=1)
        _,counts=np.unique(edges,axis=0,return_counts=True)
        if not np.all(counts==2): raise ValueError(f'{self.name}: open/nonmanifold edges')
        return self


def orient_closed(positions,faces):
    p=np.asarray(positions);f=np.asarray(faces,dtype=int)
    volume=np.einsum('ij,ij->i',p[f[:,0]],np.cross(p[f[:,1]],p[f[:,2]])).sum()
    return f[:,::-1] if volume<0 else f


def _rings(name,rings,uv_fn,cap_uv):
    rings=np.asarray(rings,dtype=float);nr,nt,_=rings.shape
    if nr<2 or nt<3: raise ValueError('Not enough rings/segments')
    p=rings.reshape(-1,3).tolist();uv=[];faces=[]
    for j in range(nr):
        for k in range(nt): uv.append(uv_fn(j/(nr-1),2*math.pi*k/(nt-1)))
    for j in range(nr-1):
        for k in range(nt-1):
            a=j*nt+k;b=a+nt;faces.extend([[a,a+1,b],[a+1,b+1,b]])
    for j in [0,nr-1]:
        # Ring includes a duplicated UV-seam vertex, not duplicated poles.
        center=len(p);p.append(rings[j,:-1].mean(axis=0).tolist())
        uv.append(cap_uv if cap_uv is not None else uv_fn(j/(nr-1),0))
        for k in range(nt-1):
            f=[center,j*nt+k,j*nt+k+1]
            faces.append(f[::-1] if j==0 else f)
    return Mesh(name,p,uv,orient_closed(p,faces))


def loft(name,sections,uv_fn=lambda s,t:(s,t/(2*math.pi)),segments=64,power=2,cap_uv=None):
    """sections: [x, center_y, center_z, up, down, left, right].

    Supply interpolated, fish-specific sections. Radii must be positive.
    power=2 gives elliptical cross-sections; no species profile is assumed.
    Caps use a constant UV; sculpted snouts may need custom cap geometry.
    """
    q=np.asarray(sections,dtype=float)
    if q.ndim!=2 or q.shape[1]!=7 or np.any(q[:,3:]<=0) or power<=0: raise ValueError('Invalid sections')
    if np.any(np.diff(q[:,0])<=0): raise ValueError('Loft x coordinates must increase; use sweep for curved axes')
    t=np.linspace(0,2*math.pi,segments+1);c=np.cos(t);s=np.sin(t)
    cy=np.sign(c)*np.abs(c)**(2/power);sz=np.sign(s)*np.abs(s)**(2/power)
    rings=[]
    for x,y,z,up,down,left,right in q:
        rings.append(np.column_stack([np.full_like(t,x),y+cy*np.where(c>=0,up,down),z+sz*np.where(s>=0,right,left)]))
    return _rings(name,rings,uv_fn,cap_uv)


def sweep(name,centers,radius_a,radius_b,uv_fn=lambda s,t:(s,t/(2*math.pi)),segments=48,up_hint=(0,1,0),cap_uv=None):
    """Parallel-transport-like frames along an arbitrary 3D centerline."""
    centers=np.asarray(centers,dtype=float)
    if len(centers)<2 or np.any(np.linalg.norm(np.diff(centers,axis=0),axis=1)<1e-12): raise ValueError('Repeated/short centerline')
    ra=np.broadcast_to(radius_a,(len(centers),));rb=np.broadcast_to(radius_b,(len(centers),))
    if np.any(ra<=0) or np.any(rb<=0): raise ValueError('Positive sweep radii required')
    tangent=np.gradient(centers,axis=0);tangent=np.array([unit(v) for v in tangent])
    previous=unit(up_hint);rings=[];theta=np.linspace(0,2*math.pi,segments+1)
    for j,axis in enumerate(tangent):
        a=previous-axis*np.dot(previous,axis)
        if np.linalg.norm(a)<1e-8:
            candidate=np.eye(3)[np.argmin(np.abs(axis))];a=candidate-axis*np.dot(candidate,axis)
        a=unit(a);b=unit(np.cross(axis,a));previous=a
        rings.append(centers[j]+np.cos(theta)[:,None]*ra[j]*a+np.sin(theta)[:,None]*rb[j]*b)
    return _rings(name,rings,uv_fn,cap_uv)


def triangulate(poly):
    p=np.asarray(poly,dtype=float);ids=list(range(len(p)));faces=[]
    if len(p)<3: raise ValueError('Polygon too short')
    def cross(a,b,c):
        u=p[b]-p[a];v=p[c]-p[a];return u[0]*v[1]-u[1]*v[0]
    area=sum(p[i,0]*p[(i+1)%len(p),1]-p[(i+1)%len(p),0]*p[i,1] for i in ids)
    if area<0:ids.reverse()
    eps=max(float(np.ptp(p,axis=0).max())**2*1e-12,1e-20)
    while len(ids)>3:
        for k,b in enumerate(ids):
            a=ids[k-1];c=ids[(k+1)%len(ids)]
            if cross(a,b,c)<=eps:continue
            if any(min(cross(a,b,q),cross(b,c,q),cross(c,a,q))>=-eps for q in ids if q not in [a,b,c]):continue
            faces.append([a,b,c]);ids.pop(k);break
        else:raise ValueError('Self-intersecting polygon or repeated/collinear outline vertices')
    faces.append(ids);return faces


def fin(name,outline,point_fn,uv_fn,subdivisions=2):
    """point_fn(u,v,layer) returns a 3D point for layer=-1/+1.

    The adapter controls thickness, orientation, camber, and root embedding.
    UVs describe an atlas island, not necessarily the source-image position.
    """
    pts=[tuple(v) for v in outline];faces=triangulate(pts)
    for _ in range(subdivisions):
        cache={};out=[]
        def mid(a,b):
            key=tuple(sorted((a,b)))
            if key not in cache:
                cache[key]=len(pts);pts.append(tuple((np.array(pts[a])+pts[b])/2))
            return cache[key]
        for a,b,c in faces:
            ab=mid(a,b);bc=mid(b,c);ca=mid(c,a)
            out.extend([[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]])
        faces=out
    p=[];uv=[];n=len(pts)
    for layer in [-1,1]:
        for u,v in pts:p.append(point_fn(u,v,layer));uv.append(uv_fn(u,v))
    out=[list(f) for f in faces]+[[i+n for i in f[::-1]] for f in faces]
    edges={}
    for f in faces:
        for a,b in zip(f,f[1:]+f[:1]):
            key=tuple(sorted((a,b)))
            if key in edges:edges[key]=None
            else:edges[key]=(a,b)
    for edge in edges.values():
        if edge is not None:
            a,b=edge;out.extend([[b,a,a+n],[b,a+n,b+n]])
    return Mesh(name,p,uv,orient_closed(p,out))


def closed_lips(name,center,forward,right,up,half_width,upper_height,lower_height,front_depth,back_depth,corner_back,seam_thickness,upper_uv,lower_uv,line_uv,nz=32,na=24):
    """Closed broad lips in a fish-specific local frame; returns three solids.

    Contact-line coordinates match exactly. Set back_depth to embed roots in
    the snout. This helper is optional, not appropriate for every mouth type.
    """
    center=np.asarray(center);fw=unit(forward);rt=unit(right);up=unit(up)
    if max(abs(np.dot(a,b)) for a,b in [(fw,rt),(fw,up),(rt,up)])>1e-5:raise ValueError('Mouth axes must be orthogonal')
    if min(half_width,upper_height,lower_height,front_depth,back_depth,seam_thickness)<=0:raise ValueError('Positive mouth dimensions required')
    meshes=[]
    for kind,uv in [('upper',upper_uv),('lower',lower_uv),('line',line_uv)]:
        def point(z,s,t):
            f=z/half_width;depth=-corner_back*(.6*f*f+.4*abs(f)**10);y=0.
            if kind in ['upper','lower']:
                h=upper_height if kind=='upper' else lower_height
                y=(1 if kind=='upper' else -1)*h*.5*s*(1-math.cos(t))
                depth+=(front_depth if math.sin(t)>=0 else back_depth)*s*math.sin(t)
            else:
                y=seam_thickness*.5*s*math.cos(t)
                depth+=seam_thickness*.5*s*(1+math.sin(t))
            return center+rt*z+up*y+fw*depth
        p=[point(-half_width,0,0)];tex=[uv];faces=[]
        for j in range(1,nz):
            a=math.pi*j/nz
            for k in range(na):p.append(point(-half_width*math.cos(a),math.sin(a),2*math.pi*k/na));tex.append(uv)
        end=len(p);p.append(point(half_width,0,0));tex.append(uv)
        for k in range(na):faces.append([0,1+(k+1)%na,1+k])
        for j in range(nz-2):
            for k in range(na):
                a=1+j*na+k;an=1+j*na+(k+1)%na;b=a+na;bn=an+na
                faces.extend([[a,an,b],[an,bn,b]])
        last=1+(nz-2)*na
        for k in range(na):faces.append([end,last+k,last+(k+1)%na])
        meshes.append(Mesh(name+'_'+kind,p,tex,orient_closed(p,faces)))
    return meshes


def scale_to_length(meshes,length_m,axis=0):
    if length_m<=0: raise ValueError('Positive length required')
    p=np.concatenate([m.positions for m in meshes]);extent=np.ptp(p,axis=0)[axis]
    if extent<=0:raise ValueError('Zero model length')
    center=(p.min(axis=0)+p.max(axis=0))/2;s=length_m/extent
    return [Mesh(m.name,(m.positions-center)*s,m.uv,m.faces,m.normals) for m in meshes]


def sample_bilinear(image,x,y):
    a=np.asarray(image);x=np.clip(x,0,a.shape[1]-1);y=np.clip(y,0,a.shape[0]-1)
    ix=np.asarray(x).astype(int);iy=np.asarray(y).astype(int);fx=np.asarray(x-ix)[...,None];fy=np.asarray(y-iy)[...,None]
    nx=np.minimum(ix+1,a.shape[1]-1);ny=np.minimum(iy+1,a.shape[0]-1)
    return (a[iy,ix]*(1-fx)+a[iy,nx]*fx)*(1-fy)+(a[ny,ix]*(1-fx)+a[ny,nx]*fx)*fy


def dilate_mask(mask,pixels=1):
    result=np.asarray(mask,dtype=bool).copy()
    for _ in range(pixels):
        p=np.pad(result,1);result=p[1:-1,1:-1]|p[:-2,1:-1]|p[2:,1:-1]|p[1:-1,:-2]|p[1:-1,2:]
    return result


def inpaint_region(image,mask):
    """Harmonic fill of an explicitly selected interior region.

    Reconstruct sharp pattern boundaries separately when needed. Does not
    choose which anatomical marks to remove. Mask must not touch image edges.
    """
    a=np.asarray(image).astype(float).copy();mask=np.asarray(mask,dtype=bool)
    if mask.shape!=a.shape[:2]:raise ValueError('Mask shape mismatch')
    if not mask.any():return a.astype(np.uint8)
    if mask[0].any() or mask[-1].any() or mask[:,0].any() or mask[:,-1].any():raise ValueError('Mask touches image edge')
    y,x=np.where(mask);y0,y1=y.min()-1,y.max()+2;x0,x1=x.min()-1,x.max()+2
    crop=a[y0:y1,x0:x1];m=mask[y0:y1,x0:x1]
    try:
        from scipy import sparse
        from scipy.sparse.linalg import spsolve
        yy,xx=np.where(m);ids=np.full(m.shape,-1);ids[yy,xx]=np.arange(len(xx))
        rows=[];cols=[];values=[];rhs=np.zeros((len(xx),a.shape[2]))
        for i,(j,k) in enumerate(zip(yy,xx)):
            rows.append(i);cols.append(i);values.append(4.)
            for dy,dx in [(0,1),(0,-1),(1,0),(-1,0)]:
                q=ids[j+dy,k+dx]
                if q>=0:rows.append(i);cols.append(q);values.append(-1.)
                else:rhs[i]+=crop[j+dy,k+dx]
        crop[yy,xx]=spsolve(sparse.csr_matrix((values,(rows,cols)),shape=(len(xx),len(xx))),rhs)
    except ImportError:
        crop[m]=crop[~m].mean(axis=0)
        for _ in range(2500):
            avg=(crop[:-2,1:-1]+crop[2:,1:-1]+crop[1:-1,:-2]+crop[1:-1,2:])/4
            target=crop[1:-1,1:-1];inside=m[1:-1,1:-1]
            delta=np.max(np.abs(target[inside]-avg[inside]));target[inside]=avg[inside]
            if delta<.02:break
    return np.clip(a,0,255).astype(np.uint8)


def bleed_edges(image,valid,pixels=8):
    """Extend island colors into padding; valid is an explicit foreground mask.

    No white/color threshold: real white body areas and eye highlights survive.
    """
    a=np.asarray(image).astype(float).copy();known=np.asarray(valid,dtype=bool).copy()
    if known.shape!=a.shape[:2] or not known.any():raise ValueError('Invalid foreground mask')
    for _ in range(pixels):
        kp=np.pad(known,1);ap=np.pad(a,((1,1),(1,1),(0,0)))
        count=np.zeros(known.shape);total=np.zeros_like(a)
        for dy,dx in [(-1,0),(1,0),(0,-1),(0,1)]:
            k=kp[1+dy:1+dy+len(a),1+dx:1+dx+a.shape[1]]
            total+=ap[1+dy:1+dy+len(a),1+dx:1+dx+a.shape[1]]*k[:,:,None];count+=k
        frontier=(~known)&(count>0)
        a[frontier]=total[frontier]/count[frontier,None];known|=frontier
    return np.clip(a,0,255).astype(np.uint8)


def export_glb(meshes,texture,path,metadata=None,alpha_mode='OPAQUE'):
    """Single-atlas glTF 2.0 with embedded PNG, meter coordinates, Y-up."""
    if not meshes or alpha_mode not in ['OPAQUE','MASK']:raise ValueError('Meshes and supported alpha mode required')
    blob=bytearray();views=[];access=[];gm=[]
    def view(raw,target=None):
        blob.extend(b'\0'*((-len(blob))%4));off=len(blob);blob.extend(raw)
        v={'buffer':0,'byteOffset':off,'byteLength':len(raw)}
        if target is not None:v['target']=target
        views.append(v);return len(views)-1
    def acc(a,kind,component,target):
        a=np.ascontiguousarray(a);v=view(a.tobytes(),target)
        d={'bufferView':v,'componentType':component,'count':len(a),'type':kind}
        if kind=='VEC3':d.update(min=a.min(axis=0).tolist(),max=a.max(axis=0).tolist())
        access.append(d);return len(access)-1
    for m in meshes:
        m.check();attrs={k:acc(a,kind,5126,34962) for k,a,kind in [('POSITION',m.positions,'VEC3'),('NORMAL',m.normals,'VEC3'),('TEXCOORD_0',m.uv,'VEC2')]}
        gm.append({'name':m.name,'primitives':[{'attributes':attrs,'indices':acc(m.faces.ravel(),'SCALAR',5125,34963),'material':0}]})
    im=Image.fromarray(np.asarray(texture,dtype=np.uint8)) if not isinstance(texture,Image.Image) else texture
    png=io.BytesIO();im.convert('RGBA').save(png,format='PNG');iv=view(png.getvalue())
    material={'name':'Baked_atlas','pbrMetallicRoughness':{'baseColorTexture':{'index':0},'metallicFactor':0,'roughnessFactor':.72},'doubleSided':True,'alphaMode':alpha_mode}
    if alpha_mode=='MASK':material['alphaCutoff']=.5
    doc={'asset':{'version':'2.0','generator':'Local fish mesh toolkit'},'scene':0,'scenes':[{'nodes':[0]}],
         'nodes':[{'name':'Fish_root','children':list(range(1,len(meshes)+1)),'extras':metadata or {'units':'meters','up':'+Y'}}]+[{'name':m.name,'mesh':i} for i,m in enumerate(meshes)],
         'meshes':gm,'materials':[material],'textures':[{'source':0,'sampler':0}],
         'samplers':[{'magFilter':9729,'minFilter':9987,'wrapS':33071,'wrapT':33071}],
         'images':[{'bufferView':iv,'mimeType':'image/png'}],'buffers':[{'byteLength':len(blob)}],'bufferViews':views,'accessors':access}
    js=json.dumps(doc,separators=(',',':')).encode();js+=b' '*((-len(js))%4);blob+=b'\0'*((-len(blob))%4)
    raw=struct.pack('<III',0x46546c67,2,28+len(js)+len(blob))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(blob),0x004e4942)+blob
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)


def read_glb(path):
    """Read the uncompressed single-buffer, single-atlas format written above."""
    raw=Path(path).read_bytes()
    if len(raw)<28 or struct.unpack_from('<III',raw)!=(0x46546c67,2,len(raw)):raise ValueError('Invalid GLB header')
    jl,jt=struct.unpack_from('<II',raw,12);off=20+jl
    if jt!=0x4e4f534a or off+8>len(raw):raise ValueError('Invalid JSON chunk')
    doc=json.loads(raw[20:off]);bl,bt=struct.unpack_from('<II',raw,off);binary=raw[off+8:]
    if bt!=0x004e4942 or bl!=len(binary):raise ValueError('Invalid BIN chunk')
    if doc.get('extensionsRequired') or len(doc['buffers'])!=1 or len(doc['images'])!=1 or len(doc['materials'])!=1 or len(doc['textures'])!=1:raise ValueError('Unsupported layout/extension; use an appropriate glTF reader')
    if any(any(key in n for key in ['matrix','translation','rotation','scale']) for n in doc.get('nodes',[])):raise ValueError('Node transforms are not supported by this local verification reader')
    if doc['buffers'][0].get('uri') or doc['buffers'][0]['byteLength']>len(binary):raise ValueError('External/invalid buffer')
    for v in doc['bufferViews']:
        if v.get('buffer',0)!=0 or v.get('byteOffset',0)<0 or v['byteLength']<0 or v.get('byteOffset',0)+v['byteLength']>len(binary):raise ValueError('BufferView out of range')
    def array(i):
        a=doc['accessors'][i];v=doc['bufferViews'][a['bufferView']]
        if 'sparse' in a or 'byteStride' in v or a.get('normalized'):raise ValueError('Unsupported accessor encoding')
        dtype={5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1'}[a['componentType']]
        n={'SCALAR':1,'VEC2':2,'VEC3':3}[a['type']];count=a['count']*n;start=a.get('byteOffset',0)
        if count<=0 or start<0 or start+np.dtype(dtype).itemsize*count>v['byteLength']:raise ValueError('Accessor out of range')
        return np.frombuffer(binary,dtype=dtype,count=count,offset=v.get('byteOffset',0)+start).reshape(-1,n)
    meshes=[]
    for m in doc['meshes']:
        for i,p in enumerate(m['primitives']):
            if p.get('mode',4)!=4:raise ValueError('Only triangle primitives supported')
            a=p['attributes'];meshes.append(Mesh(m.get('name','mesh')+(':'+str(i) if i else ''),array(a['POSITION']),array(a['TEXCOORD_0']),array(p['indices']),array(a['NORMAL'])))
    image=doc['images'][0]
    if 'uri' in image or image.get('mimeType')!='image/png':raise ValueError('Embedded PNG required')
    v=doc['bufferViews'][image['bufferView']];start=v.get('byteOffset',0)
    im=Image.open(io.BytesIO(binary[start:start+v['byteLength']])).convert('RGBA');im.load()
    return meshes,im,doc


def write_preview(meshes,texture,path,title='Fish model',glb_filename='model.glb',description=''):
    asset=Path(__file__).resolve().parent.parent/'assets/preview.html'
    im=Image.fromarray(np.asarray(texture,dtype=np.uint8)) if not isinstance(texture,Image.Image) else texture
    png=io.BytesIO();im.convert('RGBA').save(png,format='PNG')
    payload={'title':title,'description':description,'glb':glb_filename,'image':'data:image/png;base64,'+base64.b64encode(png.getvalue()).decode(),
             'parts':[{'name':m.name,'p':m.positions.ravel().tolist(),'n':m.normals.ravel().tolist(),'uv':m.uv.ravel().tolist(),'i':m.faces.ravel().tolist()} for m in meshes]}
    text=json.dumps(payload,separators=(',',':')).replace('<','\\u003c')
    out=Path(path);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(asset.read_text(encoding='utf8').replace('__PAYLOAD__',text),encoding='utf8')


def uv_collapse_report(meshes, texture_size):
    """Report faces whose UVs occupy a point or nearly a line, in texel space."""
    report = []
    for mesh in meshes:
        uv = mesh.uv[mesh.faces].astype(float) * np.asarray(texture_size, dtype=float)
        a = uv[:, 1] - uv[:, 0]
        b = uv[:, 2] - uv[:, 0]
        c = uv[:, 2] - uv[:, 1]
        longest_sq = np.maximum.reduce([(edge * edge).sum(axis=1) for edge in (a, b, c)])
        twice_area = np.abs(a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0])
        point = longest_sq == 0
        line = ~point & (twice_area <= 1e-5 * longest_sq)
        if not (point | line).any():
            continue
        result = {'mesh': mesh.name}
        for kind, mask in [('line', line), ('point', point)]:
            ids = np.flatnonzero(mask)
            if not len(ids):
                continue
            positions = mesh.positions[mesh.faces[ids]].reshape(-1, 3)
            result[kind] = {
                'count': len(ids),
                'bounds': [positions.min(axis=0).tolist(), positions.max(axis=0).tolist()],
                'example_faces': ids[:8].tolist(),
            }
        report.append(result)
    return report


def render(meshes,texture,path,yaw=.6,pitch=.15,target=None,radius=None,width=960,height=640,*,unlit=False):
    """Offline geometry/UV verification image, not a full PBR reference render."""
    tex=np.array(texture.convert('RGBA') if isinstance(texture,Image.Image) else Image.fromarray(np.asarray(texture,dtype=np.uint8)).convert('RGBA'))
    allp=np.concatenate([m.positions for m in meshes]);center=(allp.min(axis=0)+allp.max(axis=0))/2
    target=np.asarray(target if target is not None else center)
    if radius is None:radius=np.linalg.norm(allp-target,axis=1).max()
    if radius<=0:raise ValueError('Positive view radius required')
    cy,sy=math.cos(yaw),math.sin(yaw);cp,sp=math.cos(pitch),math.sin(pitch)
    rotation=np.array([[cy,0,sy],[sp*sy,cp,-sp*cy],[-cp*sy,sp,cp*cy]])
    rgb=np.full((height,width,3),[237,242,244],dtype=np.uint8);depth=np.full((height,width),-np.inf)
    scale=.43*min(width,height)/radius;light=unit([-.35,.65,1])
    for m in meshes:
        p=(m.positions-target)@rotation.T;normal=m.normals@rotation.T
        proj=np.column_stack([width/2+p[:,0]*scale,height/2-p[:,1]*scale])
        for f in m.faces:
            a,b,c=proj[f];lo=np.maximum(np.floor(np.min([a,b,c],axis=0)).astype(int),[0,0]);hi=np.minimum(np.ceil(np.max([a,b,c],axis=0)).astype(int),[width-1,height-1])
            if np.any(hi<lo):continue
            den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
            if abs(den)<1e-8:continue
            xx,yy=np.meshgrid(np.arange(lo[0],hi[0]+1)+.5,np.arange(lo[1],hi[1]+1)+.5)
            u=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den
            v=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den;w=1-u-v
            z=u*p[f[0],2]+v*p[f[1],2]+w*p[f[2],2]
            dst=depth[lo[1]:hi[1]+1,lo[0]:hi[0]+1];mask=(u>=0)&(v>=0)&(w>=0)&(z>dst)
            if not mask.any():continue
            weights=np.array([u[mask],v[mask],w[mask]]).T;uv=weights@m.uv[f]
            sample=sample_bilinear(tex,uv[:,0]*tex.shape[1]-.5,uv[:,1]*tex.shape[0]-.5)
            color=sample[:,:3]
            if not unlit:
                n=weights@normal[f];n/=np.maximum(np.linalg.norm(n,axis=1)[:,None],1e-12)
                color=color*(.78+.22*np.abs(n@light))[:,None]
            visible=sample[:,3]>=127.5
            indices=np.where(mask);ids=(indices[0][visible],indices[1][visible])
            dst[ids]=z[mask][visible];rgb[lo[1]:hi[1]+1,lo[0]:hi[0]+1][ids]=np.clip(color[visible],0,255).astype(np.uint8)
    Path(path).parent.mkdir(parents=True,exist_ok=True);Image.fromarray(rgb).save(path)


def main():
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='command',required=True)
    v=sub.add_parser('validate');v.add_argument('glb')
    uv=sub.add_parser('check-uv', help='report UV triangles collapsed to a point or nearly a line')
    uv.add_argument('glb')
    r=sub.add_parser('render');r.add_argument('glb');r.add_argument('--out',required=True);r.add_argument('--yaw',type=float,default=.6);r.add_argument('--pitch',type=float,default=.15)
    r.add_argument('--target',type=float,nargs=3);r.add_argument('--radius',type=float)
    r.add_argument('--unlit',action='store_true',help='display the texture without normal-based shading')
    args=p.parse_args();meshes,texture,doc=read_glb(args.glb)
    if args.command=='validate':
        print(json.dumps({'meshes':len(meshes),'vertices':sum(len(m.positions) for m in meshes),'triangles':sum(len(m.faces) for m in meshes),'embedded_png':texture.size}))
    elif args.command=='check-uv':
        print(json.dumps({'uv_collapse': uv_collapse_report(meshes, texture.size)}))
    else:render(meshes,texture,args.out,args.yaw,args.pitch,args.target,args.radius,unlit=args.unlit)


if __name__=='__main__':main()
