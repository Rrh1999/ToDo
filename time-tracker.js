let runningTasks=[];
let allTasks=[];
let _refreshTimer=null;

async function loadTimeTracker(){
  try{
    const res=await fetch('/api/time-tracker');
    if(res.ok){
      const data=await res.json();
      allTasks=data.tasks||[];
      runningTasks=allTasks.filter(t=>!t.end);
      updateRunningDisplay();
      if(typeof renderTrackerTable==='function') renderTrackerTable();
      if(typeof renderCalendar==='function') renderCalendar();
    }
  }catch(e){console.error('Failed to load timers',e);}
}

function updateRunningDisplay(){
  const container=document.getElementById('runningTasks');
  if(!container) return;
  container.innerHTML='';
  runningTasks.forEach(t=>{
    const wrapper=document.createElement('div');
    wrapper.style.display='inline-flex';
    wrapper.style.alignItems='center';
    const label=document.createElement('span');
    label.textContent=`${t.name} since ${t.start}`;
    wrapper.appendChild(label);
    const stop=document.createElement('button');
    stop.innerHTML='<svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="8" fill="#E07A5F"/><path d="M6 6l8 8M14 6l-8 8" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>';
    stop.style.background='none';
    stop.style.border='none';
    stop.style.cursor='pointer';
    stop.style.marginLeft='0.25rem';
    stop.onclick=()=>stopTask(t.id);
    wrapper.appendChild(stop);
    container.appendChild(wrapper);
  });
}

async function startTask(source,name){
  const res=await fetch('/api/time-tracker/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source,name})});
  const task=await res.json();
  allTasks.push(task);
  runningTasks.push(task);
  updateRunningDisplay();
  if(typeof renderTrackerTable==='function') renderTrackerTable();
  if(typeof renderCalendar==='function') renderCalendar();
}

async function stopTask(id){
  const res=await fetch('/api/time-tracker/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});
  const task=await res.json();
  runningTasks=runningTasks.filter(t=>t.id!==id);
  const idx=allTasks.findIndex(t=>t.id===id);
  if(idx>=0) allTasks[idx]=task;
  updateRunningDisplay();
  if(typeof renderTrackerTable==='function') renderTrackerTable();
  if(typeof renderCalendar==='function') renderCalendar();
}

function createTimerButton(source,name){
  const btn=document.createElement('button');
  btn.innerHTML='<svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="8" stroke="#2B2C29" stroke-width="2" fill="#C7BBB4"/><path d="M10 5v5l3 3" stroke="#2B2C29" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  btn.title='Start timer';
  btn.style.background='none';
  btn.style.border='none';
  btn.style.cursor='pointer';
  btn.onclick=()=>startTask(source,name);
  return btn;
}
// Run immediately if DOM is already ready (script is injected after DOMContentLoaded)
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', loadTimeTracker);
} else {
  // Defer a tick to allow nav injection to complete
  setTimeout(loadTimeTracker, 0);
}
// Keep in sync across tabs and on long-lived pages
try{
  if(_refreshTimer) clearInterval(_refreshTimer);
  _refreshTimer = setInterval(loadTimeTracker, 20000);
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) loadTimeTracker(); });
}catch{}
// Expose helpers so nav-loader or pages can refresh UI explicitly
window.updateRunningDisplay=updateRunningDisplay;
window.loadTimeTracker=loadTimeTracker;
window.createTimerButton=createTimerButton;
window.startTask=startTask;
window.stopTask=stopTask;
window.getAllTrackedTasks=()=>allTasks;
window.updateTrackedTask=async (payload)=>{
  const res=await fetch('/api/time-tracker/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(!res.ok) throw new Error('Failed to update');
  const updated=await res.json();
  const i=allTasks.findIndex(t=>t.id===updated.id);
  if(i>=0) allTasks[i]=updated; else allTasks.push(updated);
  runningTasks=allTasks.filter(t=>!t.end);
  updateRunningDisplay();
  if(typeof renderTrackerTable==='function') renderTrackerTable();
  if(typeof renderCalendar==='function') renderCalendar();
  return updated;
};
window.deleteTrackedTask=async (id)=>{
  const res=await fetch('/api/time-tracker/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});
  if(!res.ok) throw new Error('Failed to delete');
  allTasks=allTasks.filter(t=>t.id!==id);
  runningTasks=runningTasks.filter(t=>t.id!==id);
  updateRunningDisplay();
  if(typeof renderTrackerTable==='function') renderTrackerTable();
  if(typeof renderCalendar==='function') renderCalendar();
};
