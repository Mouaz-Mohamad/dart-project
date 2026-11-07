// Staff security handoff + all public Dart Card surfaces.
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const source=fs.readFileSync("Js/dart-site-settings.js","utf8");
for(const path of ["index.html","products.html","about.html","profile.html","policies.html","cart-checkout.html","Contact us.html"]){
  const html=fs.readFileSync(path,"utf8");
  assert(html.includes('href="/CSS/dart-card-visibility.css"'),path+" is missing OFF-by-default CSS");
  assert(!html.includes('id="dart-card-visibility-policy"'),path+" has duplicate rules");
  assert(html.includes("dart-site-settings.js"),path+" is missing the settings hydrator");
}
const css=fs.readFileSync("CSS/dart-card-visibility.css","utf8");
for(const selector of ["#leaderboard-card","#card-details","#dart-card-details",".dart-card-acount","[data-dart-card-public]"]){
  assert(css.includes("html:not(.dart-card-enabled) "+selector),"Missing OFF rule "+selector);
}
assert(fs.readFileSync("sections/footer.html","utf8").includes('data-dart-card-public>Dart Card</a>'),"Footer link not guarded");

async function run(useStaffClient){
  const calls=[];
  const root={
    location:{pathname:"/Eye/Dart Eye.html",origin:"https://dartofficial.com"},
    document:{
      cookie:"dart_staff_csrf=staff-token; dart_csrf=wrong-customer-token",
      documentElement:{classList:{toggle(){}}},
      addEventListener(){},querySelector(){return null},getElementById(){return null},
    },
    DartAdminAccess:{can:p=>p==="settings.manage"},
    addEventListener(){},dispatchEvent(){},setInterval(){},
  };
  if(useStaffClient)root.DartAdminApi={request:async(path,options)=>{
    calls.push({path,method:options.method,via:"staff",body:options.body});
    return {version:49,settings:options.body.settings};
  }};
  const fetch=async(url,options)=>{
    calls.push({path:url,method:options.method,via:"fetch",headers:options.headers,body:options.body});
    if(options.method==="PUT"){
      assert.equal(options.headers["X-CSRF-Token"],"staff-token","Never send a customer token to a Staff endpoint");
      return {ok:true,status:200,headers:{get:()=>null},json:async()=>({version:49,settings:JSON.parse(options.body).settings})};
    }
    return {ok:true,status:200,headers:{get:()=>null},json:async()=>({version:48,settings:{dartCardEnabled:false}})};
  };
  vm.runInNewContext(source,{window:root,fetch,CustomEvent:class {},console,URL,setTimeout,clearTimeout});
  const settings=root.DartSiteSettings;
  const saved=await settings.sync({...settings.get(),dartCardEnabled:true});
  assert.equal(saved.dartCardEnabled,true);
  const writes=calls.filter(r=>r.method==="PUT"&&r.path.includes("/admin/site-settings"));
  assert.equal(writes.length,1,"One authenticated admin write");
  assert.equal(writes[0].via,useStaffClient?"staff":"fetch");
}
(async()=>{await run(true);await run(false);console.log("PASS Dart Card visibility and Staff CSRF save");})().catch(e=>{console.error(e);process.exitCode=1});
