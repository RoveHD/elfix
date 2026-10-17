package local.elflix.android;

/** Scripts for a manual verification gate inside the already loaded WebView. */
final class Verifizierung {
    static final long MENSCH_FRIST_MS = 120_000L;
    static final long PRUEF_TAKT_MS = 300L;

    private Verifizierung() { }

    /** One passive scanner shared by detection and masking. */
    private static String scanner() {
        return "()=>{const maskiert=!!document.querySelector('[data-elfix-verifizierung]');const sichtbar=e=>{if(!e||!e.isConnected)return false;"
            + "for(let p=e;p;p=p.parentElement){const x=getComputedStyle(p);if(x.display==='none'||Number(x.opacity)===0)return false;"
            + "if((x.visibility==='hidden'||x.visibility==='collapse')&&(!maskiert||p===e))return false}"
            + "const r=e.getBoundingClientRect();return r.width>0&&r.height>0};"
            + "const wort=e=>String(e&&(e.innerText||e.textContent||e.value)||'').trim();"
            + "const status=e=>e.matches('#challenge-form,#challenge-running,#cf-please-wait');"
            + "const kandidaten=[...document.querySelectorAll('.cf-turnstile,.h-captcha,.g-recaptcha,iframe[src*=\"challenges.cloudflare.com\"],iframe[src*=\"hcaptcha.com\"],iframe[src*=\"recaptcha\"],#challenge-form,#challenge-running,#cf-please-wait,[class*=\"cf-chl-\"],[id*=\"cf-chl-\"]')]"
            + ".sort((a,b)=>Number(status(a))-Number(status(b)));const gesehen=new Set(),tore=[];"
            + "for(const abfrage of kandidaten){let box=abfrage;"
            + "for(let e=abfrage.parentElement,n=0;e&&e!==document.body&&n<6;e=e.parentElement,n++){"
            + "if(sichtbar(e)&&(e.matches('dialog,[role=dialog],.modal-content')||/verify|challenge|captcha|sicherheitsabfrage|best.tigung/i.test(wort(e)))){box=e;break}}"
            + "if(!sichtbar(box)||gesehen.has(box))continue;gesehen.add(box);"
            + "const feld=box.querySelector('input[name=\"cf-turnstile-response\"],textarea[name=\"g-recaptcha-response\"],input[name=\"g-recaptcha-response\"],textarea[name=\"h-captcha-response\"],input[name=\"h-captcha-response\"]');"
            + "const r=box.getBoundingClientRect(),flaeche=Math.max(1,innerWidth*innerHeight);"
            + "tore.push({box,token:!!(feld&&String(feld.value||'').trim()),status:status(abfrage),blockiert:(r.width*r.height/flaeche)>=.2})}"
            + "const titel=/just a moment|attention required|checking your browser|verify you are human|einen augenblick|sicherheitsabfrage/i.test(document.title||'');"
            + "const formular=!!document.querySelector('input[name*=\"cf_chl\"],input[name*=\"cf-chl\"]');"
            + "if(!tore.length&&(titel||formular)&&document.body)tore.push({box:document.body,token:false,status:true,blockiert:true});return tore}";
    }

    static String zustandScript() {
        return "(()=>{const tore=(" + scanner() + ")();const tor=tore[0];"
            + "const titel=/just a moment|attention required|checking your browser|verify you are human|einen augenblick|sicherheitsabfrage/i.test(document.title||'');"
            + "const plattform=!!document.querySelector('script[src*=\"challenge-platform\"],script[src*=\"challenges.cloudflare.com\"]');"
            + "const token=!!(tor&&tor.token);const offen=titel||!!(tor&&(tor.status||tor.blockiert||(plattform&&tor.blockiert)));"
            + "const roh=String(document.body&&document.body.innerText||'').trim();"
            + "const inhalt=!!document.querySelector('video,source,iframe[src],[class*=\"player\"],[class*=\"hoster\"],[data-stream],[data-link-target],a[href*=\"/redirect/\"],a[href*=\"/episode-\"],a[href*=\"/folge-\"]')||/^#EXTM3U|^<\\?xml[^>]*>\\s*<MPD|^<MPD/i.test(roh);"
            + "const erwartet=!offen&&document.readyState==='complete'&&inhalt;"
            + "return JSON.stringify({offen,token,tor:!!tor,erwartet})})()";
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

    static String maskeEntfernenScript() {
        return "(()=>{document.getElementById('__elfixVerifizierungStil')?.remove();document.querySelectorAll('[data-elfix-verifizierung]').forEach(e=>e.removeAttribute('data-elfix-verifizierung'))})()";
    }

    static boolean darfFortsetzen(boolean serverSitzung, boolean dokumentGewechselt,
                                   boolean erwarteterInhalt, boolean serverAntwort,
                                   boolean offen, int freieProben) {
        return !offen && serverAntwort && (erwarteterInhalt || serverSitzung)
            && (serverSitzung || dokumentGewechselt)
            && freieProben >= 2;
    }
}
