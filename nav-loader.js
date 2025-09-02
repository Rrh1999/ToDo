// Ensure timer helpers exist early so pages can render before the real script loads
(function ensureTimerStubs(){
  try{
    if(typeof window.createTimerButton!=="function"){
      window.createTimerButton=function(source,name){
        const btn=document.createElement('button');
        // Simple clock icon
        btn.innerHTML='<svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="8" stroke="#2B2C29" stroke-width="2" fill="#C7BBB4"/><path d="M10 5v5l3 3" stroke="#2B2C29" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        btn.title='Start timer';
        btn.style.background='none';
        btn.style.border='none';
        btn.style.cursor='pointer';
        // Disabled until real startTask is ready
        btn.disabled=true; btn.style.opacity='0.5';
        btn.addEventListener('click',()=>{
          if(typeof window.startTask==='function' && !btn.disabled){
            window.startTask(source,name);
          } else {
            console.warn('[time-tracker] Not ready yet');
          }
        });
        // Poll to enable once real impl arrives
        const iv=setInterval(()=>{
          if(typeof window.startTask==='function'){
            btn.disabled=false; btn.style.opacity='';
            clearInterval(iv);
          }
        },500);
        return btn;
      };
    }
    if(typeof window.startTask!=="function"){
      window.startTask=function(){ console.warn('[time-tracker] startTask not ready yet'); };
    }
    if(typeof window.stopTask!=="function"){
      window.stopTask=function(){ console.warn('[time-tracker] stopTask not ready yet'); };
    }
  }catch(e){
    console.warn('Failed to init timer stubs',e);
  }
})();

function loadNav(){
  fetch('nav.html')
    .then(res => res.text())
    .then(html => {
      const ph = document.getElementById('nav-placeholder');
      if (ph) {
        ph.innerHTML = html;
      } else {
        console.warn('[nav-loader] #nav-placeholder not found on this page. Nav will not be injected.');
      }
      // Load time tracker safely even if nav isn't present; it will no-op if container is missing
      const script = document.createElement('script');
      script.src = 'time-tracker.js';
      // After the real script loads, force an initial fetch + render of active timers
      script.onload = () => {
        try {
          if (typeof window.loadTimeTracker === 'function') {
            window.loadTimeTracker();
          }
        } catch (e) {
          console.warn('[nav-loader] loadTimeTracker failed', e);
        }
      };
      // When the real script loads, stubs will be overwritten automatically
      document.body.appendChild(script);
      // Register service worker if available (push registration happens from health page when needed)
      if('serviceWorker' in navigator){
        navigator.serviceWorker.register('/sw.js').catch(()=>{});
      }
    });
}
window.addEventListener('DOMContentLoaded', loadNav);
