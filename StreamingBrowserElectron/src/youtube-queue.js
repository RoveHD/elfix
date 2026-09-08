"use strict";
// Queue preparation keeps a YouTube video cued at zero until the relay releases
// the complete cohort. One document listener also covers SPA video replacement.
function vorbereitenScript(videoId, startId) {
  return `(() => {
    const id = ${JSON.stringify(String(videoId))}, startId = ${JSON.stringify(String(startId))};
    if (new URL(location.href).searchParams.get('v') !== id) return 'wrong-video';
    let hold = window.__elfixQueueHold;
    if (!hold || hold.startId !== startId) {
      if (hold) document.removeEventListener('play', hold.pause, true);
      hold = {startId, pause: event => {
        const player = document.querySelector('#movie_player');
        if (player?.classList.contains('ad-showing') || player?.classList.contains('ad-interrupting')) return;
        if (event.target instanceof HTMLMediaElement) event.target.pause();
      }};
      window.__elfixQueueHold = hold;
      document.addEventListener('play', hold.pause, true);
    }
    const player = document.querySelector('#movie_player');
    const media = player?.querySelector('video') || document.querySelector('video');
    if (!media || player?.classList.contains('ad-showing') || player?.classList.contains('ad-interrupting')) return 'loading';
    media.pause();
    if (media.currentTime > .05) media.currentTime = 0;
    return media.readyState >= 2 && Number.isFinite(media.duration) && media.duration > 0 && !media.seeking ? 'ready' : 'loading';
  })()`;
}
function freigebenScript(startId) {
  return `(() => {
    const hold = window.__elfixQueueHold;
    if (!hold || hold.startId !== ${JSON.stringify(String(startId))}) return false;
    document.removeEventListener('play', hold.pause, true);
    delete window.__elfixQueueHold;
    return true;
  })()`;
}
module.exports = { vorbereitenScript, freigebenScript };
