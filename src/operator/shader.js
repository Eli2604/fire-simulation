/**
 * The operator's surface: one physically based material whose colour, roughness, metalness,
 * cloth sheen and bump are worked out per pixel from a material id (aId) and the object-space
 * position, so the sculpt needs no texture images: multicam ripstop with seams and dust, MOLLE
 * webbing, shemagh weave, suede gloves, beard and hair, skin, helmet coating, worn metal.
 *
 * Ids: 0 camo, 1 skin, 2 beard, 3 helmet, 4 glove, 5 black polymer, 6 metal, 7 lens, 8 ear cup,
 * 9 shemagh, 10 tan polymer, 11 boot, 12 webbing, 13 tan rail, 14 flag, 15 coyote pack,
 * 17 carrier camo (MOLLE), 18 trouser camo (seams, dust), 19 hair.
 * uHit (0..1) flashes it red when hit; uClay shows the bare sculpt.
 */
import * as THREE from 'three';

export const clayUniform = { value: 0 };

/** A material for one figure (each has its own hit flash). */
export function makeOperatorMaterial() {
  const U = { clay: clayUniform, hit: { value: 0 } };
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, envMapIntensity: 0.8, sheen: 1, sheenRoughness: 0.55, sheenColor: 0xffffff });
  m.onBeforeCompile = (sh) => operatorShader(sh, U);
  m.customProgramCacheKey = () => 'operator-v2';
  m.userData.uHit = U.hit;
  return m;
}

