/**
 * The operator (soldier) sculpt: a signed-distance-field sculpt of the body, kit, head and
 * carbine, turned into meshes with surface nets. Pure JS (no three.js): it runs in a worker
 * (sculpt.worker.js), on the main thread, or in Node.
 *
 * Each separable object is polygonised on its own (person, backpack, helmet, gun, magazine,
 * gloves) so that it is a closed shape: take the helmet off and the head is whole underneath.
 *
 * Coordinates: the figure stands at the origin facing +z, 1.8 m tall. The head and the rifle
 * are sculpted in their own frames (P.H, P.R) and placed by the rig.
 */
export const SC = (function(){
"use strict";
// ---------- vector helpers (arrays) ----------
function sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
function add(a,b){return [a[0]+b[0],a[1]+b[1],a[2]+b[2]];}
function mul(a,s){return [a[0]*s,a[1]*s,a[2]*s];}
function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function len(a){return Math.sqrt(dot(a,a));}
function norm(a){var l=len(a)||1;return [a[0]/l,a[1]/l,a[2]/l];}
function lerp(a,b,t){return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];}
function ik(S,H,a,b,pole){var dir=sub(H,S);var d=Math.min(len(dir),a+b-1e-3);dir=norm(dir);
  var c=(a*a+d*d-b*b)/(2*a*d),s=Math.sqrt(Math.max(0,1-c*c));
  var p=norm(sub(pole,mul(dir,dot(pole,dir))));return add(S,add(mul(dir,a*c),mul(p,a*s)));}
// frame: origin + orthonormal axes
function frame(o,x,y,z){return {o:o,x:x,y:y,z:z};}
function frameN(o,n,upHint){var z=norm(n);var x=norm(cross(upHint||[0,1,0],z));var y=cross(z,x);return frame(o,x,y,z);}
var LX=0,LY=0,LZ=0;
function loc(F,x,y,z){var px=x-F.o[0],py=y-F.o[1],pz=z-F.o[2];
  LX=px*F.x[0]+py*F.x[1]+pz*F.x[2];LY=px*F.y[0]+py*F.y[1]+pz*F.y[2];LZ=px*F.z[0]+py*F.z[1]+pz*F.z[2];}

// ---------- SDF primitives ----------
function sdSph(x,y,z,r){return Math.sqrt(x*x+y*y+z*z)-r;}
function sdE(x,y,z,a,b,c){var k0=Math.sqrt(x*x/(a*a)+y*y/(b*b)+z*z/(c*c));
  var k1=Math.sqrt(x*x/(a*a*a*a)+y*y/(b*b*b*b)+z*z/(c*c*c*c));return k1>1e-9?k0*(k0-1)/k1:-Math.min(a,b,c);}
function sdRB(x,y,z,bx,by,bz,r){var qx=Math.abs(x)-bx+r,qy=Math.abs(y)-by+r,qz=Math.abs(z)-bz+r;
  var mx=qx>0?qx:0,my=qy>0?qy:0,mz=qz>0?qz:0;return Math.sqrt(mx*mx+my*my+mz*mz)+Math.min(Math.max(qx,qy,qz),0)-r;}
function sdCap(x,y,z,a,b,r1,r2){var pax=x-a[0],pay=y-a[1],paz=z-a[2],bax=b[0]-a[0],bay=b[1]-a[1],baz=b[2]-a[2];
  var h=(pax*bax+pay*bay+paz*baz)/(bax*bax+bay*bay+baz*baz);h=h<0?0:h>1?1:h;
  var dx=pax-bax*h,dy=pay-bay*h,dz=paz-baz*h;return Math.sqrt(dx*dx+dy*dy+dz*dz)-(r1+(r2-r1)*h);}
// cylinder with axis along u, radial plane (v,w), rounded edge rr
function sdCyl(u,v,w,r,hl,rr){var dr=Math.sqrt(v*v+w*w)-r+rr,dh=Math.abs(u)-hl+rr;var a=dr>0?dr:0,b=dh>0?dh:0;
  return Math.sqrt(a*a+b*b)+Math.min(Math.max(dr,dh),0)-rr;}
function smin(a,b,k){var h=Math.max(k-Math.abs(a-b),0)/k;return Math.min(a,b)-h*h*k*.25;}
function smax(a,b,k){return -smin(-a,-b,k);}
function emod(a,m){return a-m*Math.floor(a/m);}

// ---------- noise ----------
function hash3(i,j,k){var h=(Math.imul(i,374761393)+Math.imul(j,668265263)+Math.imul(k,1274126177))|0;
  h=Math.imul(h^(h>>>13),1274126177);h^=h>>>16;return (h&0xffff)/65535;}
function vn(x,y,z){var i=Math.floor(x),j=Math.floor(y),k=Math.floor(z);var fx=x-i,fy=y-j,fz=z-k;
  fx=fx*fx*(3-2*fx);fy=fy*fy*(3-2*fy);fz=fz*fz*(3-2*fz);
  var a=hash3(i,j,k),b=hash3(i+1,j,k),c=hash3(i,j+1,k),d=hash3(i+1,j+1,k),e=hash3(i,j,k+1),f=hash3(i+1,j,k+1),g=hash3(i,j+1,k+1),h=hash3(i+1,j+1,k+1);
  var x1=a+(b-a)*fx,x2=c+(d-c)*fx,x3=e+(f-e)*fx,x4=g+(h-g)*fx;var y1=x1+(x2-x1)*fy,y2=x3+(x4-x3)*fy;return y1+(y2-y1)*fz;}
var NOFOLD=false;
function fold(x,y,z,amp){if(NOFOLD)return 0;return amp*(.0034*(vn(x*26+3.1,y*20,z*26)-.5)+.0016*(vn(x*61,y*55+7.7,z*61)-.5));}

// ---------- accumulators ----------
var D=1e9,ID=0;
function U(d,id){if(d<D){D=d;ID=id;}}
function S(d,id,k){var h=Math.max(k-Math.abs(D-d),0)/k;var m=Math.min(D,d)-h*h*k*.25;if(d<D)ID=id;D=m;}

// ================= POSE =================
var P=(function(){
  var B=[-.24,1.37,.15];var d=norm([.62,-.55,.32]);var up=[0,1,0];
  var y=norm(sub(up,mul(d,dot(up,d))));var z=cross(d,y);
  var t=-.2,c=Math.cos(t),s=Math.sin(t);
  var y2=add(mul(y,c),mul(z,s)),z2=add(mul(y,-s),mul(z,c));
  var R=frame(B,d,y2,z2);
  function rw(l){return add(B,add(mul(d,l[0]),add(mul(y2,l[1]),mul(z2,l[2]))));}
  function rl(w){var q=sub(w,B);return [dot(q,d),dot(q,y2),dot(q,z2)];}
  // grip frames in rifle-local space
  var pg={c:[.28,-.078,0],a:[-.343,-.939,0],f:[.939,-.343,0],s:[0,0,1]};
  var fgp={c:[.56,-.046,0],a:[0,-1,0],f:[1,0,0],s:[0,0,1]};
  var pgM={c:pg.c,a:pg.a,f:pg.f,s:[0,0,-1]};
  function gp(G,aa,ff,ss){return add(G.c,add(mul(G.a,aa),add(mul(G.f,ff),mul(G.s,ss))));}
  var SR=[-.215,1.42,.01],SL=[.215,1.42,.02];
  var WRl=gp(pgM,-.012,-.064,-.034),WLl=gp(fgp,-.012,-.06,-.034);
  var WR=rw(WRl),WL=rw(WLl);
  var ER=ik(SR,WR,.29,.27,[-1,-.45,-.35]),EL=ik(SL,WL,.29,.27,[1,-.5,-.25]);
  // head frame: Euler XYZ (rx=-.04, ry=.42) => M = Rx*Ry
  var rx=-.04,ry=.42,cx=Math.cos(rx),sx=Math.sin(rx),cy=Math.cos(ry),sy=Math.sin(ry);
  // columns of Rx*Ry
  var hx=[cy,sx*sy,-cx*sy],hy=[0,cx,sx],hz=[sy,-sx*cy,cx*cy];
  var H=frame([0,1.62,.01],hx,hy,hz);
  return {B:B,R:R,rw:rw,rl:rl,pg:pg,pgM:pgM,fgp:fgp,gp:gp,SR:SR,SL:SL,WR:WR,WL:WL,WRl:WRl,WLl:WLl,ER:ER,EL:EL,H:H,rot:{rx:rx,ry:ry}};
})();

// ================= BODY (world space) =================
var drapeF=frame([.02,1.37,.16],[Math.cos(.2),Math.sin(.2),0],[-Math.sin(.2),Math.cos(.2),0],[0,0,1]);
function armSetup(Sh,E,W,sx){
  var ax=norm(sub(E,Sh));var out=norm(sub([sx,0,0],mul(ax,dot([sx,0,0],ax))));
  var pf=frame(add(add(Sh,mul(sub(E,Sh),.34)),mul(out,.057)),cross(ax,out),ax,out);
  var n=norm(sub(E,W));var C=add(W,mul(n,.03));
  var mid=lerp(Sh,C,.5);var r=Math.max(len(sub(Sh,mid)),len(sub(C,mid)),len(sub(E,mid)))+.1;
  return {S:Sh,E:E,C:C,pf:pf,bc:mid,br:r};
}
var ARMS=[armSetup(P.SR,P.ER,P.WR,-1),armSetup(P.SL,P.EL,P.WL,1)];
function gLegs(x,y,z){
  for(var sx=-1;sx<=1;sx+=2){
    var hip=[sx*.1,.95,0],knee=[sx*.115,.52,.045],ank=[sx*.125,.12,.005];
    var d=sdCap(x,y,z,hip,knee,.088,.064);
    d=smin(d,sdCap(x,y,z,knee,ank,.061,.048),.03);
    d=smin(d,sdE(x-sx*.115,y-.52,z-.088,.05,.064,.028),.025);
    d=smin(d,sdRB(x-sx*.178,y-.69,z-.012,.024,.068,.052,.014),.014);
    d=smin(d,sdE(x-sx*.12,y-.2,z-.0,.066,.05,.064),.03); // bloused cuff
    if(!NOFOLD){var kx=x-knee[0],ky=y-knee[1],kz=z-knee[2],dk=Math.sqrt(kx*kx+ky*ky+kz*kz);
      d+=.0032*Math.sin(dk*170+x*40)*Math.exp(-dk*dk/(.06*.06));
      var dc=Math.abs(y-.215);d+=.003*Math.sin(Math.atan2(z,x-sx*.12)*11)*Math.exp(-dc*dc/(.03*.03));}
    d+=fold(x,y,z,1.2);
    S(d,18,.04);
    var b=sdRB(x-sx*.125,y-.065,z-.045,.05,.062,.122,.032);
    b=smin(b,sdE(x-sx*.125,y-.055,z-.135,.052,.05,.05),.02);
    b=smin(b,sdCap(x,y,z,[sx*.125,.1,-.005],[sx*.125,.19,0],.054,.052),.025);
    b+= .0012*(vn(x*90,y*90,z*90)-.5);
    U(b,11);
    var so=sdRB(x-sx*.125,y-.009,z-.045,.055,.009,.128,.005);
    so=Math.max(so,-Math.max(Math.abs(emod(z,.014)-.007)-.0022,y-.0045));
    U(so,5);
  }
}
function gTorso(x,y,z){
  var d=sdE(x,y-.97,z,.165,.13,.115);
  d=smin(d,sdE(x,y-1.12,z+.005,.162,.16,.112),.05);
  d=smin(d,sdE(x,y-1.29,z,.18,.17,.122),.06);
  d=smin(d,sdCap(x,y,z,[-.13,1.395,0],[.13,1.395,0],.072,.072),.05);
  d+=fold(x,y,z,.8);
  S(d,0,.03);
  var e=(Math.sqrt(x*x/(.163*.163)+z*z/(.12*.12))-1)*.12;
  U(smax(e,Math.abs(y-1.035)-.022,.006),12);
  U(sdRB(x,y-1.035,z-.123,.028,.019,.007,.003),6);
}
function gCarrier(x,y,z){
  var c=x*x*1.2;
  var d=sdRB(x,y-1.255,z-.117+c,.163,.152,.034,.022);
  d=smin(d,sdRB(x,y-1.27,z+.126-c,.163,.16,.034,.022),.01);
  var e=(Math.sqrt(x*x/(.198*.198)+z*z/(.148*.148))-1)*.148;
  d=smin(d,smax(e,Math.abs(y-1.12)-.056,.012),.012);
  for(var sx=-1;sx<=1;sx+=2){
    d=smin(d,sdCap(x,y,z,[sx*.11,1.4,.12],[sx*.12,1.48,.035],.022,.022),.02);
    d=smin(d,sdCap(x,y,z,[sx*.12,1.48,.035],[sx*.12,1.48,-.045],.022,.022),.02);
    d=smin(d,sdCap(x,y,z,[sx*.12,1.48,-.045],[sx*.11,1.41,-.13],.022,.022),.02);
  }
  for(var i=-1;i<=1;i++){
    var px=x-i*.095, cz=.168-(i*.095)*(i*.095)*1.2;
    d=smin(d,sdRB(px,y-1.115,z-cz,.042,.064,.03,.009),.006);
  }
  d=smin(d,sdRB(x-.06,y-1.32,z-(.163-.0036*1.2),.064,.046,.018,.008),.006);
  d+=fold(x,y,z,.35);
  S(d,17,.015);
  for(var j=-1;j<=1;j++){
    var qx=x-j*.095, fz=.172-(j*.095)*(j*.095)*1.2;
    U(sdRB(qx,y-1.178,z-fz,.045,.02,.033,.007)+fold(x,y,z,.2),17);
    U(sdRB(qx,y-1.155,z-(fz+.034),.011,.014,.0035,.002),12);
  }
  U(sdRB(x+.075,y-1.36,z-(.149-x*x*1.2),.038,.023,.0035,.0015),14);
  var o1=bind2D(x,y-1.255,.163,.152,.022),z1=z-(.147-c);U(Math.sqrt(o1*o1+z1*z1)-.0048,12);
  var o2=bind2D(x,y-1.27,.163,.16,.022),z2=z-(-.156+c);U(Math.sqrt(o2*o2+z2*z2)-.0048,12);
}
function bind2D(x,y,hx,hy,r){var qx=Math.abs(x)-hx+r,qy=Math.abs(y)-hy+r;var mx=qx>0?qx:0,my=qy>0?qy:0;return Math.sqrt(mx*mx+my*my)+Math.min(Math.max(qx,qy),0)-r;}
function gPack(x,y,z){
  var d=sdRB(x,y-1.22,z+.245,.15,.2,.075,.04);
  d=smin(d,sdE(x,y-1.42,z+.24,.13,.04,.07),.04);
  d+=fold(x,y,z,.6);
  U(d,15);
  U(sdRB(x+.1,y-1.44,z+.26,.028,.045,.02,.006),5);
  for(var sx=-1;sx<=1;sx+=2){
    var a=[sx*.1,1.42,-.175],b=[sx*.135,1.513,-.03],c2=[sx*.152,1.44,.138],e=[sx*.168,1.275,.14];
    var st=sdCap(x,y,z,a,b,.017,.017);st=smin(st,sdCap(x,y,z,b,c2,.017,.016),.01);st=smin(st,sdCap(x,y,z,c2,e,.016,.013),.01);
    U(st+fold(x,y,z,.3),15);
    U(sdRB(x-sx*.168,y-1.262,z-.15,.016,.011,.006,.002),5);
    U(sdCap(x,y,z,[sx*.168,1.25,.146],[sx*.171,1.17,.15],.0055,.0055),12);
  }
  var ss=Math.min(sdCap(x,y,z,[-.155,1.395,.142],[0,1.395,.168],.0055,.0055),sdCap(x,y,z,[0,1.395,.168],[.155,1.395,.142],.0055,.0055));
  U(ss,12);U(sdRB(x,y-1.395,z-.171,.017,.009,.005,.002),5);
}
function gArm(A,x,y,z){
  var d=sdCap(x,y,z,A.S,A.E,.061,.051);
  d=smin(d,sdCap(x,y,z,A.E,A.C,.05,.041),.025);
  d=smin(d,sdSph(x-A.S[0],y-A.S[1],z-A.S[2],.07),.03);
  loc(A.pf,x,y,z);d=smin(d,sdRB(LX,LY,LZ,.034,.045,.012,.008),.01);
  d=smin(d,sdRB(LX,LY-.042,LZ-.003,.036,.01,.013,.006),.004);
  if(!NOFOLD){var ex=x-A.E[0],ey=y-A.E[1],ez=z-A.E[2],de=Math.sqrt(ex*ex+ey*ey+ez*ez);
    d+=.0034*Math.sin(de*190+ey*60)*Math.exp(-de*de/(.055*.055));
    var cx=x-A.C[0],cy=y-A.C[1],cz=z-A.C[2],dw=Math.sqrt(cx*cx+cy*cy+cz*cz);
    d+=.003*Math.sin(dw*210)*Math.exp(-dw*dw/(.045*.045));}
  d+=fold(x,y,z,1.4);
  S(d,0,.045);
}
function tX(o,a){return frame(o,[1,0,0],[0,Math.cos(a),Math.sin(a)],[0,-Math.sin(a),Math.cos(a)]);}
function tZ(o,a){return frame(o,[Math.cos(a),Math.sin(a),0],[-Math.sin(a),Math.cos(a),0],[0,0,1]);}
var SHT=[tX([0,1.44,.012],.3),tZ([.004,1.488,.004],-.17),tX([0,1.415,0],-.1),tZ([0,1.465,.006],.12)];
var SHR=[[.088,.036],[.078,.032],[.108,.036],[.085,.03]];
function gShemagh(x,y,z){
  var d=1e9,zz=z/.92;
  for(var i=0;i<4;i++){loc(SHT[i],x,y,zz);var q=Math.sqrt(LX*LX+LZ*LZ)-SHR[i][0];d=smin(d,(Math.sqrt(q*q+LY*LY)-SHR[i][1])*.92,.018);}
  d=smin(d,sdE(x-.015,y-1.425,z-.1,.05,.035,.03),.02);
  var th=Math.atan2(x,z);
  if(!NOFOLD)d+=.004*Math.sin(th*9+y*40)+.006*(vn(x*34,y*34,z*34)-.5)+.002*(vn(x*90,y*90,z*90)-.5);
  loc(drapeF,x,y,z);
  var r=sdE(LX,LY,LZ,.066,.085,.02);
  r=smin(r,sdCap(x,y,z,[.025,1.31,.168],[.038,1.255,.172],.026,.009),.025);
  r+=.004*Math.sin(LX*90+LY*30)+.004*(vn(x*40,y*40,z*40)-.5);
  d=smin(d,r,.03);
  S(d,9,.015);
}
var LEG_GROUPS=[{c:[0,.5,.02],r:.56,f:gLegs}];
function mapLegs(x,y,z){return runGroups(LEG_GROUPS,x,y,z);}
var BODY_GROUPS=[
  {c:[0,1.17,0],r:.32,f:gTorso},
  {c:[0,1.26,0],r:.3,f:gCarrier},
  {c:[0,1.3,-.06],r:.37,f:gPack},
  {c:ARMS[0].bc,r:ARMS[0].br,f:function(x,y,z){gArm(ARMS[0],x,y,z);}},
  {c:ARMS[1].bc,r:ARMS[1].br,f:function(x,y,z){gArm(ARMS[1],x,y,z);}},
  {c:[.01,1.42,.05],r:.24,f:gShemagh}
];
function runGroups(G,x,y,z){
  D=1e9;ID=0;var n=G.length,best=-1,bb=1e9,i;var bs=runGroups.bs||(runGroups.bs=new Float64Array(32));
  for(i=0;i<n;i++){var g=G[i];var dx=x-g.c[0],dy=y-g.c[1],dz=z-g.c[2];bs[i]=Math.sqrt(dx*dx+dy*dy+dz*dz)-g.r;if(bs[i]<bb){bb=bs[i];best=i;}}
  if(bb>.06){D=bb;return D;}
  G[best].f(x,y,z);
  for(i=0;i<n;i++){if(i===best)continue;if(bs[i]>D+.06)continue;G[i].f(x,y,z);}
  if(bs.length&&D>1e8)D=bb;
  return D;
}
function mapBody(x,y,z){return runGroups(BODY_GROUPS,x,y,z);}

// ================= HEAD (head-local) =================
var HF=(function(){
  var C=[0,.05,-.018],A=.11,Bb=.105,Cc=.126;
  var n=norm([.62,.62,.48]);var t=1/Math.sqrt(Math.pow(n[0]/A,2)+Math.pow(n[1]/Bb,2)+Math.pow(n[2]/Cc,2));
  var Pp=add(C,mul(n,t));var nn=norm([(Pp[0]-C[0])/(A*A),(Pp[1]-C[1])/(Bb*Bb),(Pp[2]-C[2])/(Cc*Cc)]);
  var flag=frameN(add(Pp,mul(nn,.0005)),nn,[0,1,0]);
  var n2=norm([0,.4,.92]);var t2=1/Math.sqrt(Math.pow(n2[1]/Bb,2)+Math.pow(n2[2]/Cc,2));
  var P2=add(C,mul(n2,t2));var nn2=norm([0,(P2[1]-C[1])/(Bb*Bb),(P2[2]-C[2])/(Cc*Cc)]);
  var nvg=frameN(add(P2,mul(nn2,.006)),nn2,[0,1,0]);
  var top=frame([0,.152,-.025],[1,0,0],[0,0,-1],[0,1,0]);
  return {C:C,A:A,B:Bb,Cc:Cc,flag:flag,nvg:nvg,top:top};
})();
function gFace(x,y,z){
  var d=sdE(x,y-.025,z+.012,.079,.093,.098);
  d=smin(d,sdE(x,y+.012,z-.033,.067,.075,.07),.03);
  d=smin(d,sdE(x,y+.058,z-.022,.058,.045,.064),.03);
  d=smin(d,sdSph(x,y+.084,z-.056,.024),.02);
  d=smin(d,sdSph(x-.045,y+.006,z-.058,.02),.02);
  d=smin(d,sdSph(x+.045,y+.006,z-.058,.02),.02);
  d=smin(d,sdCap(x,y,z,[-.037,.037,.074],[.037,.037,.074],.012,.012),.02);
  var n=sdCap(x,y,z,[0,.03,.084],[0,-.006,.104],.0068,.0095);
  n=smin(n,sdSph(x,y+.014,z-.106,.0105),.008);
  n=smin(n,sdSph(x-.0118,y+.018,z-.096,.0074),.006);
  n=smin(n,sdSph(x+.0118,y+.018,z-.096,.0074),.006);
  n=smax(n,-sdSph(x-.0062,y+.0258,z-.1,.0034),.002);n=smax(n,-sdSph(x+.0062,y+.0258,z-.1,.0034),.002);
  d=smin(d,n,.012);
  for(var sx=-1;sx<=1;sx+=2)d=smax(d,-sdCap(x,y,z,[sx*.017,-.012,.094],[sx*.028,-.046,.086],.0026,.0026),.004);
  
  d=smin(d,sdCap(x,y,z,[-.015,-.052,.087],[.015,-.052,.087],.0072,.0072),.006);
  d=smin(d,sdCap(x,y,z,[0,-.06,-.005],[0,-.2,.0],.05,.056),.03);
  U(d,1);
  // short hair under helmet at the back/sides
  var hth=Math.atan2(x,z),hc=Math.cos(hth),hs=Math.abs(Math.sin(hth));
  var hline=.068*Math.max(0,hc)*Math.max(0,hc)+.026*hs*(hc>-0.2?1:0)-.045*Math.max(0,-hc)*Math.max(0,-hc);
  var hr=sdE(x,y-.028,z+.012,.0825,.0965,.1015);hr=smax(hr,hline-y,.006);
  if(!NOFOLD)hr+=.0012*(vn(x*320,y*320,z*320)-.5);
  U(hr,19);
  var b=sdE(x,y+.056,z-.025,.072,.062,.077);
  b=smin(b,sdSph(x,y+.092,z-.06,.036),.02);
  var cutY=-.022+.036*Math.min(Math.abs(x)/.065,1);
  b=smax(b,y-cutY,.008);
  b=smax(b,-(z+.012),.01);
  b+=.0035*(vn(x*120,y*55,z*120)-.5)+.0016*(vn(x*300,y*110,z*300)-.5);
  b=smax(b,-sdRB(x,y+.046,z-.096,.016,.0035,.03,.003),.003);
  b=smin(b,sdCap(x,y,z,[-.025,-.043,.092],[0,-.036,.101],.0074,.0058),.006);
  b=smin(b,sdCap(x,y,z,[.025,-.043,.092],[0,-.036,.101],.0074,.0058),.006);
  S(b,2,.004);
  // wraparound glasses
  var gl=Math.abs(sdE(x,y-.022,z-.008,.087,.098,.1))-.0022;
  gl=smax(gl,Math.abs(y-.024)-.0172+.006*Math.max(0,1-Math.abs(x)/.03),.002);
  gl=Math.max(gl,.014-z);
  gl=Math.max(gl,-sdRB(x,y-.0,z-.1,.012,.012,.05,.006));
  U(gl,7);
  var fr=Math.abs(sdE(x,y-.022,z-.008,.089,.1,.102))-.003;
  fr=Math.max(fr,Math.abs(y-.0405)-.0028);fr=Math.max(fr,.014-z);
  U(fr,5);
}
function gHelmet(x,y,z){
  var C=HF.C;
  var hm=sdE(x-C[0],y-C[1],z-C[2],HF.A,HF.B,HF.Cc);
  var th=Math.atan2(x,z),c=Math.cos(th);
  var cutY=c>0?.028+.017*c*c:.028-.048*c*c;
  hm=smax(hm,cutY-y,.005);
  hm+=.0006*(vn(x*120,y*120,z*120)-.5);
  var rim=Math.max(Math.abs(sdE(x-C[0],y-C[1],z-C[2],HF.A+.002,HF.B+.002,HF.Cc+.002))-.003,Math.abs(y-cutY-.004)-.004);
  U(Math.min(hm,rim),3);
  for(var sx=-1;sx<=1;sx+=2){
    var rz=z+.01,ry=y-.042;
    var rail=sdRB(x-sx*.111,ry,rz,.006,.012,.056,.003);
    rail=Math.max(rail,-Math.max(Math.abs(emod(rz,.012)-.006)-.0025,(sx*x)-.114));
    U(rail,10);
    U(sdCap(x,y,z,[sx*.098,.03,.052],[sx*.072,-.066,.06],.0045,.0045),12);
    U(sdCap(x,y,z,[sx*.072,-.066,.06],[sx*.04,-.1,.045],.0045,.0045),12);
    U(sdCap(x,y,z,[sx*.096,.02,-.07],[sx*.08,-.04,-.06],.0045,.0045),12);
  }
  loc(HF.nvg,x,y,z);U(sdRB(LX,LY,LZ,.028,.017,.007,.004),5);
  U(sdCyl(LZ-.012,LX,LY-.004,.006,.005,.002),5);
  loc(HF.top,x,y,z);U(sdRB(LX,LY,LZ,.045,.055,.003,.002),10);
  loc(HF.flag,x,y,z);U(sdRB(LX,LY,LZ,.03,.019,.0025,.0012),14);
  U(sdRB(x,y-.04,z+.146,.042,.028,.012,.007)+.0008*(vn(x*150,y*150,z*150)-.5),15);
}
function gHeadset(x,y,z){
  for(var sx=-1;sx<=1;sx+=2){
    U(sdCyl(x-sx*.106,y+.012,z+.006,.046,.016,.011),8);
    U(sdCyl(x-sx*.124,y+.012,z+.006,.031,.004,.002),5);
    U(sdCyl(x-sx*.09,y+.012,z+.006,.043,.007,.006),5);
  }
}
var HEAD_GROUPS=[
  {c:[0,-.03,.02],r:.17,f:gFace},
  {c:[0,.04,-.01],r:.17,f:gHelmet},
  {c:[0,-.012,-.005],r:.15,f:gHeadset}
];
function mapHead(x,y,z){return runGroups(HEAD_GROUPS,x,y,z);}

// ================= RIFLE + GLOVES (rifle-local) =================
function railTeeth(x,y,z,x0,x1,yb){
  var d=sdRB(x-(x0+x1)/2,y-yb,z,(x1-x0)/2,.004,.011,.0015);
  if(x>x0&&x<x1){var q=emod(x-x0,.01)-.005;d=Math.min(d,sdRB(q,y-(yb+.0062),z,.0026,.0035,.0105,.001));}
  return d;
}
function gStock(x,y,z){
  U(sdRB(x-.012,y+.005,z,.012,.055,.022,.006),5);
  var s=sdRB(x-.09,y,z,.07,.04,.02,.009);
  s=smax(s,(y+.04)-(x-.02)*.3,.006);
  s=Math.max(s,-sdRB(x-.105,y+.012,z,.028,.011,.03,.005));
  s=smin(s,sdRB(x-.1,y-.038,z,.065,.01,.018,.006),.006);
  U(s,5);
  U(sdCyl(x-.2,y-.02,z,.016,.065,.002),6);
  U(sdCyl(x-.268,y-.02,z,.02,.006,.002),6);
}
function gReceiver(x,y,z){
  var lr=sdRB(x-.34,y,z,.075,.03,.022,.004);
  lr=Math.min(lr,sdRB(x-.42,y+.035,z,.035,.03,.023,.004));
  U(lr,6);
  loc(PGF,x,y,z);
  var g=sdRB(LX,LY,LZ,.0175,.055,.02,.008);
  for(var k=-1;k<=1;k++)g=smax(g,-sdCyl(LZ,LX-.024,LY-k*.025,.009,.03,.0),.003);
  U(g,5);
  var tg=Math.max(sdRB(x-.33,y+.045,z,.033,.013,.005,.004),-sdRB(x-.33,y+.042,z,.026,.009,.01,.004));
  U(tg,6);
  U(sdRB(x-.326,y+.04,z,.0025,.011,.003,.0015),6);
  var ur=sdRB(x-.37,y-.058,z,.11,.03,.024,.004);
  ur=Math.max(ur,-sdRB(x-.37,y-.055,z+.026,.03,.009,.004,.002));
  U(ur,6);
  U(sdCyl(z+.03,x-.39,y-.06,.007,.008,.002),6);
  U(sdRB(x-.27,y-.075,z,.016,.008,.019,.003),6);
  U(railTeeth(x,y,z,.26,.78,.094),5);
  U(sdRB(x-.29,y-.118,z,.012,.014,.014,.003),5);
}
function gFront(x,y,z){
  var hg=sdRB(x-.625,y-.045,z,.145,.035,.032,.006);
  var q=Math.abs(emod(x-.48,.01)-.005)-.0026;
  if(y>.02&&y<.075)hg=Math.max(hg,-Math.max(q,.0285-Math.abs(z)));
  hg=Math.max(hg,-Math.max(q,(y-.045)+.0315));
  U(hg,13);
  U(sdRB(x-.775,y-.045,z,.012,.022,.018,.004),6);
  U(sdCyl(x-.85,y-.045,z,.0105,.08,.002),6);
  // flash hider with slots
  var fh=sdCyl(x-.955,y-.045,z,.016,.035,.003);
  var yy=y-.045,r=Math.sqrt(yy*yy+z*z),a=Math.atan2(z,yy),sec=Math.PI/3;
  var a2=emod(a+sec/2,sec)-sec/2;
  fh=Math.max(fh,-Math.max(Math.abs(r*Math.sin(a2))-.0026,Math.max(Math.abs(x-.962)-.022,.011-r)));
  fh=Math.max(fh,-sdCyl(x-.99,yy,z,.0065,.01,0));
  U(fh,5);
  U(sdRB(x-.745,y-.118,z,.008,.016,.012,.002),6);
  // tan laser box
  var lz=sdRB(x-.54,y-.135,z,.045,.024,.026,.006);
  U(lz,10);
  U(sdCyl(x-.586,y-.14,z-.011,.007,.003,.001),7);
  U(sdCyl(x-.586,y-.14,z+.011,.006,.003,.001),7);
  // foregrip
  var fg=sdCyl(y+.046,x-.56,z,.017,.042,.004);
  U(fg,10);
  // weapon light
  U(sdCyl(x-.7,y-.045,z-.052,.015,.04,.003),5);
  U(sdCyl(x-.744,y-.045,z-.052,.018,.007,.003),5);
  U(sdCyl(x-.752,y-.045,z-.052,.012,.002,.001),7);
  U(sdRB(x-.7,y-.045,z-.036,.016,.01,.008,.003),5);
}
function magX(y){var t=y+.06;return .425+1.87*t*t;}
function gMag(x,y,z){
  if(y>-.06){U(sdRB(x-.425,y+.04,z,.031,.03,.0135,.004),5);return;}
  var xc=magX(y),dd=sdRB(x-xc,y+.14,z,.031,.08,.0135,.004)*.85;
  var rib=Math.max(Math.abs(emod(y,.018)-.009)-.002,.0115-Math.abs(z));
  if(y<-.07&&y>-.2)dd=smax(dd,-rib,.002);
  U(dd,5);
  U(sdRB(x-magX(-.217),y+.218,z,.035,.008,.017,.004),10);
}
// gloves
function buildHand(G,aas,pistol,Elocal){
  var gp=P.gp;var segs=[];
  aas.forEach(function(aa){
    segs.push([gp(G,aa,-.016,-.034),gp(G,aa,.022,-.03),.0108,.0104]);
    segs.push([gp(G,aa,.022,-.03),gp(G,aa,.031,.005),.0104,.0098]);
    segs.push([gp(G,aa,.031,.005),gp(G,aa,.013,.03),.0098,.009]);
  });
  var a0=aas[0];
  segs.push([gp(G,a0-.02,-.034,.004),gp(G,a0-.026,-.014,.03),.0125,.011]);
  segs.push([gp(G,a0-.026,-.014,.03),gp(G,a0-.02,.01,.034),.011,.0095]);
  if(pistol){var sz=-G.s[2];var k0=gp(G,-.046,-.006,-.034);segs.push([k0,[.355,-.024,.031*sz],.0105,.0099]);segs.push([[.355,-.024,.031*sz],[.392,-.026,.029*sz],.0099,.009]);}
  var palmF=frame(gp(G,(aas[0]+aas[aas.length-1])/2-.004,-.034,-.017),G.f,mul(G.a,-1),G.s);
  var hl=(aas[aas.length-1]-aas[0])/2+.02;
  var W=gp(G,-.012,-.062,-.034);var n=norm(sub(Elocal,W));
  var knuck=[gp(G,aas[0]-.008,-.008,-.042),gp(G,aas[aas.length-1]+.006,-.008,-.042)];
  var all=[].concat.apply([],segs.map(function(s){return [s[0],s[1]];})).concat([W,add(W,mul(n,.07))]);
  var c=[0,0,0];all.forEach(function(p){c=add(c,p);});c=mul(c,1/all.length);
  var r=0;all.forEach(function(p){r=Math.max(r,len(sub(p,c)));});
  return {segs:segs,palmF:palmF,hl:hl,W:W,n:n,knuck:knuck,c:c,r:r+.05};
}
var HANDS=[buildHand(P.pgM,[-.02,.004,.028],true,P.rl(P.ER)),buildHand(P.fgp,[-.028,-.006,.016,.037],false,P.rl(P.EL))];
var PGF=frame(P.pg.c,P.pg.f,mul(P.pg.a,-1),P.pg.s);
function gHand(Hd,x,y,z){
  loc(Hd.palmF,x,y,z);
  var d=sdRB(LX,LY,LZ,.019,Hd.hl,.028,.016);
  for(var i=0;i<Hd.segs.length;i++){var s=Hd.segs[i];d=smin(d,sdCap(x,y,z,s[0],s[1],s[2],s[3]),.007);}
  d=smin(d,sdCap(x,y,z,Hd.W,add(Hd.W,mul(Hd.n,.068)),.039,.043),.02);
  d+=.0006*(vn(x*300,y*300,z*300)-.5);
  U(d,4);
  U(sdCap(x,y,z,Hd.knuck[0],Hd.knuck[1],.0085,.0085),12);
  U(sdCap(x,y,z,add(Hd.W,mul(Hd.n,.04)),add(Hd.W,mul(Hd.n,.06)),.0445,.0445),12);
}
var RIFLE_GROUPS=[
  {c:[.14,0,0],r:.16,f:gStock},
  {c:[.35,.02,0],r:.16,f:gReceiver},
  {c:[.75,.05,0],r:.26,f:gFront},
  {c:[.44,-.12,0],r:.13,f:gMag},
  {c:HANDS[0].c,r:HANDS[0].r,f:function(x,y,z){gHand(HANDS[0],x,y,z);}},
  {c:HANDS[1].c,r:HANDS[1].r,f:function(x,y,z){gHand(HANDS[1],x,y,z);}}
];
function mapRifle(x,y,z){return runGroups(RIFLE_GROUPS,x,y,z);}

// ================= UVs =================
// combined world-space field (all chunks) for occlusion
function mapWorld(x,y,z){
  var d=mapBody(x,y,z);if(y<1.1)d=Math.min(d,mapLegs(x,y,z));
  var H=P.H.o,dx=x-H[0],dy=y-H[1],dz=z-H[2],hb=Math.sqrt(dx*dx+dy*dy+dz*dz)-.24;
  if(hb<d){loc(P.H,x,y,z);var a=LX,b=LY,c=LZ;d=Math.min(d,mapHead(a,b,c));}
  loc(P.R,x,y,z);var rx=LX,ry=LY,rz=LZ;
  var rb=sdRB(rx-.49,ry+.045,rz+.015,.52,.25,.16,0);
  if(rb<d)d=Math.min(d,mapRifle(rx,ry,rz));
  return d;
}
var AOH=[.012,.035,.07],AOW=[1,.75,.5];
function aoAt(x,y,z,nx,ny,nz){var o=0,ws=0;
  for(var i=0;i<3;i++){var h=AOH[i];var d=mapWorld(x+nx*h,y+ny*h,z+nz*h);var t=1-Math.max(d,0)/h;if(t<0)t=0;o+=AOW[i]*t;ws+=AOW[i];}
  var a=1-1.25*o/ws;return a<.08?.08:a>1?1:a;}
function uvBody(id,x,y,z){
  if(id===9){if(z>.12&&y<1.43)return [x*1.0,y];return [Math.atan2(x,z)*.14,y];}
  if(id===14)return [(x+.075)/.076+.5,(y-1.36)/.046+.5];
  return [0,0];
}
function uvHead(id,x,y,z){if(id===14){loc(HF.flag,x,y,z);return [LX/.06+.5,LY/.038+.5];}return [0,0];}
function uvNone(){return [0,0];}

function mapOf(G,idx){var sub=idx.map(function(i){return G[i];});return function(x,y,z){return runGroups(sub,x,y,z);};}
var CHUNKS={
  body:{map:mapBody,uv:uvBody,b:[-.42,.8,-.37,.42,1.62,.44],h:.0042},
  legs:{map:mapLegs,uv:uvNone,b:[-.26,-.01,-.14,.26,1.06,.21],h:.0045},
  person:{map:mapOf(BODY_GROUPS,[0,1,3,4,5]),uv:uvBody,lg:BODY_GROUPS,li:[0,1,3,4,5],b:[-.42,.8,-.37,.42,1.62,.44],h:.0045},
  pack:{map:mapOf(BODY_GROUPS,[2]),uv:uvBody,b:[-.25,.95,-.36,.25,1.58,.2],h:.0045},
  face:{F:P.H,map:mapOf(HEAD_GROUPS,[0,2]),uv:uvHead,b:[-.15,-.2,-.17,.15,.17,.17],h:.0021},
  helmet:{F:P.H,map:mapOf(HEAD_GROUPS,[1]),uv:uvHead,b:[-.15,-.13,-.17,.15,.17,.17],h:.0021},
  gun:{F:P.R,map:mapOf(RIFLE_GROUPS,[0,1,2]),uv:uvNone,b:[-.02,-.1,-.08,1.0,.2,.08],h:.0026},
  mag:{F:P.R,map:mapOf(RIFLE_GROUPS,[3]),uv:uvNone,b:[.36,-.26,-.04,.52,-.02,.04],h:.0022},
  hands:{F:P.R,map:mapOf(RIFLE_GROUPS,[4,5]),uv:uvNone,lg:RIFLE_GROUPS,li:[4,5],b:[-.02,-.29,-.17,1.0,.2,.14],h:.0026},
  head:{F:P.H,map:mapHead,uv:uvHead,b:[-.15,-.2,-.17,.15,.17,.17],h:.0021},
  rifle:{F:P.R,map:mapRifle,uv:uvNone,b:[-.02,-.29,-.17,1.0,.2,.14],h:.0026}
};

// ================= surface nets =================
function labelG(G,x,y,z){var best=0,bd=1e9;for(var i=0;i<G.length;i++){D=1e9;ID=0;G[i].f(x,y,z);if(D<bd){bd=D;best=i;}}return best;}
function polygonize(name,prog,hOverride){
  var C=CHUNKS[name],b=C.b,h=hOverride||C.h,map=C.map;
  var nx=Math.ceil((b[3]-b[0])/h)+1,ny=Math.ceil((b[4]-b[1])/h)+1,nz=Math.ceil((b[5]-b[2])/h)+1;
  var sxy=nx*ny,N=sxy*nz;var vals=new Float32Array(N);
  var hx=(b[3]-b[0])/2,hy=(b[4]-b[1])/2,hz=(b[5]-b[2])/2,mx=b[0]+hx,my=b[1]+hy,mz=b[2]+hz;
  function f(x,y,z){var d=map(x,y,z);var bx=sdRB(x-mx,y-my,z-mz,hx-1.5*h,hy-1.5*h,hz-1.5*h,0);return d>bx?d:bx;}
  var cs=4,cx=Math.ceil((nx-1)/cs)+1,cy=Math.ceil((ny-1)/cs)+1,cz=Math.ceil((nz-1)/cs)+1;
  var cv=new Float32Array(cx*cy*cz),i,j,k;
  for(k=0;k<cz;k++)for(j=0;j<cy;j++)for(i=0;i<cx;i++)cv[i+j*cx+k*cx*cy]=f(b[0]+i*cs*h,b[1]+j*cs*h,b[2]+k*cs*h);
  var thr=9*h,evals=0;
  for(k=0;k<nz;k++){var ck=Math.min(cz-1,Math.round(k/cs));
    for(j=0;j<ny;j++){var cj=Math.min(cy-1,Math.round(j/cs));
      for(i=0;i<nx;i++){var ci=Math.min(cx-1,Math.round(i/cs));var c=cv[ci+cj*cx+ck*cx*cy];
        vals[i+j*nx+k*sxy]=Math.abs(c)>thr?c:(evals++,f(b[0]+i*h,b[1]+j*h,b[2]+k*h));}}
    if(prog&&(k&7)===0)prog(.75*k/nz);}
  var cellV=new Int32Array(N);var pos=[],idx=[];
  var off=[0,1,nx,nx+1,sxy,sxy+1,sxy+nx,sxy+nx+1];
  var E=[];for(var a=0;a<8;a++)for(var bb=a+1;bb<8;bb++){var x_=a^bb;if(x_===1||x_===2||x_===4)E.push([a,bb]);}
  var v=new Float64Array(8),stride=[1,nx,sxy],cc=[0,0,0],vote=0;
  for(k=0;k<nz-1;k++)for(j=0;j<ny-1;j++)for(i=0;i<nx-1;i++){
    var m=i+j*nx+k*sxy,mask=0;
    for(var q=0;q<8;q++){v[q]=vals[m+off[q]];if(v[q]<0)mask|=1<<q;}
    if(mask===0||mask===255)continue;
    var px=0,py=0,pz=0,cnt=0;
    for(var e=0;e<12;e++){var e0=E[e][0],e1=E[e][1];if(((mask>>e0)&1)===((mask>>e1)&1))continue;
      var t=v[e0]/(v[e0]-v[e1]);
      px+=(e0&1)+((e1&1)-(e0&1))*t;py+=((e0>>1)&1)+(((e1>>1)&1)-((e0>>1)&1))*t;pz+=((e0>>2)&1)+(((e1>>2)&1)-((e0>>2)&1))*t;cnt++;}
    var vi=pos.length/3;cellV[m]=vi;
    pos.push(b[0]+(i+px/cnt)*h,b[1]+(j+py/cnt)*h,b[2]+(k+pz/cnt)*h);
    cc[0]=i;cc[1]=j;cc[2]=k;
    for(var ax=0;ax<3;ax++){
      if((mask&1)===((mask>>(1<<ax))&1))continue;
      var iu=(ax+1)%3,iv=(ax+2)%3;if(cc[iu]===0||cc[iv]===0)continue;
      var du=stride[iu],dv=stride[iv];
      var A=vi,Bq=cellV[m-du],Cq=cellV[m-du-dv],Dq=cellV[m-dv];
      var ux=pos[Bq*3]-pos[A*3],uy=pos[Bq*3+1]-pos[A*3+1],uz=pos[Bq*3+2]-pos[A*3+2];
      var wx=pos[Cq*3]-pos[A*3],wy=pos[Cq*3+1]-pos[A*3+1],wz=pos[Cq*3+2]-pos[A*3+2];
      var nrm=[uy*wz-uz*wy,uz*wx-ux*wz,ux*wy-uy*wx][ax];
      if(mask&1){idx.push(A,Bq,Cq,A,Cq,Dq);vote+=nrm>0?1:-1;}else{idx.push(A,Cq,Bq,A,Dq,Cq);vote+=nrm<0?1:-1;}
    }
  }
  vals=null;cellV=null;

  // project to surface, gradient normals, ids, uvs
  var nv=pos.length/3,P32=new Float32Array(pos),Nm=new Float32Array(nv*3),Id=new Float32Array(nv),UV=new Float32Array(nv*2);
  var e2=h*.5;
  for(var p=0;p<nv;p++){
    var x=P32[p*3],y=P32[p*3+1],z=P32[p*3+2];
    var a1=map(x+e2,y-e2,z-e2),a2=map(x-e2,y-e2,z+e2),a3=map(x-e2,y+e2,z-e2),a4=map(x+e2,y+e2,z+e2);
    var gx=a1-a2-a3+a4,gy=-a1-a2+a3+a4,gz=-a1+a2-a3+a4;var gl=Math.sqrt(gx*gx+gy*gy+gz*gz)||1;gx/=gl;gy/=gl;gz/=gl;
    var d0=(a1+a2+a3+a4)*.25;if(d0>h)d0=h;if(d0<-h)d0=-h;
    x-=gx*d0;y-=gy*d0;z-=gz*d0;P32[p*3]=x;P32[p*3+1]=y;P32[p*3+2]=z;
    Nm[p*3]=gx;Nm[p*3+1]=gy;Nm[p*3+2]=gz;
    map(x,y,z);Id[p]=ID;var uv=C.uv(ID,x,y,z);UV[p*2]=uv[0];UV[p*2+1]=uv[1];
    if(prog&&(p&8191)===0)prog(.75+.13*p/nv);
  }
  for(var fi=0;fi<idx.length;fi+=3){var ia=idx[fi],ib=idx[fi+1],ic=idx[fi+2];
    var ux2=P32[ib*3]-P32[ia*3],uy2=P32[ib*3+1]-P32[ia*3+1],uz2=P32[ib*3+2]-P32[ia*3+2];
    var wx2=P32[ic*3]-P32[ia*3],wy2=P32[ic*3+1]-P32[ia*3+1],wz2=P32[ic*3+2]-P32[ia*3+2];
    var tx=uy2*wz2-uz2*wy2,ty=uz2*wx2-ux2*wz2,tz=ux2*wy2-uy2*wx2;
    var sd=tx*(Nm[ia*3]+Nm[ib*3]+Nm[ic*3])+ty*(Nm[ia*3+1]+Nm[ib*3+1]+Nm[ic*3+1])+tz*(Nm[ia*3+2]+Nm[ib*3+2]+Nm[ic*3+2]);
    if(sd<0){idx[fi+1]=ic;idx[fi+2]=ib;}}
  var AO=new Float32Array(nv),F=C.F;NOFOLD=true;
  for(p=0;p<nv;p++){var lx=P32[p*3],ly=P32[p*3+1],lz=P32[p*3+2],qx=Nm[p*3],qy=Nm[p*3+1],qz=Nm[p*3+2];
    if(F){var wx3=F.o[0]+F.x[0]*lx+F.y[0]*ly+F.z[0]*lz,wy3=F.o[1]+F.x[1]*lx+F.y[1]*ly+F.z[1]*lz,wz3=F.o[2]+F.x[2]*lx+F.y[2]*ly+F.z[2]*lz;
      var nx3=F.x[0]*qx+F.y[0]*qy+F.z[0]*qz,ny3=F.x[1]*qx+F.y[1]*qy+F.z[1]*qz,nz3=F.x[2]*qx+F.y[2]*qy+F.z[2]*qz;lx=wx3;ly=wy3;lz=wz3;qx=nx3;qy=ny3;qz=nz3;}
    AO[p]=aoAt(lx+qx*.002,ly+qy*.002,lz+qz*.002,qx,qy,qz);
    if(prog&&(p&8191)===0)prog(.88+.12*p/nv);}
  var LB=null,LG=C.lg?C.li.map(function(i){return C.lg[i];}):{body:BODY_GROUPS,head:HEAD_GROUPS,rifle:RIFLE_GROUPS}[name];
  if(LG){LB=new Uint8Array(nv);for(p=0;p<nv;p++){var li=labelG(LG,P32[p*3],P32[p*3+1],P32[p*3+2]);LB[p]=C.li?C.li[li]:li;}}
  NOFOLD=false;
  var I32=nv>65535?new Uint32Array(idx):new Uint16Array(idx);
  return {lb:LB,ao:AO,pos:P32,nrm:Nm,id:Id,uv:UV,idx:I32,evals:evals,grid:[nx,ny,nz]};
}
return {ARMS:ARMS,P:P,HF:HF,CHUNKS:CHUNKS,polygonize:polygonize,HANDS:HANDS,getId:function(){return ID;}};
})();

