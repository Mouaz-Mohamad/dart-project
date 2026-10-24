/* Display choices only. No customer, order, catalog or finance records are persisted here. */
(function(root){
  'use strict';
  const doc=root.document,key='dart_dashboard_ui_preferences';
  let preferences={density:'comfortable',columns:{}};
  try{const saved=JSON.parse(root.localStorage.getItem(key)||'null');if(saved&&['comfortable','compact'].includes(saved.density)&&saved.columns&&typeof saved.columns==='object')preferences={density:saved.density,columns:saved.columns};}catch{}
  let version=1,queued=false;
  const $=id=>doc.getElementById(id);
  function columns(section){
    const header=$(section)?.querySelector('.cont-titel .title-name,.dart-sets-head');
    const labels=header?[...header.children].filter(node=>!node.classList.contains('dart-compact-heading')).map(node=>node.textContent.replace(/\s+/g,' ').trim()):[];
    const selected=Array.isArray(preferences.columns[section])?preferences.columns[section]:root.DartDashboardUI?.columnIndices(section,labels)||[];
    return labels.map((label,index)=>({label,index,selected:selected.includes(index)})).filter(item=>item.label&&!/^action/i.test(item.label));
  }
  function apply(){
    queued=false;doc.body.dataset.dartDensity=preferences.density;
    const section=doc.querySelector('.dashboard-section.active-section');if(!section)return;
    section.querySelectorAll('.dart-compact-record').forEach(row=>{
      if(row.dataset.displayVersion===String(version))return;
      const fields=row.querySelector('.dart-record-fields');if(!fields)return;
      const wrappers=[...row.querySelectorAll('.dart-record-detail-field')];
      const labels=[];wrappers.forEach(wrapper=>{labels[Number(wrapper.dataset.recordColumn)]=wrapper.querySelector('h3')?.textContent||'';});
      const chosen=Array.isArray(preferences.columns[section.id])?preferences.columns[section.id]:root.DartDashboardUI?.columnIndices(section.id,labels)||[];
      if(preferences.columns[section.id]||row.dataset.displayVersion){
        fields.replaceChildren();
        chosen.slice(0,7).forEach(index=>{
          const wrapper=wrappers.find(node=>Number(node.dataset.recordColumn)===index);if(!wrapper)return;
          const source=wrapper.lastElementChild,field=doc.createElement('div');field.className='dart-record-field';field.dataset.column=String(index);
          const label=doc.createElement('small');label.textContent=labels[index];
          const value=doc.createElement('strong');value.textContent=(source.querySelector('.status-pill')||source).textContent.trim()||'—';
          const image=source.querySelector('img');if(image){const copy=image.cloneNode(false);copy.removeAttribute('id');value.replaceChildren(copy);}
          field.append(label,value);fields.append(field);
        });
      }
      row.dataset.displayVersion=String(version);
    });
  }
  function schedule(){if(!queued){queued=true;root.requestAnimationFrame(apply);}}
  function save(next){preferences=next;root.localStorage.setItem(key,JSON.stringify(preferences));version+=1;apply();}
  function renderColumnChoices(){
    const fieldset=$('settings-display-columns');if(!fieldset)return;
    fieldset.querySelectorAll('.dart-display-column').forEach(node=>node.remove());
    const section=$('settings-display-section').value;const available=columns(section);
    const order=Array.isArray(preferences.columns[section])?preferences.columns[section]:available.filter(item=>item.selected).map(item=>item.index);
    available.sort((a,b)=>(order.includes(a.index)?order.indexOf(a.index):-1+1000)-(order.includes(b.index)?order.indexOf(b.index):-1+1000));
    available.forEach(item=>{
      const row=doc.createElement('div');row.className='dart-display-column';
      const label=doc.createElement('label'),input=doc.createElement('input');input.type='checkbox';input.value=String(item.index);input.checked=item.selected;
      label.append(input,doc.createTextNode(item.label));row.append(label);
      [['↑',-1],['↓',1]].forEach(([text,step])=>{const move=doc.createElement('button');move.type='button';move.textContent=text;move.setAttribute('aria-label',`${step<0?'Move up':'Move down'} ${item.label}`);move.addEventListener('click',()=>{const neighbor=step<0?row.previousElementSibling:row.nextElementSibling;if(neighbor?.classList.contains('dart-display-column'))fieldset.insertBefore(step<0?row:neighbor,step<0?neighbor:row);});row.append(move);});fieldset.append(row);
    });
  }
  function setupSettings(){
    const form=$('settings-display-form');if(!form)return;
    $('settings-display-density').value=preferences.density;renderColumnChoices();
    $('settings-display-section').addEventListener('change',renderColumnChoices);
    form.addEventListener('submit',event=>{
      event.preventDefault();const checked=[...$('settings-display-columns').querySelectorAll('input:checked')].map(input=>Number(input.value));
      if(!checked.length||checked.length>7){$('settings-display-status').textContent='Choose between one and seven columns.';return;}
      try{save({density:$('settings-display-density').value,columns:{...preferences.columns,[$('settings-display-section').value]:checked}});$('settings-display-status').textContent='Display preferences saved for this browser.';}
      catch{$('settings-display-status').textContent='This browser could not save the display preferences.';}
    });
    $('settings-display-reset').addEventListener('click',()=>{try{save({density:'comfortable',columns:{}});$('settings-display-density').value='comfortable';renderColumnChoices();$('settings-display-status').textContent='Default display restored.';}catch{$('settings-display-status').textContent='Unable to restore display preferences.';}});
    const search=$('settings-search'),jump=$('settings-jump');
    function searchSettings(){
      const tab=$('settings-content').dataset.activeSettingsTab;const query=search.value.trim().toLowerCase();let matches=0;
      doc.querySelectorAll('#settings-content > [data-settings-group]').forEach(card=>{const shown=card.dataset.settingsGroup===tab;const match=!query||card.textContent.toLowerCase().includes(query);card.classList.toggle('dart-settings-search-hidden',shown&&!match);if(shown&&match)matches+=1;});
      $('settings-search-status').textContent=query?`${matches} matching settings group(s)` : '';
    }
    function refreshGroups(){jump.replaceChildren(new Option('Choose a settings group',''));const tab=$('settings-content').dataset.activeSettingsTab;doc.querySelectorAll(`#settings-content > [data-settings-group="${tab}"]`).forEach(card=>{jump.add(new Option(card.querySelector('h2')?.textContent||card.id,card.id));});search.value='';searchSettings();}
    search.addEventListener('input',searchSettings);jump.addEventListener('change',()=>{if(jump.value){search.value='';searchSettings();$(jump.value)?.scrollIntoView({behavior:'smooth',block:'start'});}});
    doc.querySelectorAll('[data-settings-tab]').forEach(tab=>tab.addEventListener('click',refreshGroups));refreshGroups();
  }
  function start(){setupSettings();new MutationObserver(schedule).observe(doc.querySelector('main'),{childList:true,subtree:true});root.addEventListener('dart:dashboard-section-activated',schedule);apply();}
  root.DartDisplayPreferences=Object.freeze({get:()=>JSON.parse(JSON.stringify(preferences))});
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(window);
