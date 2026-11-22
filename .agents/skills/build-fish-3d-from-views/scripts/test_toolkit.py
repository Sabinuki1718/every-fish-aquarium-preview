"""Synthetic component tests; not an image-recognition test."""
import argparse
import json
import sys
from pathlib import Path
import shutil
import subprocess
import numpy as np
from PIL import Image,ImageDraw
from fish_mesh import Mesh,loft,sweep,fin,closed_lips,scale_to_length
from fish_mesh import export_glb,read_glb,write_preview,render
from fish_mesh import inpaint_region,bleed_edges,dilate_mask,sample_bilinear
from fish_mesh import check_atlas_islands,uv_collapse_report


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',required=True)
    out=Path(parser.parse_args().out);out.mkdir(parents=True,exist_ok=True)
    assert check_atlas_islands(2048,4096,[('dorsal',(1560,2048,1752,2138)),('wide',(8,3100,550,3296)),('anal',(1560,2146,2003,2329))])
    assert check_atlas_islands(32,32,[('a',(0,0,16,16)),('b',(16,0,32,16))])
    for layout in [
        [('dorsal',(1560,2048,1752,2138)),('anal',(1560,2056,2003,2239))],
        [('outside',(2000,0,2050,30))],
        [('empty',(5,5,5,9))],
        [('bad',(0,0,float('nan'),8))],
        [('same',(0,0,8,8)),('same',(16,0,24,8))],
    ]:
        try:check_atlas_islands(2048,4096,layout)
        except ValueError:pass
        else:raise AssertionError('Invalid atlas layout was accepted')
    yy,xx=np.indices((256,256));atlas=np.zeros((256,256,4),dtype=np.uint8)
    atlas[:,:,0]=40+xx//4;atlas[:,:,1]=90+yy//3;atlas[:,:,2]=210;atlas[:,:,3]=255
    atlas[230:240,10:20,:3]=[15,30,60]
    uv_fn=lambda s,t:(.02+.85*s,.02+.80*t/(2*np.pi))
    x=np.linspace(0,1,31);r=np.sin(np.pi*x)
    teleost=loft('Body_teleost',np.column_stack([x,0*x,0*x,.006+.16*r,.006+.13*r,.004+.055*r,.004+.055*r]),uv_fn,32,cap_uv=(.1,.1))
    eel=sweep('Body_curved_eel',np.column_stack([x,.08*np.sin(2*np.pi*x),.025*np.sin(np.pi*x)]),.008+.02*(1-x),.006+.015*(1-x),uv_fn,32,cap_uv=(.1,.1))
    width=np.maximum(.006,.32*np.sin(np.pi*np.clip(x/.8,0,1)))
    ray=loft('Body_wide_thin',np.column_stack([x,0*x,0*x,.003+.02*r,.003+.013*r,width,width]),uv_fn,32,cap_uv=(.1,.1))
    asymmetric=loft('Body_asymmetric',np.column_stack([x,.025*r,0*x,.006+.12*r,.006+.09*r,.003+.018*r,.003+.04*r]),uv_fn,32,power=2.5,cap_uv=(.1,.1))
    outline=[(.25,0),(.43,.06),(.54,.025),(.40,-.05)]
    fins=[]
    for side,label in [(1,'right'),(-1,'left')]:
        fins.append(fin('Pectoral_'+label,outline,lambda u,v,layer,s=side:(u,v,s*(.045+.3*(u-.25))+.001*layer),lambda u,v:(u,.5+v),2))
    lips=closed_lips('Mouth_closed',center=(-.01,0,0),forward=(-1,0,0),right=(0,0,1),up=(0,1,0),half_width=.02,upper_height=.01,lower_height=.01,front_depth=.004,back_depth=.015,corner_back=.018,seam_thickness=.0004,upper_uv=(.2,.3),lower_uv=(.2,.6),line_uv=(15.5/256,235.5/256),nz=24,na=24)
    contact=np.arange(1,len(lips[0].positions)-1,24)
    assert np.array_equal(lips[0].positions[contact],lips[1].positions[contact])
    for m in [teleost,eel,ray,asymmetric]+fins+lips:m.check_closed()
    assert abs(np.ptp(np.concatenate([m.positions for m in scale_to_length([teleost],.3)]),axis=0)[0]-.3)<1e-6
    cases={'teleost':[teleost]+fins+lips,'curved_eel':[eel],'wide_thin':[ray],'asymmetric':[asymmetric]}
    report={};tiles=[]
    for name,meshes in cases.items():
        file=out/f'{name}.glb';export_glb(meshes,atlas,file)
        loaded,texture,doc=read_glb(file)
        assert len(loaded)==len(meshes) and np.array_equal(np.array(texture),atlas)
        for a,b in zip(meshes,loaded):
            assert a.name==b.name
            for attr in ['positions','normals','uv','faces']:assert np.array_equal(getattr(a,attr),getattr(b,attr))
        preview=out/f'{name}.html';write_preview(meshes,atlas,preview,title=name,glb_filename=file.name)
        text=preview.read_text(encoding='utf8');assert '__PAYLOAD__' not in text and 'https://' not in text
        script=out/f'{name}.js';script.write_text(text.split('<script>')[1].split('</script>')[0],encoding='utf8')
        if shutil.which('node'):subprocess.run([shutil.which('node'),'--check',str(script)],check=True,capture_output=True)
        shot=out/f'{name}.png';render(meshes,atlas,shot,width=640,height=420)
        image=np.array(Image.open(shot));assert np.count_nonzero(np.any(image!=[237,242,244],axis=2))>300
        tile=Image.open(shot).resize((480,315));ImageDraw.Draw(tile).text((10,10),name,fill='#142638');tiles.append(tile)
        report[name]={'meshes':len(meshes),'triangles':sum(len(m.faces) for m in meshes)}
    contact_sheet=Image.new('RGB',(960,630))
    for i,tile in enumerate(tiles):contact_sheet.paste(tile,((i%2)*480,(i//2)*315))
    contact_sheet.save(out/'synthetic_checks.png')
    # The actual loft's end caps collapse into UV lines without a cap mapping.
    cap_sections = [[0, 0, 0, .1, .1, .2, .2], [1, 0, 0, .1, .1, .2, .2]]
    line_caps = loft('Body_with_unmapped_caps', cap_sections, uv_fn, 32)
    nose_report, = uv_collapse_report([line_caps], (256, 256))
    assert nose_report['line']['count'] == 64
    assert nose_report['line']['bounds'][0][0] == 0
    assert nose_report['line']['bounds'][1][0] == 1
    tri = [[0, 1, 2]]
    positions = [[0, 0, 0], [1, 0, 0], [0, 1, 0]]
    remapped = Mesh('Planar_cap', positions, [[.2,.2],[.5,.2],[.2,.5]], tri)
    swatch = Mesh('Solid_swatch', positions, [[.2,.2]] * 3, tri)
    assert uv_collapse_report([remapped], (256, 128)) == []
    assert uv_collapse_report([swatch], (256, 128))[0]['point']['count'] == 1
    tool = Path(__file__).with_name('fish_mesh.py')
    cap_model = out/'line_caps.glb'
    export_glb([line_caps], atlas, cap_model)
    result = subprocess.run([sys.executable, str(tool), 'check-uv', str(cap_model)],
                            check=True, capture_output=True, text=True)
    assert json.loads(result.stdout)['uv_collapse'] == [nose_report]
    unlit = out/'unlit.png'
    render([remapped], np.full((4, 4, 4), [180, 110, 60, 255], dtype=np.uint8),
           unlit, yaw=0, pitch=0, width=64, height=64, unlit=True)
    colors = np.unique(np.array(Image.open(unlit)).reshape(-1, 3), axis=0)
    assert colors.tolist() == [[180, 110, 60], [237, 242, 244]]
    # Inpaint only the selected feature, preserving surrounding pixels.
    image=np.full((30,40,3),[30,90,210],dtype=np.uint8);image[10:20,12:27]=[250,210,30]
    mask=np.zeros((30,40),bool);mask[10:20,12:27]=True
    fixed=inpaint_region(image,mask);assert np.max(np.abs(fixed.astype(int)-[30,90,210]))<=1
    assert np.array_equal(fixed[~mask],image[~mask])
    # The no-SciPy fallback must work without downloading anything.
    previous=sys.modules.get('scipy',None);sys.modules['scipy']=None
    try:assert np.max(np.abs(inpaint_region(image,mask).astype(int)-[30,90,210]))<=1
    finally:
        if previous is None:sys.modules.pop('scipy',None)
        else:sys.modules['scipy']=previous
    rgba=np.zeros((12,12,4),dtype=np.uint8);rgba[4:8,4:8]=255
    valid=np.zeros((12,12),bool);valid[4:8,4:8]=True
    padded=bleed_edges(rgba,valid,3);assert np.array_equal(padded[valid],rgba[valid])
    assert np.all(padded[3,4,:3]==255) # White features are preserved.
    assert dilate_mask(valid,1).sum()>valid.sum()
    assert np.allclose(sample_bilinear(np.array([[[0,0,0],[100,100,100]],[[100,100,100],[200,200,200]]]),np.array([.5]),np.array([.5])),100)
    assert np.allclose(sample_bilinear(np.array([[[10,20,30]]]),np.array([0.]),np.array([0.])),[10,20,30])
    invalid=out/'invalid.glb';invalid.write_bytes((out/'teleost.glb').read_bytes()[:-4])
    try:read_glb(invalid)
    except ValueError:pass
    else:raise AssertionError('Truncated GLB was accepted')
    try:Mesh('invalid',[[0,0,0],[1,0,0],[2,0,0]],[[0,0]]*3,[[0,1,2]])
    except ValueError:pass
    else:raise AssertionError('Degenerate mesh was accepted')
    print('PASS: '+str(report))
    print('PASS: round-trip, PNG embedding, preview JS syntax, renders, closed lips/fins, masks, white preservation, malformed-data rejection')


if __name__=='__main__':main()