function operatorShader(sh, U) {
  sh.uniforms.uClay=U.clay;sh.uniforms.uHit=U.hit;
  sh.vertexShader=sh.vertexShader
   .replace('#include <common>','#include <common>\nattribute float aId;attribute vec2 aUV;attribute float aAO;flat varying float vId;varying vec2 vUV;varying vec3 vObj;varying float vAO;')
   .replace('#include <begin_vertex>','#include <begin_vertex>\nvId=aId;vUV=aUV;vObj=position;vAO=aAO;');
  sh.fragmentShader=sh.fragmentShader
   .replace('#include <common>',`#include <common>
uniform float uClay;uniform float uHit;flat varying float vId;varying vec2 vUV;varying vec3 vObj;varying float vAO;
float h31(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float vn(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
 return mix(mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x),mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*vn(p);p=p*2.03+vec3(1.7,9.2,3.1);a*=.5;}return s/.9375;}
vec3 lin(vec3 c){return pow(c,vec3(2.2));}
vec3 camo(vec3 p){
 vec3 w=p+.03*vec3(fbm(p*14.),fbm(p*14.+4.),fbm(p*14.+8.));
 vec3 c=lin(vec3(.62,.54,.40));
 c=mix(c,lin(vec3(.72,.66,.52)),smoothstep(.60,.625,fbm(w*10.+vec3(7.,2.,5.))));
 c=mix(c,lin(vec3(.45,.45,.29)),smoothstep(.52,.545,fbm(w*7.)));
 c=mix(c,lin(vec3(.52,.38,.25)),smoothstep(.56,.585,fbm(w*8.5+11.)));
 c=mix(c,lin(vec3(.34,.39,.24)),smoothstep(.64,.665,fbm(w*7.)));
 float br=fbm(w*24.+3.);c=mix(c,lin(vec3(.27,.21,.15)),smoothstep(.64,.66,br));
 return c;}
vec3 bumpN(vec3 sp,vec3 n,float h){vec3 dx=dFdx(sp),dy=dFdy(sp);vec3 r1=cross(dy,n),r2=cross(n,dx);float det=dot(dx,r1);
 vec3 g=sign(det)*(dFdx(h)*r1+dFdy(h)*r2);return normalize(abs(det)*n-g);}
vec3 sc,sSheen,sEm;float sr,sm,sh;
void surf(){
 int id=int(vId+.5);vec3 p=vObj;sc=vec3(.5);sr=.8;sm=0.;sh=0.;sSheen=vec3(0.);sEm=vec3(0.);
 float wv=vn(p*1400.);
 if(id==0||id==17||id==18){sc=camo(p);sr=.92;sh=.00025*wv+.0004*vn(p*420.);
   float rf=clamp(1.-length(fwidth(p*220.))*1.5,0.,1.);
   sh+=.00018*rf*max(step(.92,fract(p.x*220.+p.z*220.)),step(.92,fract(p.y*220.)));
   if(id==18){float sd=abs(p.z-.006);float outer=step(.14,abs(p.x));
     sh-=.0008*outer*(1.-smoothstep(.0008,.0024,sd));
     sc*=1.-.3*outer*(1.-smoothstep(.0,.0012,abs(sd-.0042)))*step(.45,fract(p.y*260.));
     float dust=smoothstep(.55,.05,p.y)*(.45+.55*fbm(p*22.));sc=mix(sc,lin(vec3(.74,.66,.54)),dust*.5);sr=mix(sr,1.,dust);}
   if(id==17){float row=fract(p.y*38.);float band=smoothstep(.0,.06,row)*(1.-smoothstep(.56,.62,row));
     float tack=smoothstep(.0,.05,abs(fract(p.x*26.)-.5)-.44);sh+=.0016*band-.0006*tack*band;sc*=mix(.78,1.,band);}}
 else if(id==1){sc=lin(vec3(.80,.58,.45));sc=mix(sc,lin(vec3(.78,.47,.38)),.55*fbm(p*60.));sc*=.93+.1*vn(p*400.);sr=.5;sh=.00008*vn(p*2600.);
   sc=mix(sc,lin(vec3(.62,.36,.26)),.35*smoothstep(.55,.75,fbm(p*140.)));sEm=sc*vec3(.42,.11,.05)*.3;}
 else if(id==2){vec3 hw=p+.004*vec3(vn(p*90.),0.,vn(p*90.+3.));float s=.6*vn(vec3(hw.x*1100.,hw.y*300.,hw.z*1100.))+.4*vn(hw*500.);sc=mix(lin(vec3(.62,.38,.2)),lin(vec3(.34,.19,.09)),s);sc*=.85+.3*vn(p*90.);sr=.85;sh=.0007*s;}
 else if(id==3){sc=lin(vec3(.64,.56,.43))*(.92+.1*fbm(p*35.));sc=mix(sc,lin(vec3(.74,.67,.54)),smoothstep(.68,.72,fbm(p*80.)));sr=.72;sh=.00025*fbm(p*350.);}
 else if(id==4){sc=lin(vec3(.68,.53,.38))*(.88+.17*fbm(p*70.));sr=.95;sh=.00035*vn(p*1300.);}
 else if(id==5){sc=lin(vec3(.11,.11,.11))*(.9+.2*vn(p*200.));sr=.62;sh=.00012*vn(p*2000.);}
 else if(id==6){sc=lin(vec3(.15,.155,.16));sm=.6;sr=.36;sc=mix(sc,lin(vec3(.35,.35,.36)),smoothstep(.72,.8,fbm(p*120.)));sh=.00006*vn(p*1800.);}
 else if(id==7){sc=lin(vec3(.03,.035,.045));sr=.04;sm=.9;}
 else if(id==8){sc=lin(vec3(.42,.3,.19))*(.92+.1*vn(p*150.));sr=.48;sh=.00015*vn(p*1500.);}
 else if(id==9){vec2 g=vUV*78.;float lx=1.-smoothstep(.08,.14,fract(g.x)),ly=1.-smoothstep(.08,.14,fract(g.y));
   float dots=step(.72,fract(g.x*3.))*step(.72,fract(g.y*3.));
   sc=mix(lin(vec3(.72,.64,.49)),lin(vec3(.24,.2,.15)),.8*clamp(lx+ly+dots*.5,0.,1.));sc*=.9+.15*vn(p*200.);sr=1.;sh=.00045*wv+.0005*vn(p*500.);}
 else if(id==10||id==13){sc=lin(vec3(.58,.48,.36))*(.92+.1*fbm(p*60.));sr=.68;sh=.0001*vn(p*1500.);}
 else if(id==11){sc=lin(vec3(.52,.42,.3))*(.88+.15*fbm(p*50.));sr=.85;sh=.0003*vn(p*900.);
   float lx=abs(abs(p.x)-.125);
   if(p.z>.03&&p.y>.07&&p.y<.2){float L=step(.62,fract(p.y*75.+lx*40.))*(1.-smoothstep(.016,.022,lx));sc=mix(sc,lin(vec3(.22,.19,.15)),L*.85);sh+=.0009*L;}
   float dust=.6*(.4+.6*fbm(p*22.));sc=mix(sc,lin(vec3(.74,.66,.54)),dust*.45);sr=1.;}
 else if(id==12){sc=lin(vec3(.45,.38,.28));sr=.95;sh=.0004*abs(sin(p.y*2400.+p.x*2400.));}
 else if(id==14){vec2 u=clamp(vUV,0.,1.);float st=step(.5,fract(u.y*6.5));sc=mix(lin(vec3(.23,.23,.21)),lin(vec3(.74,.72,.66)),st);
   if(u.x<.42&&u.y>.46){sc=lin(vec3(.2,.2,.19));vec2 q=fract(vec2(u.x*12.,u.y*10.));if(length(q-.5)<.22)sc=lin(vec3(.74,.72,.66));}sr=.9;}
 else if(id==19){vec3 hw=p+.003*vec3(vn(p*120.),0.,vn(p*120.+3.));float s=vn(vec3(hw.x*1500.,hw.y*900.,hw.z*1500.));sc=mix(lin(vec3(.5,.31,.17)),lin(vec3(.28,.16,.08)),s);sc*=.85+.25*vn(p*160.);sr=.8;sh=.0004*s;}
 else if(id==15){sc=lin(vec3(.48,.4,.3))*(.9+.12*fbm(p*40.));sr=.95;sh=.0004*wv;
   float row=fract(p.y*38.);sh+=.0012*smoothstep(.0,.06,row)*(1.-smoothstep(.56,.62,row));}
 if(id==0||id==17||id==18||id==9||id==12||id==15||id==4||id==19)sSheen=sc*.55+.03;
 if(uClay>.5){sc=lin(vec3(.74,.68,.62));sr=.65;sm=0.;sSheen=vec3(0.);sEm=vec3(0.);}
 if(uClay>1.5){float k=float(id);sc=.5+.5*cos(6.28*(k*.13+vec3(0.,.33,.67)));sh=0.;sm=0.;sr=1.;}
}`)
   .replace('#include <color_fragment>','#include <color_fragment>\nsurf();float aoD=vAO*vAO*(3.-2.*vAO);diffuseColor.rgb=sc*mix(1.,aoD,.45);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.75,.04,.02),uHit*.5);')
   .replace('#include <roughnessmap_fragment>','float roughnessFactor=sr;')
   .replace('#include <metalnessmap_fragment>','float metalnessFactor=sm;')
   .replace('#include <lights_physical_fragment>','#include <lights_physical_fragment>\n#ifdef USE_SHEEN\nmaterial.sheenColor=sSheen;\n#endif')
   .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=sEm*aoD+vec3(.5,.02,.01)*uHit*.35;')
   .replace('#include <aomap_fragment>','reflectedLight.indirectDiffuse*=aoD;reflectedLight.indirectSpecular*=aoD;')
   .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\nnormal=bumpN(-vViewPosition,normal,sh*1.4);');
}
