import sys
def lum(h):
    h=h.lstrip('#'); r,g,b=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    f=lambda c: c/12.92 if c<=0.03928 else ((c+0.055)/1.055)**2.4
    return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b)
def cr(a,b):
    la,lb=sorted([lum(a),lum(b)],reverse=True); return (la+0.05)/(lb+0.05)
P=dict(bg='#15191f',panel='#1e242c',soft='#262d37',hover='#303845',
 text='#f2f4f7',dim='#dde2ea',muted='#bfc8d4',placeholder='#a3adba',
 accent='#9fcbec',on_accent='#0f1720',border='#8190a5',focus='#b7d4ea',
 danger='#f0a8a2',success='#8fd1a6',warn='#e0c88c',link='#a9cbe6')
body=4.5; ui=3.0
checks=[]
for fg in ('text','dim','muted','accent','danger','success','warn','link'):
    for bg in ('bg','panel','soft','hover'): checks.append((fg,bg,body))
checks+=[('placeholder','bg',body),('placeholder','soft',body),('on_accent','accent',body)]
for bd in ('border','focus'):
    for bg in ('bg','panel','soft'): checks.append((bd,bg,ui))
fail=0
for fg,bg,t in checks:
    r=cr(P[fg],P[bg]); ok=r>=t; fail+=not ok
    print(f"{'PASS' if ok else 'FAIL'} {fg:11s} on {bg:6s} {r:5.2f}:1 (need {t})")
sys.exit(1 if fail else 0)
