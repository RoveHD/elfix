package local.elflix.android;

/** Scripts for a manual verification gate inside the already loaded WebView. */
final class Verifizierung {
    static final long MENSCH_FRIST_MS = 120_000L;
    static final long PRUEF_TAKT_MS = 300L;

    private Verifizierung() { }

    /** One scanner shared by detection, masking and Continue. */
    private static String scanner() {
        return "()=>{const maskiert=!!document.querySelector('[data-elfix-verifizierung]');const sichtbar=e=>{if(!e||!e.isConnected)return false;"
            + "for(let p=e;p;p=p.parentElement){const x=getComputedStyle(p);if(x.display==='none'||Number(x.opacity)===0)return false;"
            + "if((x.visibility==='hidden'||x.visibility==='collapse')&&(!maskiert||p===e))return false}"
            + "const r=e.getBoundingClientRect();return r.width>0&&r.height>0};"
            + "const wort=e=>String(e&&(e.innerText||e.textContent||e.value)||'').trim();"
            + "const weiter=/^(weiter(?!e)|continue|fortfahren|proceed|zum stream|jetzt ansehen|jetzt starten|watch now|play now)\\b/i;"
            + "const status=e=>e.matches('#challenge-form,#challenge-running,#cf-please-wait');"
            + "const kandidaten=[...document.querySelectorAll('.cf-turnstile,.h-captcha,.g-recaptcha,iframe[src*=\"challenges.cloudflare.com\"],iframe[src*=\"hcaptcha.com\"],iframe[src*=\"recaptcha\"],#challenge-form,#challenge-running,#cf-please-wait')]"
            + ".sort((a,b)=>Number(status(a))-Number(status(b)));const gesehen=new Set(),tore=[];"
            + "for(const abfrage of kandidaten){let box=abfrage,knopf=null;"
            + "for(let e=abfrage.parentElement,n=0;e&&e!==document.body&&n<6;e=e.parentElement,n++){const b=[...e.querySelectorAll('button,[role=button],input[type=submit],input[type=button],a[href=\"#\"],a:not([href])')].find(x=>sichtbar(x)&&weiter.test(wort(x)));"
            + "if(b&&sichtbar(e)&&(e.matches('dialog,[role=dialog],.modal-content')||/video wird vorbereitet|stream wird vorbereitet|preparing (?:your )?video/i.test(wort(e)))){box=e;knopf=b;break}}"
            + "if(!sichtbar(box)||gesehen.has(box))continue;gesehen.add(box);"
            + "const feld=box.querySelector('input[name=\"cf-turnstile-response\"],textarea[name=\"g-recaptcha-response\"],input[name=\"g-recaptcha-response\"],textarea[name=\"h-captcha-response\"],input[name=\"h-captcha-response\"]');"
            + "tore.push({box,knopf,token:!!(feld&&String(feld.value||'').trim()),status:status(abfrage)})}return tore}";
    }

    static String zustandScript() {
        return "(()=>{const tore=(" + scanner() + ")();const tor=tore[0];"
            + "const titel=/just a moment|attention required|checking your browser|verify you are human|einen augenblick|sicherheitsabfrage/i.test(document.title||'');"
            + "const token=!!(tor&&tor.token);return JSON.stringify({offen:!!(tor&&(!token||tor.knopf))||(!token&&titel),token,tor:!!tor})})()";
    }

    static String maskierenScript() {
        return "(()=>{const k='data-elfix-verifizierung',i='__elfixVerifizierungStil',alt=document.querySelector('['+k+']');"
            + "const css='html,body{background:transparent!important;overflow:hidden!important}body *{visibility:hidden!important}['+k+'],['+k+'] *{visibility:visible!important}['+k+']{position:fixed!important;inset:0!important;transform:none!important;margin:0!important;width:100%!important;max-width:100%!important;max-height:100vh!important;box-sizing:border-box!important;overflow:auto!important;z-index:2147483647!important}';"
            + "const anwenden=box=>{box.setAttribute(k,'');const st=document.createElement('style');st.id=i;st.textContent=css;(document.head||document.documentElement).appendChild(st)};"
            + "document.getElementById(i)?.remove();document.querySelectorAll('['+k+']').forEach(e=>e.removeAttribute(k));"
            + "const tor=(" + scanner() + ")()[0];if(!tor){if(alt&&alt.isConnected)anwenden(alt);return JSON.stringify({ok:false,height:0})}anwenden(tor.box);"
            + "if(alt!==tor.box)(tor.box.querySelector('iframe,input,button,[role=button]')||tor.box).focus();"
            + "return JSON.stringify({ok:true,height:Math.ceil(tor.box.getBoundingClientRect().height)})})()";
    }

    static String weiterScript() {
        return "(()=>{const tor=(" + scanner() + ")()[0];if(!tor||!tor.token)return 'wartet';const b=tor.knopf;"
            + "if(!b)return 'token';if(b.disabled||b.getAttribute('aria-disabled')==='true'||b.classList.contains('disabled'))return 'gesperrt';"
            + "const ziele=[];const oeffnen=window.open;window.open=u=>{try{const z=new URL(String(u||''),location.href);if(/^https?:$/.test(z.protocol))ziele.push(z.href)}catch(e){}return {focus(){},close(){},closed:false}};"
            + "try{b.click()}finally{window.open=oeffnen}return ziele.length?'geklickt|'+encodeURIComponent(JSON.stringify(ziele)):'geklickt'})()";
    }

    static String maskeEntfernenScript() {
        return "(()=>{document.getElementById('__elfixVerifizierungStil')?.remove();document.querySelectorAll('[data-elfix-verifizierung]').forEach(e=>e.removeAttribute('data-elfix-verifizierung'))})()";
    }

    static boolean darfFortsetzen(boolean tokenGesehen, boolean dokumentGewechselt,
                                   boolean offen, int freieProben) {
        return !offen && (tokenGesehen || dokumentGewechselt) && freieProben >= 2;
    }
}
