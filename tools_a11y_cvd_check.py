import itertools, math
M={'deut':[[0.367322,0.860646,-0.227968],[0.280085,0.672501,0.047413],[-0.011820,0.042940,0.968881]],
   'prot':[[0.152286,1.052583,-0.204868],[0.114503,0.786281,0.099216],[-0.003882,-0.048116,1.051998]],
   'trit':[[1.255528,-0.076749,-0.178779],[-0.078411,0.930809,0.147602],[0.004733,0.691367,0.303900]],
   'none':[[1,0,0],[0,1,0],[0,0,1]]}
def lin(c): c/=255; return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
def rgb(h): h=h.lstrip('#'); return [int(h[i:i+2],16) for i in (0,2,4)]
def sim(h,m):
    l=[lin(x) for x in rgb(h)]; return [max(0,min(1,sum(m[i][j]*l[j] for j in range(3)))) for i in range(3)]
def lab(l):
    X=0.4124*l[0]+0.3576*l[1]+0.1805*l[2]; Y=0.2126*l[0]+0.7152*l[1]+0.0722*l[2]; Z=0.0193*l[0]+0.1192*l[1]+0.9505*l[2]
    f=lambda t: t**(1/3) if t>0.008856 else 7.787*t+16/116
    fx,fy,fz=f(X/0.95047),f(Y),f(Z/1.08883); return (116*fy-16,500*(fx-fy),200*(fy-fz))
def de(a,b): return math.dist(lab(a),lab(b))
def run(P,names,need=30):
    bad=0
    for k,m in M.items():
        for a,b in itertools.combinations(names,2):
            d=de(sim(P[a],m[:] if False else M[k]),sim(P[b],M[k])); ok=d>=need; bad+=not ok
            if not ok: print(f"LOW  {k:4s} {a} vs {b}: dE {d:.0f}")
    return bad
if __name__=='__main__':
    P=dict(danger='#ff9a5c',success='#5ed9c0',warn='#f4e27a',accent='#9fcbec',text='#fafafa')
    print('bad pairs:',run(P,['danger','success','warn']))
    old=dict(danger='#f0a8a2',success='#8fd1a6',warn='#e0c88c')
    print('old bad pairs:',run(old,['danger','success','warn']))
